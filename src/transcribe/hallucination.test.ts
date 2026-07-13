import { describe, expect, it } from "vitest";
import { isHallucinationPhrase, stripHallucinatedLines } from "./hallucination";

describe("isHallucinationPhrase", () => {
	it("flags an empty or whitespace-only segment", () => {
		expect(isHallucinationPhrase("")).toBe(true);
		expect(isHallucinationPhrase("   ")).toBe(true);
	});

	it("flags bracketed non-speech tokens", () => {
		expect(isHallucinationPhrase("[Music]")).toBe(true);
		expect(isHallucinationPhrase("[ Applause ]")).toBe(true);
		expect(isHallucinationPhrase("[BLANK_AUDIO]")).toBe(true);
		expect(isHallucinationPhrase("(silence)")).toBe(true);
		expect(isHallucinationPhrase("<inaudible>")).toBe(true);
	});

	it("flags pure musical-note segments", () => {
		expect(isHallucinationPhrase("♪♪♪")).toBe(true);
		expect(isHallucinationPhrase("🎵")).toBe(true);
	});

	it("flags YouTube-outro stock phrases regardless of case/punctuation", () => {
		expect(isHallucinationPhrase("Thanks for watching!")).toBe(true);
		expect(isHallucinationPhrase("thank you for watching")).toBe(true);
		expect(isHallucinationPhrase("Thank you so much for watching.")).toBe(true);
	});

	it("flags the reported CTA hallucination", () => {
		expect(
			isHallucinationPhrase("Please Like Subscribe and Enable Notifications")
		).toBe(true);
		expect(isHallucinationPhrase("Like and subscribe!")).toBe(true);
		expect(isHallucinationPhrase("Subscribe and hit the bell icon")).toBe(true);
	});

	it("flags subtitle/caption credits", () => {
		expect(
			isHallucinationPhrase("Subtitles by the Amara.org community")
		).toBe(true);
		expect(isHallucinationPhrase("Transcription by CastingWords")).toBe(true);
	});

	it("flags repeated thank-yous but not a bare 'you'", () => {
		expect(isHallucinationPhrase("Thank you. Thank you. Thank you.")).toBe(true);
		// A bare "you" is too plausible as real speech; left to confidence signals.
		expect(isHallucinationPhrase("you")).toBe(false);
	});

	it("does NOT flag real sentences that merely contain a stock phrase", () => {
		expect(
			isHallucinationPhrase("Thank you for the update on the roadmap.")
		).toBe(false);
		expect(isHallucinationPhrase("Let me share my screen")).toBe(false);
	});

	it("does NOT flag real 'subscribe'/'like' meeting speech (tight CTA patterns)", () => {
		expect(
			isHallucinationPhrase("Can you subscribe me to the incident channel?")
		).toBe(false);
		expect(
			isHallucinationPhrase("Please subscribe me to the incident channel")
		).toBe(false);
		expect(
			isHallucinationPhrase("I'd like to subscribe to the premium tier")
		).toBe(false);
		expect(
			isHallucinationPhrase("We should enable notifications for that alert rule")
		).toBe(false);
	});

	it("does NOT flag short genuine utterances", () => {
		expect(isHallucinationPhrase("bye")).toBe(false);
		expect(isHallucinationPhrase("thanks")).toBe(false);
		expect(isHallucinationPhrase("okay")).toBe(false);
		expect(isHallucinationPhrase("sounds good")).toBe(false);
	});
});

describe("stripHallucinatedLines", () => {
	it("empties a transcript that is only a stock phrase", () => {
		expect(
			stripHallucinatedLines("Please Like Subscribe and Enable Notifications")
		).toBe("");
	});

	it("drops hallucinated lines but keeps real content", () => {
		const text = [
			"We agreed to ship on Friday.",
			"Thanks for watching!",
			"Follow up with Dana about the DB migration.",
		].join("\n");
		expect(stripHallucinatedLines(text)).toBe(
			["We agreed to ship on Friday.", "Follow up with Dana about the DB migration."].join("\n")
		);
	});

	it("leaves a clean transcript untouched", () => {
		const text = "First point.\nSecond point.";
		expect(stripHallucinatedLines(text)).toBe(text);
	});
});
