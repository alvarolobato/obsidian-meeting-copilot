/**
 * Scroll-anchoring arithmetic for the dashboard's re-rendered sections.
 *
 * Every paginated dashboard section (Past meetings, Open action items,
 * Meeting follow-ups) rebuilds its whole element on a page change, and the
 * new page is almost never the same height as the old one — a last page with
 * three rows instead of ten, task text that wraps onto a second line, a
 * different per-page size. Restoring the scroller's *absolute* `scrollTop`
 * therefore pins the section's **top** edge and lets everything below it —
 * including the pagination toolbar the user just clicked — slide up or down
 * by the height delta.
 *
 * The fix is to anchor on an element instead of on a number: remember where
 * the anchor sat relative to the scroller's top edge, then after the rebuild
 * nudge `scrollTop` by however far that anchor moved. Kept DOM-free here so
 * the arithmetic is unit-testable; `main.ts` owns the measuring and the
 * settle loop.
 */

/** One re-anchoring measurement: where the anchor was, and where it is now. */
export interface ScrollAnchorState {
	/** The scroller's current `scrollTop`, in px. */
	scrollTop: number;
	/** The anchor's current top edge, relative to the scroller's top edge. */
	anchorOffset: number;
	/** The anchor's top edge before the re-render — the offset to restore. */
	targetOffset: number;
	/** Largest `scrollTop` the scroller currently allows (`scrollHeight - clientHeight`). */
	maxScrollTop: number;
}

/**
 * The `scrollTop` that puts the anchor back at `targetOffset`, clamped into
 * the scroller's range.
 *
 * Scrolling down by `d` moves content up by `d`, so restoring an anchor that
 * has drifted to `anchorOffset` means adding `anchorOffset - targetOffset` to
 * `scrollTop`. Clamping matters as much as the delta: mid-rebuild the
 * document can be far shorter than its final height (an emptied section,
 * task rows whose markdown hasn't rendered yet), and the browser silently
 * clamps any write past `maxScrollTop` — which is how a restore near the
 * bottom of the dashboard used to lose the position outright. Callers
 * re-apply this as the height settles, and because the result is expressed
 * against the *current* measurement it converges instead of fighting itself.
 *
 * Non-finite inputs (a detached element measured as `NaN`) leave the
 * scroller where it is rather than jumping it to 0.
 */
export function anchoredScrollTop(state: ScrollAnchorState): number {
	const max = Number.isFinite(state.maxScrollTop)
		? Math.max(0, state.maxScrollTop)
		: Number.POSITIVE_INFINITY;
	const current = Number.isFinite(state.scrollTop) ? state.scrollTop : 0;
	const delta = state.anchorOffset - state.targetOffset;
	if (!Number.isFinite(delta)) return clamp(current, max);
	return clamp(current + delta, max);
}

function clamp(value: number, max: number): number {
	return Math.min(Math.max(value, 0), max);
}

/**
 * Whether a computed `scrollTop` is worth writing back. Sub-pixel layout
 * makes the measured offset wobble by a fraction of a px even when nothing
 * moved, and writing `scrollTop` on every settle tick would cancel smooth
 * scrolling and burn layout passes for no visible change.
 */
export function needsScrollAdjust(
	current: number,
	next: number,
	epsilon = 0.5
): boolean {
	return Math.abs(next - current) > epsilon;
}

/**
 * Whether the scroller moved by something other than us since our last write
 * — i.e. the user grabbed the wheel/scrollbar while the section was still
 * settling. The settle loop stops on this, so re-anchoring never fights a
 * deliberate scroll. The tolerance absorbs the sub-pixel drift that
 * {@link needsScrollAdjust} deliberately leaves unwritten.
 */
export function isForeignScroll(
	observed: number,
	lastWritten: number,
	tolerance = 2
): boolean {
	return Math.abs(observed - lastWritten) > tolerance;
}
