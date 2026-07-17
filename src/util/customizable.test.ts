import { describe, expect, it } from "vitest";
import { resolveCustomizable } from "./customizable";

describe("resolveCustomizable", () => {
	const FALLBACK = "built-in default";
	const CUSTOM = "my own text";

	it("returns the fallback when not customizing, even with stored text", () => {
		expect(resolveCustomizable(false, "", FALLBACK)).toBe(FALLBACK);
		expect(resolveCustomizable(false, CUSTOM, FALLBACK)).toBe(FALLBACK);
	});

	it("returns the custom text when customizing with non-empty text", () => {
		expect(resolveCustomizable(true, CUSTOM, FALLBACK)).toBe(CUSTOM);
	});

	it("falls back when customizing but the custom text is blank/nullish", () => {
		expect(resolveCustomizable(true, "", FALLBACK)).toBe(FALLBACK);
		expect(resolveCustomizable(true, "   \n", FALLBACK)).toBe(FALLBACK);
		expect(resolveCustomizable(true, null, FALLBACK)).toBe(FALLBACK);
		expect(resolveCustomizable(true, undefined, FALLBACK)).toBe(FALLBACK);
	});

	it("preserves the custom text's own surrounding whitespace once non-blank", () => {
		expect(resolveCustomizable(true, "  padded  ", FALLBACK)).toBe(
			"  padded  "
		);
	});
});
