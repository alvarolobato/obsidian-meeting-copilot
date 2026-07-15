import { describe, expect, it } from "vitest";
import {
	buildDashboardBlock,
	DASHBOARD_END,
	DASHBOARD_START,
	PAST_BLOCK_LANG,
	UPCOMING_BLOCK_LANG,
	withDashboardBlock,
} from "./dashboard";

describe("buildDashboardBlock", () => {
	it("keeps the open-action-items task query (vault-wide, gated to meeting notes)", () => {
		const block = buildDashboardBlock();
		expect(block).not.toContain("FROM ");
		expect(block).toContain(
			"TASK WHERE !completed AND (file.frontmatter.event_id OR file.frontmatter.meeting_url)"
		);
		expect(block.startsWith(DASHBOARD_START)).toBe(true);
		expect(block.endsWith(DASHBOARD_END)).toBe(true);
	});

	it("renders upcoming and past meetings via plugin blocks, not Dataview", () => {
		const block = buildDashboardBlock();
		expect(block).toContain("## Upcoming meetings");
		expect(block).toContain("```" + UPCOMING_BLOCK_LANG);
		expect(block).toContain("## Past meetings");
		expect(block).toContain("```" + PAST_BLOCK_LANG);
		// The old Dataview upcoming/past queries are gone.
		expect(block).not.toContain("date(start) >= date(now)");
		expect(block).not.toContain("date(start) < date(now)");
		expect(block).not.toContain("SORT date(start) ASC");
		expect(block).not.toContain("SORT date(start) DESC");
	});
});

describe("withDashboardBlock", () => {
	it("appends the block when absent", () => {
		const out = withDashboardBlock("# Dashboard", buildDashboardBlock());
		expect(out).toContain("# Dashboard");
		expect(out).toContain(DASHBOARD_START);
	});

	it("replaces an existing managed block, leaving surrounding text", () => {
		const first = withDashboardBlock(
			"# Dashboard\n\nintro\n",
			buildDashboardBlock()
		);
		const second = withDashboardBlock(first, buildDashboardBlock());
		expect(second).toContain("intro");
		// Only one managed block remains.
		expect(second.split(DASHBOARD_START).length - 1).toBe(1);
	});
});
