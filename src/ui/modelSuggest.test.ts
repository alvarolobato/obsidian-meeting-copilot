import { describe, expect, it } from "vitest";
import { filterModelOptions, type ModelOption } from "./modelSuggest";

const opts: ModelOption[] = [
	{ value: "", label: "Same as primary" },
	{ value: "gpt-4o-transcribe", label: "gpt-4o-transcribe" },
	{ value: "llm-gateway/whisper", label: "llm-gateway/whisper" },
	{ value: "openrouter/anthropic/claude-sonnet-4", label: "openrouter/anthropic/claude-sonnet-4" },
];

describe("filterModelOptions", () => {
	it("returns all options for an empty query", () => {
		expect(filterModelOptions(opts, "")).toEqual(opts);
		expect(filterModelOptions(opts, "   ")).toEqual(opts);
	});

	it("matches substrings in value or label case-insensitively", () => {
		expect(filterModelOptions(opts, "WHISPER").map((o) => o.value)).toEqual([
			"llm-gateway/whisper",
		]);
		expect(filterModelOptions(opts, "claude").map((o) => o.value)).toEqual([
			"openrouter/anthropic/claude-sonnet-4",
		]);
		expect(filterModelOptions(opts, "same").map((o) => o.label)).toEqual([
			"Same as primary",
		]);
	});

	it("returns an empty list when nothing matches", () => {
		expect(filterModelOptions(opts, "nope")).toEqual([]);
	});
});
