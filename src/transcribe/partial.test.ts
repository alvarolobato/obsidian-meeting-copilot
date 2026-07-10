import { describe, expect, it } from "vitest";
import { isPartialTranscript } from "./partial";

describe("isPartialTranscript", () => {
	it("detects the English partial marker", () => {
		expect(
			isPartialTranscript("Partial transcription result\n2/5\n\nhello")
		).toBe(true);
	});

	it("detects localized markers", () => {
		expect(isPartialTranscript("[部分的な文字起こし結果]\n\n…")).toBe(true);
		expect(isPartialTranscript("（部分结果）\n\n…")).toBe(true);
		expect(isPartialTranscript("[부분 전사 결과]\n\n…")).toBe(true);
	});

	it("tolerates leading whitespace", () => {
		expect(isPartialTranscript("\n  Partial transcription result")).toBe(
			true
		);
	});

	it("treats normal transcripts as complete", () => {
		expect(isPartialTranscript("So today we discussed the roadmap.")).toBe(
			false
		);
		expect(isPartialTranscript("")).toBe(false);
	});
});
