import { describe, it, expect, beforeEach, vi } from "vitest";

import { __setRequestUrl } from "../../test/obsidian-mock";

import {
	ApiClient,
	RequestTimeoutError,
	type ApiConfig,
} from "./vendor/infrastructure/api/ApiClient";

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
	run(signal?: AbortSignal): Promise<{ ok: boolean }> {
		return this.get<{ ok: boolean }>("/ping", undefined, signal);
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

	it("does not retry application-level 'timeout' messages", async () => {
		// A workflow-level "chunk processing timeout" is not a network failure
		// and must not be retried (the predicate matches specific network tells,
		// not the bare word "timeout").
		const calls = vi.fn();
		__setRequestUrl(() => {
			calls();
			throw new Error("Chunk processing timeout after post-processing");
		});

		await expect(client().run()).rejects.toThrow(/Chunk processing timeout/);
		expect(calls).toHaveBeenCalledTimes(1);
	});

	it("aborts immediately when the signal is already aborted at the catch", async () => {
		const calls = vi.fn();
		const controller = new AbortController();
		__setRequestUrl(() => {
			calls();
			// Abort synchronously with the failure: the catch's first guard fires.
			controller.abort();
			throw new Error("net::ERR_NETWORK_IO_SUSPENDED");
		});

		await expect(client().run(controller.signal)).rejects.toThrow(
			/cancelled by user/
		);
		expect(calls).toHaveBeenCalledTimes(1);
	});

	it("does not fire another request when aborted DURING the backoff", async () => {
		// First attempt fails with a real network error and does NOT abort, so the
		// retry branch is entered and awaits the backoff. The signal then aborts
		// mid-delay, exercising the post-delay cancellation check specifically.
		const calls = vi.fn();
		const controller = new AbortController();
		// Backoff long enough to abort within it.
		const c = new TestClient({
			baseUrl: "https://example.test",
			apiKey: "k",
			retryDelay: 50,
			maxRetries: 3,
		});
		__setRequestUrl(() => {
			calls();
			throw new Error("net::ERR_NETWORK_IO_SUSPENDED");
		});
		setTimeout(() => controller.abort(), 5);

		await expect(c.run(controller.signal)).rejects.toThrow(/cancelled by user/);
		expect(calls).toHaveBeenCalledTimes(1); // no second request after abort
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

describe("ApiClient per-request timeout (issue #96)", () => {
	/** A request that never settles — the "gateway accepted then stalled" case. */
	const STALL = (): Promise<never> => new Promise<never>(() => {});

	it("times out a stalled request, retries, then succeeds", async () => {
		vi.useFakeTimers();
		try {
			let n = 0;
			__setRequestUrl(() => {
				n++;
				return n === 1 ? STALL() : OK;
			});
			const c = new TestClient({
				baseUrl: "https://example.test",
				apiKey: "k",
				timeout: 100,
				retryDelay: 1,
				maxRetries: 3,
			});
			const p = c.run();
			// Past the 100ms timeout (→ RequestTimeoutError) + the tiny backoff,
			// so the retry fires and the second attempt returns OK.
			await vi.advanceTimersByTimeAsync(200);
			await expect(p).resolves.toEqual({ ok: true });
			expect(n).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("gives up after maxRetries of repeated timeouts", async () => {
		vi.useFakeTimers();
		try {
			const calls = vi.fn();
			__setRequestUrl(() => {
				calls();
				return STALL();
			});
			const c = new TestClient({
				baseUrl: "https://example.test",
				apiKey: "k",
				timeout: 100,
				retryDelay: 1,
				maxRetries: 2,
			});
			let err: unknown;
			const p = c.run().catch((e) => {
				err = e;
			});
			await vi.advanceTimersByTimeAsync(1000);
			await p;
			expect(err).toBeInstanceOf(RequestTimeoutError);
			expect(calls).toHaveBeenCalledTimes(3); // initial + 2 retries
		} finally {
			vi.useRealTimers();
		}
	});

	it("settles a stalled request promptly on user abort (before the timeout)", async () => {
		vi.useFakeTimers();
		try {
			const calls = vi.fn();
			__setRequestUrl(() => {
				calls();
				return STALL();
			});
			const controller = new AbortController();
			const c = new TestClient({
				baseUrl: "https://example.test",
				apiKey: "k",
				// A long timeout so only the abort — not the timeout — can settle it.
				timeout: 10 * 60 * 1000,
				retryDelay: 1,
				maxRetries: 3,
			});
			let err: unknown;
			const p = c.run(controller.signal).catch((e) => {
				err = e;
			});
			controller.abort();
			await vi.advanceTimersByTimeAsync(1);
			await p;
			expect(String((err as Error)?.message)).toMatch(/cancelled by user/);
			expect(calls).toHaveBeenCalledTimes(1); // no retry after a user abort
		} finally {
			vi.useRealTimers();
		}
	});
});
