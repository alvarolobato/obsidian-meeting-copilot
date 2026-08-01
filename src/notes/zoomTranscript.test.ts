import { describe, expect, it } from "vitest";
import { looksLikeZoomVtt, parseZoomTranscript } from "./zoomTranscript";

const SAMPLE_VTT = [
	"WEBVTT",
	"",
	"1",
	"00:00:00.000 --> 00:00:02.000",
	"Joe Reuter @ Elastic Observability: Hey everyone",
	"",
	"2",
	"00:00:02.500 --> 00:00:04.000",
	"Joe Reuter @ Elastic Observability: how's it going",
	"",
	"3",
	"00:00:04.500 --> 00:00:06.000",
	"Jane Doe: Good, thanks!",
	"",
	"4",
	"00:00:06.500 --> 00:00:07.000",
	"Jane Doe: Okay.",
	"",
].join("\n");

describe("looksLikeZoomVtt", () => {
	it("recognizes a standard WEBVTT cue file", () => {
		expect(looksLikeZoomVtt(SAMPLE_VTT)).toBe(true);
	});

	it("rejects plain text", () => {
		expect(looksLikeZoomVtt("Just a plain transcript export.\nNo cues here.")).toBe(
			false
		);
	});

	it("rejects a WEBVTT header with no cues", () => {
		expect(looksLikeZoomVtt("WEBVTT\n\nNOTE some metadata\n")).toBe(false);
	});

	it("tolerates a leading BOM", () => {
		expect(looksLikeZoomVtt(`\uFEFF${SAMPLE_VTT}`)).toBe(true);
	});
});

describe("parseZoomTranscript", () => {
	it("strips org suffixes, merges consecutive cues, and drops a mid-stream filler", () => {
		const parsed = parseZoomTranscript(SAMPLE_VTT);
		expect(parsed).not.toBeNull();
		expect(parsed?.participants).toEqual(["Jane Doe", "Joe Reuter"]);
		expect(parsed?.transcript).toBe(
			"Joe Reuter: Hey everyone how's it going\nJane Doe: Good, thanks!"
		);
	});

	it("strips a '| Role' speaker suffix too", () => {
		const vtt = [
			"WEBVTT",
			"",
			"1",
			"00:00:00.000 --> 00:00:02.000",
			"Alice Smith | Host: Welcome all",
			"",
		].join("\n");
		expect(parseZoomTranscript(vtt)?.transcript).toBe("Alice Smith: Welcome all");
	});

	it("drops a mid-stream filler even with trailing comma/ellipsis punctuation", () => {
		const vtt = [
			"WEBVTT",
			"",
			"1",
			"00:00:00.000 --> 00:00:02.000",
			"Bob: Okay,",
			"",
			"2",
			"00:00:02.500 --> 00:00:04.000",
			"Bob: right…",
			"",
			"3",
			"00:00:04.500 --> 00:00:06.000",
			"Bob: Here's the real point I wanted to make",
			"",
		].join("\n");
		expect(parseZoomTranscript(vtt)?.transcript).toBe(
			"Bob: Here's the real point I wanted to make"
		);
	});

	it("keeps a lone filler utterance when it's the only thing a speaker said", () => {
		const vtt = [
			"WEBVTT",
			"",
			"1",
			"00:00:00.000 --> 00:00:02.000",
			"Bob: Thanks",
			"",
			"2",
			"00:00:02.500 --> 00:00:04.000",
			"Alice: The real content here",
			"",
		].join("\n");
		const parsed = parseZoomTranscript(vtt);
		expect(parsed?.transcript).toContain("Bob: Thanks");
	});

	it("returns null when there are no VTT cues", () => {
		expect(parseZoomTranscript("WEBVTT\n\nNOTE nothing to parse\n")).toBeNull();
	});

	it("returns null when most cues have no recognizable speaker (non-standard format)", () => {
		const vtt = [
			"WEBVTT",
			"",
			"1",
			"00:00:00.000 --> 00:00:02.000",
			"just some text with no speaker prefix",
			"",
			"2",
			"00:00:02.500 --> 00:00:04.000",
			"more unlabeled text",
			"",
		].join("\n");
		expect(parseZoomTranscript(vtt)).toBeNull();
	});

	it("parses cues with no numeric identifier at all (optional per the WebVTT spec)", () => {
		const vtt = [
			"WEBVTT",
			"",
			"00:00:00.000 --> 00:00:02.000",
			"Alice: Hello there",
			"",
			"00:00:02.500 --> 00:00:04.000",
			"Bob: Hi Alice",
			"",
		].join("\n");
		expect(parseZoomTranscript(vtt)?.transcript).toBe(
			"Alice: Hello there\nBob: Hi Alice"
		);
	});

	it("parses a mix of numbered and unnumbered cues without dropping the unnumbered ones", () => {
		// Regression: previously only cues immediately preceded by a bare-digit
		// line were recognized at all, so an export mixing the two styles (or
		// simply omitting identifiers past the first cue) silently lost every
		// cue without one — and since only *parsed* cues counted toward the
		// unknown-speaker ratio, the LLM-fallback safety net never tripped
		// either, so a badly truncated transcript replaced a good one with no
		// warning.
		const vtt = [
			"WEBVTT",
			"",
			"1",
			"00:00:00.000 --> 00:00:02.000",
			"Alice: First line",
			"",
			"00:00:02.500 --> 00:00:04.000",
			"Bob: Second line",
			"",
			"00:00:04.500 --> 00:00:06.000",
			"Alice: Third line",
			"",
		].join("\n");
		const parsed = parseZoomTranscript(vtt);
		expect(parsed?.transcript).toBe(
			"Alice: First line\nBob: Second line\nAlice: Third line"
		);
	});

	it("doesn't merge two cues into one when the blank separator line is missing", () => {
		const vtt = [
			"WEBVTT",
			"",
			"1",
			"00:00:00.000 --> 00:00:02.000",
			"Alice: one",
			"2",
			"00:00:02.500 --> 00:00:04.000",
			"Bob: two",
			"",
		].join("\n");
		const parsed = parseZoomTranscript(vtt);
		expect(parsed?.transcript).toBe("Alice: one\nBob: two");
	});

	// The next three cases pair the ambiguous cue with clearly-labeled ones so
	// the overall unknown-speaker ratio stays well under the 0.35 escape-hatch
	// threshold — otherwise a single-cue file trips that unrelated safety net
	// and the whole parse (correctly) returns null before we can see how the
	// ambiguous cue itself was classified.

	it("doesn't split a sentence containing a colon into a fake speaker", () => {
		const vtt = [
			"WEBVTT",
			"",
			"1",
			"00:00:00.000 --> 00:00:02.000",
			"Alice: Here's the situation",
			"",
			"2",
			"00:00:02.500 --> 00:00:04.000",
			"so the plan is: we ship on Friday",
			"",
			"3",
			"00:00:04.500 --> 00:00:06.000",
			"Alice: Sounds right to me",
			"",
		].join("\n");
		const parsed = parseZoomTranscript(vtt);
		expect(parsed?.transcript).toContain(
			"Unknown Speaker: so the plan is: we ship on Friday"
		);
	});

	it("doesn't split a time-of-day mention into a fake speaker", () => {
		const vtt = [
			"WEBVTT",
			"",
			"1",
			"00:00:00.000 --> 00:00:02.000",
			"Alice: Quick scheduling note",
			"",
			"2",
			"00:00:02.500 --> 00:00:04.000",
			"Let's meet at 10:30 tomorrow",
			"",
			"3",
			"00:00:04.500 --> 00:00:06.000",
			"Alice: Works for me",
			"",
		].join("\n");
		const parsed = parseZoomTranscript(vtt);
		expect(parsed?.transcript).toContain(
			"Unknown Speaker: Let's meet at 10:30 tomorrow"
		);
	});

	it("keeps a cue's content instead of dropping it when the speaker cleans away to nothing", () => {
		// "@alice" has no name before the org/role suffix marker, so
		// cleanSpeaker() reduces it to "" — the cue must not vanish because of
		// that; it should fall back to Unknown Speaker with the full text.
		const vtt = [
			"WEBVTT",
			"",
			"1",
			"00:00:00.000 --> 00:00:02.000",
			"Alice: Setting the stage",
			"",
			"2",
			"00:00:02.500 --> 00:00:04.000",
			"@alice: real content here",
			"",
			"3",
			"00:00:04.500 --> 00:00:06.000",
			"Alice: Wrapping up",
			"",
		].join("\n");
		const parsed = parseZoomTranscript(vtt);
		expect(parsed?.transcript).toContain("real content here");
	});
});
