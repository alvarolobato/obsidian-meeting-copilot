import { describe, expect, it } from "vitest";
import {
	anchoredScrollTop,
	isForeignScroll,
	needsScrollAdjust,
} from "./scrollAnchor";

describe("anchoredScrollTop", () => {
	it("leaves the scroller alone when the anchor did not move", () => {
		expect(
			anchoredScrollTop({
				scrollTop: 800,
				anchorOffset: 320,
				targetOffset: 320,
				maxScrollTop: 4000,
			})
		).toBe(800);
	});

	it("scrolls up when the new page is shorter and the anchor rose", () => {
		// Seven fewer rows (~40px each) under the toolbar: it now sits 280px
		// higher, so scrolling up by 280 puts it back where it was.
		expect(
			anchoredScrollTop({
				scrollTop: 1000,
				anchorOffset: 40,
				targetOffset: 320,
				maxScrollTop: 4000,
			})
		).toBe(720);
	});

	it("scrolls down when the new page is taller and the anchor sank", () => {
		expect(
			anchoredScrollTop({
				scrollTop: 1000,
				anchorOffset: 500,
				targetOffset: 320,
				maxScrollTop: 4000,
			})
		).toBe(1180);
	});

	it("clamps at the top instead of going negative", () => {
		expect(
			anchoredScrollTop({
				scrollTop: 50,
				anchorOffset: 10,
				targetOffset: 400,
				maxScrollTop: 4000,
			})
		).toBe(0);
	});

	it("clamps to the scroller's current maximum", () => {
		// Mid-rebuild the document is short, so the ask is unreachable; the
		// caller re-applies once the real height lands.
		expect(
			anchoredScrollTop({
				scrollTop: 300,
				anchorOffset: 900,
				targetOffset: 100,
				maxScrollTop: 420,
			})
		).toBe(420);
	});

	it("treats a non-scrollable scroller as pinned to the top", () => {
		expect(
			anchoredScrollTop({
				scrollTop: 0,
				anchorOffset: 500,
				targetOffset: 100,
				maxScrollTop: -30,
			})
		).toBe(0);
	});

	it("converges: re-applying a settled measurement is a no-op", () => {
		const first = anchoredScrollTop({
			scrollTop: 1000,
			anchorOffset: 40,
			targetOffset: 320,
			maxScrollTop: 4000,
		});
		// After the write, the anchor measures at the target offset again.
		expect(
			anchoredScrollTop({
				scrollTop: first,
				anchorOffset: 320,
				targetOffset: 320,
				maxScrollTop: 4000,
			})
		).toBe(first);
	});

	it("keeps the current position when a measurement is not a number", () => {
		expect(
			anchoredScrollTop({
				scrollTop: 640,
				anchorOffset: Number.NaN,
				targetOffset: 320,
				maxScrollTop: 4000,
			})
		).toBe(640);
	});

	it("ignores a non-finite maximum rather than clamping to zero", () => {
		expect(
			anchoredScrollTop({
				scrollTop: 100,
				anchorOffset: 300,
				targetOffset: 100,
				maxScrollTop: Number.NaN,
			})
		).toBe(300);
	});
});

describe("needsScrollAdjust", () => {
	it("ignores sub-pixel drift", () => {
		expect(needsScrollAdjust(1000, 1000.25)).toBe(false);
	});

	it("reports a real move", () => {
		expect(needsScrollAdjust(1000, 1004)).toBe(true);
	});

	it("honours a custom epsilon", () => {
		expect(needsScrollAdjust(1000, 1003, 5)).toBe(false);
	});
});

describe("isForeignScroll", () => {
	it("accepts the value we wrote ourselves", () => {
		expect(isForeignScroll(1000, 1000)).toBe(false);
	});

	it("tolerates sub-pixel settling of our own write", () => {
		expect(isForeignScroll(1000.5, 1000)).toBe(false);
	});

	it("detects the user scrolling mid-settle", () => {
		expect(isForeignScroll(1240, 1000)).toBe(true);
	});
});
