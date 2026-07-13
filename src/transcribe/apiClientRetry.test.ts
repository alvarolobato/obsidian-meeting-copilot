import { describe, it, expect, beforeEach, vi } from "vitest";

import { __setRequestUrl } from "../../test/obsidian-mock";

import { ApiClient, type ApiConfig } from "./vendor/infrastructure/api/ApiClient";

/**
 * Minimal concrete client to exercise the shared retry logic. `getTimerWindow`
 * is overridden to `globalThis` because the vendored default reads Obsidian's
 * `activeWindow` global, which doesn't exist under vitest.
 */
class TestClient extends ApiClient {
	constructor(config: ApiConfig) {
		super(config);
	}
	testConnection(): Promise<boolean> {
		return Promise.resolve(true);
	}
	run(): Promise<{ ok: boolean }> {
		return this.get<{ ok: boolean }>("/ping");
	}
	protected override getTimerWindow(): Window {
		return globalThis as unknown as Window;
	}
}

const OK = {
	status: 200,
	json: { ok: true },
	text: "",
	headers: { "content-type": "application/json" },
} as unknown as { status: number };

function client() {
	// Tiny retryDelay so exponential backoff doesn't slow the suite.
	return new TestClient({
		baseUrl: "https://example.test",
		apiKey: "k",
		retryDelay: 1,
		maxRetries: 3,
	});
}

describe("ApiClient network-error retry", () => {
	beforeEach(() => {
		__setRequestUrl(() => OK);
	});

	it("retries a transient network throw and then succeeds", async () => {
		const calls = vi.fn();
		let n = 0;
		__setRequestUrl(() => {
			calls();
			n++;
			if (n < 3) {
				throw new Error("net::ERR_NETWORK_IO_SUSPENDED");
			}
			return OK;
		});

		await expect(client().run()).resolves.toEqual({ ok: true });
		expect(calls).toHaveBeenCalledTimes(3); // 2 failures + 1 success
	});

	it("gives up after maxRetries and rethrows the network error", async () => {
		const calls = vi.fn();
		__setRequestUrl(() => {
			calls();
			throw new Error("ECONNRESET socket hang up");
		});

		await expect(client().run()).rejects.toThrow(/ECONNRESET/);
		expect(calls).toHaveBeenCalledTimes(4); // initial + 3 retries
	});

	it("does not retry a non-network error", async () => {
		const calls = vi.fn();
		__setRequestUrl(() => {
			calls();
			throw new Error("totally unexpected parse failure");
		});

		await expect(client().run()).rejects.toThrow(/parse failure/);
		expect(calls).toHaveBeenCalledTimes(1);
	});

	it("still retries HTTP 5xx (unchanged behavior)", async () => {
		const calls = vi.fn();
		let n = 0;
		__setRequestUrl(() => {
			calls();
			n++;
			if (n < 2) {
				return { status: 503, json: {}, text: "busy" } as unknown as {
					status: number;
				};
			}
			return OK;
		});

		await expect(client().run()).resolves.toEqual({ ok: true });
		expect(calls).toHaveBeenCalledTimes(2);
	});
});
