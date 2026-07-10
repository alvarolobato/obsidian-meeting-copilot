/** Context assembled from the meeting note and calendar frontmatter. */
export interface EnrichmentContext {
	title: string;
	date: string;
	attendees: string;
	notes: string;
	transcript: string;
}

/** Fixed system role; the editable part is the user prompt below. */
export const ENRICH_SYSTEM_PROMPT =
	"You are an expert meeting-notes assistant. You turn a participant's raw " +
	"notes and a meeting transcript into clear, faithful, well-organized notes " +
	"that capture everything of substance that was discussed, grouped under " +
	"descriptive topic headings. You never invent facts, and you write the kind " +
	"of notes a busy colleague would actually want to read.";

/** Default, Granola-style user prompt. Placeholders are filled by fillPrompt(). */
export const DEFAULT_ENRICH_PROMPT = `Meeting: {{title}}
Date: {{date}}
Attendees: {{attendees}}

The participant's own notes (may be sparse or empty):
"""
{{notes}}
"""

Transcript (may be empty):
"""
{{transcript}}
"""

Write clear, well-organized meeting notes in Markdown that someone who missed the meeting could read to understand what was discussed and decided. Capture every substantive topic — including tangents and seemingly unrelated ones — but skip pure small talk, greetings, and scheduling back-and-forth.

Structure the notes as thematic sections:
- Give each section a short, descriptive "### " heading that names the topic in the meeting's own terms (for example "### Entity model and design consistency"). Invent fitting headings; do not use generic labels like "Key points", "Summary", or "Decisions".
- Under each heading use "- " bullets, with indented sub-bullets ("  - ") for supporting detail, examples, names, reasoning, and concrete references.
- Fold the participant's own notes into the relevant sections and expand on them; never drop anything they wrote.
- Finish with a "### Next steps" section listing action items as "- **Concise task** (Owner)", optionally followed by an indented sub-bullet with context. Use an attendee's name as the owner when the discussion makes it clear; otherwise omit it. Omit the whole section if there are genuinely no action items.

Rules:
- Ground every statement in the notes and/or transcript; never invent facts, names, numbers, or decisions.
- When the notes and transcript conflict, prefer the participant's notes.
- Be substantive but tight: do not quote the transcript verbatim or narrate it turn by turn.
- Output only the Markdown notes — no preamble, no closing remarks, and no top-level "#" heading.`;

const PLACEHOLDER = /\{\{(title|date|attendees|notes|transcript)\}\}/g;

/** Fills a prompt template with the context, defaulting empty fields to "(none)". */
export function fillPrompt(template: string, ctx: EnrichmentContext): string {
	return template.replace(PLACEHOLDER, (_m, key: keyof EnrichmentContext) => {
		const value = ctx[key];
		return value && value.trim().length > 0 ? value : "(none)";
	});
}
