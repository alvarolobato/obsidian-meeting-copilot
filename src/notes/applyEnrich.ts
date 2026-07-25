import { refreshActionItems, stampCreatedDate } from "./actionItems";
import {
	extractSection,
	extractTranscript,
	withEnrichedBlock,
} from "./enrichedBlock";
import { normalizeManualNotes } from "./manualNotes";
import {
	stripTranscript,
	transcriptAtBottom,
	upsertSection,
} from "./meetingNote";

const ACTION_ITEMS_HEADING = "## Action items";
const FOLLOW_UPS_HEADING = "## Follow-ups";

export interface ApplyEnrichParams {
	/** LLM callout body (already stripped of any embedded title trailer). */
	calloutBody: string;
	/** When true, lift Next steps / Follow-ups into ## sections as tasks. */
	actionItemsAsTasks: boolean;
	/** Today's `YYYY-MM-DD` stamp for fresh task creation dates. */
	todayStamp: string;
	extractActionItems: (body: string) => { items: string[]; without: string };
	extractFollowUps: (body: string) => { items: string[]; without: string };
}

/**
 * Pure post-LLM enrich transform: apply callout + optional action/follow-up
 * sections against the *current* note body. Safe to run inside
 * `vault.process` so concurrent user edits aren't clobbered (#19).
 */
export function applyEnrichToContent(
	current: string,
	p: ApplyEnrichParams
): string {
	const bottomTranscript = extractTranscript(current);
	let updated = bottomTranscript.trim().length
		? stripTranscript(current)
		: current;
	updated = normalizeManualNotes(updated).content;
	let calloutBody = p.calloutBody;
	if (p.actionItemsAsTasks) {
		const actions = p.extractActionItems(calloutBody);
		calloutBody = actions.without;
		const followUps = p.extractFollowUps(calloutBody);
		calloutBody = followUps.without;
		if (actions.items.length > 0) {
			const existing = extractSection(updated, ACTION_ITEMS_HEADING);
			const merged = stampCreatedDate(
				refreshActionItems(existing, actions.items).split("\n"),
				p.todayStamp
			).join("\n");
			updated = upsertSection(updated, ACTION_ITEMS_HEADING, merged);
		}
		if (followUps.items.length > 0) {
			const existing = extractSection(updated, FOLLOW_UPS_HEADING);
			const merged = stampCreatedDate(
				refreshActionItems(existing, followUps.items).split("\n"),
				p.todayStamp
			).join("\n");
			updated = upsertSection(updated, FOLLOW_UPS_HEADING, merged);
		}
	}
	updated = withEnrichedBlock(updated, calloutBody);
	if (bottomTranscript.trim().length) {
		updated = transcriptAtBottom(updated, bottomTranscript);
	}
	return updated;
}
