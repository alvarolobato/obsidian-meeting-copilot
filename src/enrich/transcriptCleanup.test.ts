import { describe, expect, it } from "vitest";
import { TRANSCRIPT_TRUNCATION_MARKER } from "./prompt";
import {
	buildTranscriptCleanupPrompt,
	TRANSCRIPT_CLEANUP_SYSTEM_PROMPT,
} from "./transcriptCleanup";

describe("transcriptCleanup prompt", () => {
	it("embeds the raw transcript verbatim", () => {
		const raw = "1\n00:00:00 --> 00:00:01\nSomeone: hi there\n";
		expect(buildTranscriptCleanupPrompt(raw)).toContain(raw);
	});

	it("asks for the plugin's 'Speaker: text' per-line convention", () => {
		const prompt = buildTranscriptCleanupPrompt("raw");
		expect(prompt).toContain("Speaker Name: utterance text");
	});

	it("forbids inventing, summarizing, or dropping content", () => {
		expect(TRANSCRIPT_CLEANUP_SYSTEM_PROMPT).toContain("never invent");
		const prompt = buildTranscriptCleanupPrompt("raw");
		expect(prompt).toMatch(/do not summarize, paraphrase, invent, omit/i);
	});

	it("tells the model to leave a budget-truncation marker alone rather than reconstruct across it", () => {
		const prompt = buildTranscriptCleanupPrompt("raw");
		expect(prompt).toContain(TRANSCRIPT_TRUNCATION_MARKER.trim());
		expect(prompt).toMatch(/leave it exactly as-is/i);
	});
});
