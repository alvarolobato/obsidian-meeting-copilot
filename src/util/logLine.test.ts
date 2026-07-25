import { afterEach, describe, expect, it, vi } from "vitest";
import { formatLogData, mcLog } from "./logLine";

describe("formatLogData", () => {
	it("JSON-encodes plain fields", () => {
		expect(formatLogData({ a: 1, b: "x" })).toBe('{"a":1,"b":"x"}');
	});

	it("truncates long strings", () => {
		const long = "x".repeat(600);
		const out = formatLogData({ long });
		expect(out).toContain("…");
		expect(out.length).toBeLessThan(600);
	});

	it("serializes Errors without collapsing to Object", () => {
		const out = formatLogData({ err: new Error("boom") });
		expect(out).toContain("boom");
		expect(out).toContain("Error");
	});
});

describe("mcLog", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("emits a single string line with embedded JSON", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		mcLog("enrich", "begin", { note: "a.md", model: "x" });
		expect(spy).toHaveBeenCalledOnce();
		expect(spy.mock.calls[0]?.[0]).toBe(
			'[Meeting Copilot][enrich] begin {"note":"a.md","model":"x"}'
		);
		expect(spy.mock.calls[0]?.length).toBe(1);
	});
});
