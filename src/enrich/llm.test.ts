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
