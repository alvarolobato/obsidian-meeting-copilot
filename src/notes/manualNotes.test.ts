import { describe, expect, it } from "vitest";
import { normalizeManualNotes } from "./manualNotes";

const FM = ["---", "title: 1:1", "---", ""].join("\n");

describe("normalizeManualNotes", () => {
	it("captures loose notes written above the ## Notes heading", () => {
		const content = [
			FM,
			"# 1:1 Sophie <> Alvaro",
			"",
			"- Had a chat about dashboards",
			"- Follow up with Sophie",
			"",
			"- **When:** 2026-07-13 12:30 – 13:00",
			"- **Attendees:** Sophie, Alvaro",
			"",
			"## Notes",
			"",
			"## Summary",
			"",
		].join("\n");
		const { notes, content: out } = normalizeManualNotes(content);
		expect(notes).toBe(
			"- Had a chat about dashboards\n- Follow up with Sophie"
		);
		// Notes are folded under "## Notes"…
		const notesIdx = out.indexOf("## Notes");
		expect(out.indexOf("- Follow up with Sophie")).toBeGreaterThan(notesIdx);
		// …and removed from the preamble (no longer above the metadata).
		expect(out.indexOf("- Had a chat about dashboards")).toBeGreaterThan(
			out.indexOf("- **When:**")
		);
	});

	it("keeps the metadata bullets and the AI-notes callout in place", () => {
		const content = [
			"# Title",
			"",
			"> [!ai-notes]+ AI notes",
			"> ### TL;DR",
			"> - a point",
			"",
			"- jot: remember this",
			"",
			"- **Link:** https://example.com",
			"",
			"## Notes",
			"",
		].join("\n");
		const { notes, content: out } = normalizeManualNotes(content);
		expect(notes).toBe("- jot: remember this");
		expect(out).toContain("> [!ai-notes]+ AI notes");
		expect(out).toContain("- **Link:** https://example.com");
	});

	it("merges with an existing ## Notes body and dedupes", () => {
		const content = [
			"# Title",
			"",
			"- new loose note",
			"- existing note",
			"",
			"## Notes",
			"",
			"- existing note",
			"",
		].join("\n");
		const { notes } = normalizeManualNotes(content);
		expect(notes).toBe("- existing note\n- new loose note");
	});

	it("leaves content untouched when there are no loose notes", () => {
		const content = [
			"# Title",
			"",
			"- **When:** today",
			"",
			"## Notes",
			"",
			"- a kept note",
			"",
			"## Summary",
			"",
		].join("\n");
		const { notes, content: out } = normalizeManualNotes(content);
		expect(notes).toBe("- a kept note");
		expect(out).toBe(content);
	});

	it("folds ## Summary bullets into the LLM notes without touching the file", () => {
		const content = [
			"# Title",
			"",
			"- **When:** today",
			"",
			"## Notes",
			"",
			"## Summary",
			"",
			"- Discussed Q3 roadmap",
			"- Agreed on launch date",
			"",
		].join("\n");
		const { notes, content: out } = normalizeManualNotes(content);
		expect(notes).toBe(
			"- Discussed Q3 roadmap\n- Agreed on launch date"
		);
		// No loose preamble notes, so the file is left completely untouched —
		// the Summary bullets stay under "## Summary", not duplicated into "## Notes".
		expect(out).toBe(content);
	});

	it("merges ## Summary with ## Notes and loose notes for the LLM, deduped", () => {
		const content = [
			"# Title",
			"",
			"- new loose note",
			"",
			"## Notes",
			"",
			"- existing note",
			"",
			"## Summary",
			"",
			"- Discussed Q3 roadmap",
			"- existing note",
			"",
		].join("\n");
		const { notes, content: out } = normalizeManualNotes(content);
		expect(notes).toBe(
			"- existing note\n- Discussed Q3 roadmap\n- new loose note"
		);
		// A rebuild does happen here (there's a loose preamble note), but it
		// must never pull the Summary body into ## Notes — only the loose note.
		const notesBody = out.slice(
			out.indexOf("## Notes"),
			out.indexOf("## Summary")
		);
		expect(notesBody).not.toContain("Discussed Q3 roadmap");
		expect(out).toContain("## Summary");
		expect(out).toContain("- Discussed Q3 roadmap");
	});

	it("creates a ## Notes section when it is missing", () => {
		const content = ["# Title", "", "- orphan note", ""].join("\n");
		const { notes, content: out } = normalizeManualNotes(content);
		expect(notes).toBe("- orphan note");
		expect(out).toContain("## Notes");
		expect(out.indexOf("- orphan note")).toBeGreaterThan(
			out.indexOf("## Notes")
		);
	});
});
