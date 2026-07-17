/**
 * Previously shipped defaults for {@link DEFAULT_ENRICH_PROMPT}. A stored
 * `enrichPrompt` equal to one of these is an untouched default the user never
 * customized, so {@link upgradeEnrichPrompt} may safely replace it with the
 * current default — otherwise upgraders keep an old default that lacks newer
 * placeholders (e.g. `{{actionItems}}`) and never get the new behavior.
 *
 * Append (never edit) the outgoing text here whenever DEFAULT_ENRICH_PROMPT
 * changes, so every historical default keeps being recognized.
 */
export const LEGACY_ENRICH_PROMPTS: readonly string[] = [
	`Meeting: {{title}}
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

Write concise, skimmable meeting notes in Markdown. A reader should get the gist in under a minute. Prefer fewer, sharper bullets over exhaustive coverage — this is a summary, not a transcript.

Structure:
- Open with a "### TL;DR" section: 2–4 short bullets capturing the essence — main outcome, key decisions, and anything urgent.
- Follow with a handful of thematic sections (aim for 3–6, not one per tangent). Give each a short, descriptive "### " heading named in its own terms (for example "### Entity model"). Invent fitting headings; do not use generic labels like "Key points", "Discussion", or "Decisions".
- Under each heading use a few terse "- " bullets — sentence fragments, not full sentences. Merge related points into one bullet; never split a single idea across several.
- Nest a sub-bullet ("  - ") only when a point truly needs one concrete detail (a number, name, or example). Never go deeper than one level, and use nesting sparingly.
- Fold the participant's own notes into the relevant sections; never drop anything they wrote.
- Finish with a "### Next steps" section listing ONLY concrete tasks the participant themselves still has to do — things they personally committed to and have not started yet. Format each as "- **Concise task**". The participant is the author of these notes (the "Me" speaker when the transcript is labeled "Me:"/"Them:"); otherwise infer from the notes and context. This section is exclusively the participant's own to-do list, so exclude everything else: work already underway or described as ongoing, anything owned by or delegated to someone else, decisions, status, general follow-ups, and passive "waiting for"/"awaiting X" items. Never phrase a task as continuing, keeping, maintaining, or improving something already in progress (no "Continue …", "Keep …", "Maintain …", "Keep polishing …"); those describe ongoing work — drop them entirely rather than rewording them into tasks. When you cannot tell that the participant personally owns a discrete, not-yet-started task, leave it out. Omit the whole section entirely when there are no such tasks — never pad it.

Keep it tight:
- Match length to substance: a short meeting yields a short note. Do not pad. As a rough ceiling, keep the whole thing well under one screen of text for a typical 30-minute meeting.
- Cover what matters and drop the rest: skip small talk, greetings, scheduling back-and-forth, and tangents that don't change any decision.
- Write the substance directly. Never refer to "the meeting", "this session", "the call", "the transcript", "the recording", or "the notes", and never comment on what was or wasn't said, recorded, or discussed.
- Never open a bullet with filler like "Discussed", "Noted that", "Acknowledged", "Talked about", "Mentioned", or "The point was raised" — state the fact itself.
- If there is little or no substantive content, output only the little that exists (a short TL;DR with a bullet or two) and nothing more.
- Ground every statement in the notes and/or transcript; never invent facts, names, numbers, or decisions. When they conflict, prefer the participant's notes.
- Do not quote the transcript verbatim or narrate it turn by turn.
- Output only the Markdown notes — no preamble, no closing remarks, and no top-level "#" heading.`,
];
