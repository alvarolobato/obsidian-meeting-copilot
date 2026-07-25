import { describe, expect, it } from "vitest";
import { TranscriptionMerger } from "./vendor/core/transcription/TranscriptionMerger";
import type {
	TranscriptionResult,
	TranscriptionSegment,
} from "./vendor/core/transcription/TranscriptionTypes";

function seg(
	start: number,
	end: number,
	text: string
): TranscriptionSegment {
	return { start, end, text };
}

function chunk(
	id: number,
	segments: TranscriptionSegment[]
): TranscriptionResult {
	return {
		id,
		text: segments.map((s) => s.text).join(" "),
		startTime: segments[0]?.start ?? 0,
		endTime: segments[segments.length - 1]?.end ?? 0,
		success: true,
		segments,
	};
}

describe("deduplicateSegments via mergeWithTimestamps (#23)", () => {
	const merger = new TranscriptionMerger("whisper-1-ts");

	it("does not duplicate overlapping words when extending a segment", () => {
		// Classic chunk-boundary geometry: prev ends mid-phrase, current
		// overlaps ~50%+ and continues with new words.
		const a = [
			seg(95, 101, "so we should ship on Friday"),
		];
		const b = [
			seg(98, 104, "we should ship on Friday and then review"),
		];
		const text = merger.mergeWithTimestamps([chunk(0, a), chunk(1, b)]);
		const lower = text.toLowerCase();
		const phrase = "we should ship on friday";
		const first = lower.indexOf(phrase);
		const second = lower.indexOf(phrase, first + 1);
		expect(first).toBeGreaterThanOrEqual(0);
		expect(second).toBe(-1);
		expect(lower).toContain("review");
	});

	it("does not mutate the input segment objects", () => {
		const shared = seg(0, 5, "hello world");
		const next = seg(3, 8, "world and more");
		const before = { ...shared };
		merger.mergeWithTimestamps([chunk(0, [shared]), chunk(1, [next])]);
		expect(shared).toEqual(before);
	});

	it("keeps novel text when a segment is time-contained", () => {
		const a = [seg(0, 10, "alpha beta")];
		const b = [seg(2, 8, "beta gamma")];
		const text = merger.mergeWithTimestamps([chunk(0, a), chunk(1, b)]);
		expect(text.toLowerCase()).toContain("gamma");
	});
});
