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
});
