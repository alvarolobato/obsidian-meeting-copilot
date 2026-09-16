import { afterEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { chatComplete, EnrichTimeoutError } from "./llm";

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
	return {
		...actual,
		requestUrl: vi.fn(),
	};
});

describe("chatComplete timeout", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("rejects with EnrichTimeoutError when the request hangs past timeoutMs", async () => {
		vi.useFakeTimers();
		vi.mocked(requestUrl).mockReturnValue(
			new Promise(() => {
				/* never settles */
			}) as ReturnType<typeof requestUrl>
		);

		const pending = chatComplete({
			baseUrl: "https://example.test/v1",
			apiKey: "k",
			model: "m",
			system: "s",
			user: "u",
			timeoutMs: 1_000,
		});
		const assertion = expect(pending).rejects.toBeInstanceOf(
			EnrichTimeoutError
		);
		await vi.advanceTimersByTimeAsync(1_000);
		await assertion;
	});
});

describe("chatComplete authorization header", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	/** Runs one call and returns the headers it put on the request. */
	async function headersFor(apiKey: string): Promise<Record<string, string>> {
		// The mock is created once in the module factory, so it still holds calls
		// from earlier tests in this file; clear it to read our own request.
		vi.mocked(requestUrl).mockClear();
		vi.mocked(requestUrl).mockReturnValue(
			Promise.resolve({
				status: 200,
				json: { choices: [{ message: { content: "ok" } }] },
			}) as unknown as ReturnType<typeof requestUrl>
		);
		// The response shape doesn't matter here: the request is already recorded
		// by the time the promise settles, so a rejection is fine.
		await chatComplete({
			baseUrl: "http://localhost:11434/v1",
			apiKey,
			model: "m",
			system: "s",
			user: "u",
			timeoutMs: 1_000,
		}).catch(() => undefined);
		const opts = vi.mocked(requestUrl).mock.calls[0]?.[0] as {
			headers?: Record<string, string>;
		};
		return opts?.headers ?? {};
	}

	it("omits Authorization for a keyless local server", async () => {
		// A blank `Bearer ` makes otherwise-open endpoints reject the call, which
		// would break the keyless case the endpoint rule deliberately allows.
		expect(await headersFor("")).not.toHaveProperty("Authorization");
	});

	it("sends Authorization when a key is set", async () => {
		expect(await headersFor("sk-test")).toMatchObject({
			Authorization: "Bearer sk-test",
		});
	});
});
