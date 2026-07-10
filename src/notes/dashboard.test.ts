import { describe, expect, it } from "vitest";
import {
	buildDashboardBlock,
	DASHBOARD_END,
	DASHBOARD_START,
	withDashboardBlock,
} from "./dashboard";

describe("buildDashboardBlock", () => {
	it("uses the meetings folder as the Dataview source", () => {
		const block = buildDashboardBlock("Meetings/Work/");
		expect(block).toContain('FROM "Meetings/Work"');
		expect(block.startsWith(DASHBOARD_START)).toBe(true);
		expect(block.endsWith(DASHBOARD_END)).toBe(true);
		expect(block).toContain("TASK");
	});
});

describe("withDashboardBlock", () => {
	it("appends the block when absent", () => {
		const out = withDashboardBlock("# Dashboard", buildDashboardBlock("Meetings"));
		expect(out).toContain("# Dashboard");
		expect(out).toContain(DASHBOARD_START);
	});

	it("replaces an existing managed block, leaving surrounding text", () => {
		const first = withDashboardBlock(
			"# Dashboard\n\nintro\n",
			buildDashboardBlock("Meetings")
		);
		const second = withDashboardBlock(first, buildDashboardBlock("Other"));
		expect(second).toContain("intro");
		expect(second).toContain('FROM "Other"');
		expect(second).not.toContain('FROM "Meetings"');
		// Only one managed block remains.
		expect(second.split(DASHBOARD_START).length - 1).toBe(1);
	});
});
