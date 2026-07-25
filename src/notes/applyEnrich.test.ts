import { describe, expect, it } from "vitest";
import { applyEnrichToContent } from "./applyEnrich";
import { formatTranscriptCallout } from "./meetingNote";

describe("applyEnrichToContent", () => {
	it("pins the AI callout above an existing transcript", () => {
		const transcript = formatTranscriptCallout("Ann: hi");
		const current = `# M\n\n## Notes\n\nmy note\n\n${transcript}`;
		const out = applyEnrichToContent(current, {
			calloutBody: "Summary of the meeting.",
			actionItemsAsTasks: false,
			todayStamp: "2026-07-25",
			extractActionItems: (b) => ({ items: [], without: b }),
			extractFollowUps: (b) => ({ items: [], without: b }),
		});
		expect(out).toContain("Summary of the meeting.");
		expect(out).toContain("Ann: hi");
		expect(out.indexOf("Summary")).toBeLessThan(out.indexOf("Ann: hi"));
	});

	it("merges action items when enabled", () => {
		const current = "# M\n\n## Notes\n\nnote\n";
		const out = applyEnrichToContent(current, {
			calloutBody: "Body\n\n## Next steps\n- ship it",
			actionItemsAsTasks: true,
			todayStamp: "2026-07-25",
			extractActionItems: (b) => ({
				items: ["ship it"],
				without: "Body",
			}),
			extractFollowUps: (b) => ({ items: [], without: b }),
		});
		expect(out).toContain("## Action items");
		expect(out).toContain("ship it");
		expect(out).toContain("Body");
	});
});
