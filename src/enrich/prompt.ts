import { resolveCustomizable } from "../util/customizable";

/** Context assembled from the meeting note and calendar frontmatter. */
export interface EnrichmentContext {
	title: string;
	date: string;
	attendees: string;
	notes: string;
	/** The participant's own, hand-written action items (one per line). */
	actionItems: string;
	/** Meeting-wide hand-written follow-ups (one per line). */
	followUps: string;
	transcript: string;
}

/** Fixed system role; the editable part is the user prompt below. */
export const ENRICH_SYSTEM_PROMPT =
	"You are an expert meeting-notes assistant. You distill a participant's raw " +
	"notes and a meeting transcript into concise, faithful notes a busy " +
	"colleague can skim in under a minute. You favor signal over completeness: " +
	"short, telegraphic bullets, no filler, no meta-commentary. You never " +
	"invent facts.";

/** Default, Granola-style user prompt. Placeholders are filled by fillPrompt(). */
export const DEFAULT_ENRICH_PROMPT = `Meeting: {{title}}
Date: {{date}}
Attendees: {{attendees}}

The participant's own notes, typed by hand (may be sparse or empty). These are authoritative, the same way the hand-written action items below are: the participant personally attended and wrote each point deliberately, so every one must survive into the output as its own bullet — you may only refine its wording for clarity, correct an obvious error, and fold in one concrete supporting detail from the transcript (a name, date, or number). Never merge a note away into a differently-worded sentence, summarize it into something vaguer, or drop it, no matter how terse it is ("Discussed pricing") or how little the transcript elaborates on it:
"""
{{notes}}
"""

The participant's own action items, typed by hand (may be empty). These are authoritative: the participant explicitly wrote each one, so treat them as a committed to-do list you must preserve:
"""
{{actionItems}}
"""

Meeting-wide follow-ups already typed by hand under the Follow-ups section (may be empty). These are authoritative shared commitments — preserve every one (you may only refine wording / fold in a concrete detail):
"""
{{followUps}}
"""

Transcript (may be empty):
"""
{{transcript}}
"""

Write concise, skimmable meeting notes in Markdown. A reader should get the gist in under a minute. Prefer fewer, sharper bullets over exhaustive coverage — this is a summary, not a transcript.

Structure:
- Open with a "### TL;DR" section: 2–4 short bullets capturing the essence — main outcome, key decisions, and anything urgent.
- Follow with a handful of thematic sections (aim for 3–6, not one per tangent). Give each a short, descriptive "### " heading named in its own terms (for example "### Entity model"). Invent fitting headings; do not use generic labels like "Key points", "Discussion", or "Decisions".
- Under each heading use a few terse "- " bullets — sentence fragments, not full sentences. Merge related points into one bullet; never split a single idea across several.
- Nest a sub-bullet ("  - ") only when a point truly needs one concrete detail (a number, name, or example). Never go deeper than one level, and use nesting sparingly.
- Mark provenance with Obsidian's highlight syntax: wrap a bullet's full text in \`==like this==\` whenever it's carried over from the participant's own written notes, action items, or follow-ups (per the rules below), so it's visually obvious at a glance which lines are literally theirs versus drawn from the transcript. Never highlight a bullet you wrote yourself from the transcript alone; never highlight only part of a carried-over bullet — the whole bullet or none of it.
- Place every one of the participant's own notes as its own **highlighted** bullet under whichever thematic section it belongs to (its own short bullet in TL;DR if none fits) — refine-only, same rule as the hand-written notes above; never dissolve one into a merged, reworded sentence alongside transcript content, and never drop it just because it's terse or the transcript adds little detail. You're free to add further bullets to that section from the transcript, and whole sections/bullets the notes never mentioned — losing something the participant deliberately wrote is worse than an extra bullet.
- Finish with TWO closing sections, in this order:
  1. "### Next steps" — the participant's unified personal to-do list, built in two steps. FIRST, carry over EVERY hand-written action item listed above — never drop, merge away, or omit one, even if it looks incomplete or would not otherwise qualify below; you may only refine its wording for clarity, correct an obvious error, and fold in one concrete detail from the transcript (a name, date, or number). Format each as "- ==**Concise task**==" (highlighted). THEN append any ADDITIONAL concrete tasks the participant themselves still has to do — things they personally committed to and have not started yet. Format each as "- **Concise task**" (not highlighted — these are yours, not theirs). The participant is the author of these notes (the "Me" speaker when the transcript is labeled "Me:"/"Them:"); otherwise infer from the notes and context. The following exclusions apply ONLY to the additional tasks, never to the hand-written items: exclude work already underway or described as ongoing, anything owned by or delegated to someone else, decisions, status, general follow-ups, and passive "waiting for"/"awaiting X" items; and never phrase an added task as continuing, keeping, maintaining, or improving something already in progress (no "Continue …", "Keep …", "Maintain …", "Keep polishing …") — drop those entirely rather than rewording them into tasks. When you cannot tell that the participant personally owns a discrete, not-yet-started task, leave it out. Omit the whole section only when there are neither hand-written action items nor such additional tasks — never pad it.
  2. "### Follow-ups" — meeting-wide commitments that are NOT the participant's personal Next steps. FIRST, carry over EVERY hand-written follow-up listed above (same refine-only rule). Format each as "- ==**Owner:** concise task==" or "- ==concise task==" with no owner (highlighted). THEN append additional concrete, not-yet-started commitments owned by someone else or by the group. Format each as "- **Owner:** concise task" when the owner is clear from the notes, transcript, or attendees list; otherwise "- concise task" with no owner (not highlighted — these are yours, not theirs). Use a short given name or how they appear in Attendees — never invent people. Exclude the participant's own tasks (those belong only in Next steps), decisions, status updates, and passive "waiting for" items. Omit the whole section when there are neither hand-written follow-ups nor such commitments — never pad it.

Keep it tight:
- Match length to substance: a short meeting yields a short note. Do not pad. As a rough ceiling, keep the whole thing well under one screen of text for a typical 30-minute meeting.
- Cover what matters and drop the rest: skip small talk, greetings, scheduling back-and-forth, and tangents that don't change any decision — this trimming never applies to the participant's own notes, action items, or follow-ups, which must always be kept per the rules above.
- Write the substance directly. Never refer to "the meeting", "this session", "the call", "the transcript", "the recording", or "the notes", and never comment on what was or wasn't said, recorded, or discussed.
- Never open a bullet with filler like "Discussed", "Noted that", "Acknowledged", "Talked about", "Mentioned", or "The point was raised" — state the fact itself.
- If there is little or no substantive content, output only the little that exists (a short TL;DR with a bullet or two) and nothing more.
- Ground every statement in the notes and/or transcript; never invent facts, names, numbers, or decisions. When they conflict, prefer the participant's notes.
- Do not quote the transcript verbatim or narrate it turn by turn.
- Output only the Markdown notes — no preamble, no closing remarks, and no top-level "#" heading.`;

/**
 * Appended to the enrich user prompt when we also want an ad-hoc title from the
 * same LLM call. Asks for a machine-readable trailer that
 * {@link extractEmbeddedTitle} strips before the notes are inserted.
 */
export const ADHOC_TITLE_PROMPT_SUFFIX = `

Also suggest a concise, specific title for this meeting — at most 8 words, in Title Case. Do not include dates, quotes, markdown, or trailing punctuation. After the notes, end your entire output with exactly one final line of this form (and nothing after it):
<!--mc-title: Your Title Here-->`;

/** Matches a trailing `<!--mc-title: …-->` line produced when the title suffix is requested. */
const EMBEDDED_TITLE_RE =
	/(?:^|\n)[ \t]*<!--\s*mc-title:\s*([^>]*?)\s*-->[ \t]*$/i;

/**
 * Splits an enrich model response into the notes body and an optional embedded
 * title. The title trailer is removed from the body so it never lands in the
 * AI-notes callout. Only a trailing marker counts — mid-body mentions are left alone.
 */
export function extractEmbeddedTitle(raw: string): {
	body: string;
	title: string | null;
} {
	const trimmed = raw.trimEnd();
	const match = trimmed.match(EMBEDDED_TITLE_RE);
	if (!match) {
		return { body: trimmed, title: null };
	}
	const title = match[1]?.trim() || null;
	const body = trimmed.slice(0, match.index).trimEnd();
	return { body, title };
}

const PLACEHOLDER =
	/\{\{(title|date|attendees|notes|actionItems|followUps|transcript)\}\}/g;

/** Rough token estimate used for enrichment prompt budgeting (#22). */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Marker inserted when the transcript is middle-truncated to fit the enrich
 * prompt budget. Visible in the prompt so the model (and logs) know content
 * was omitted.
 */
export const TRANSCRIPT_TRUNCATION_MARKER =
	"\n\n[… transcript truncated for enrichment …]\n\n";

/**
 * Keeps the opening and closing of a long transcript and drops the middle when
 * the estimated token count exceeds `maxTokens`. Under budget → unchanged.
 */
export function truncateTranscriptForBudget(
	transcript: string,
	maxTokens: number
): { text: string; truncated: boolean } {
	if (maxTokens <= 0 || estimateTokens(transcript) <= maxTokens) {
		return { text: transcript, truncated: false };
	}
	const marker = TRANSCRIPT_TRUNCATION_MARKER;
	const markerTokens = estimateTokens(marker);
	const budget = Math.max(64, maxTokens - markerTokens);
	const keepChars = budget * 4;
	const headChars = Math.floor(keepChars / 2);
	const tailChars = keepChars - headChars;
	const head = transcript.slice(0, headChars);
	const tail = transcript.slice(Math.max(headChars, transcript.length - tailChars));
	return { text: `${head.trimEnd()}${marker}${tail.trimStart()}`, truncated: true };
}

/** Fills a prompt template with the context, defaulting empty fields to "(none)". */
export function fillPrompt(
	template: string,
	ctx: EnrichmentContext,
	opts?: { maxTranscriptTokens?: number }
): string {
	const maxTranscriptTokens = opts?.maxTranscriptTokens;
	const transcript =
		typeof maxTranscriptTokens === "number"
			? truncateTranscriptForBudget(ctx.transcript, maxTranscriptTokens).text
			: ctx.transcript;
	const filled: EnrichmentContext = { ...ctx, transcript };
	return template.replace(PLACEHOLDER, (_m, key: keyof EnrichmentContext) => {
		const value = filled[key];
		return value && value.trim().length > 0 ? value : "(none)";
	});
}

/**
 * The prompt to send to the model. The default is *never persisted* — it's read
 * live from {@link DEFAULT_ENRICH_PROMPT} here — so any improvement to the
 * default automatically reaches everyone who hasn't opted into customizing.
 * Only when `customize` is on AND a non-empty custom prompt is stored do we use
 * that instead; a blank custom prompt falls back to the default too.
 */
export function effectiveEnrichPrompt(
	customize: boolean,
	custom: string | null | undefined
): string {
	return resolveCustomizable(customize, custom, DEFAULT_ENRICH_PROMPT);
}
