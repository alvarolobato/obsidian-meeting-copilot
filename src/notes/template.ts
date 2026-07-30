import { moment } from "obsidian";
import type { MeetingEventInfo } from "./meetingNote";

/** Matches `{{name}}` or `{{name:format}}` placeholders. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)(?::([^}]+))?\s*\}\}/g;

const minutesBetween = (ev: MeetingEventInfo): number =>
	Math.max(0, Math.round((ev.end.getTime() - ev.start.getTime()) / 60000));

/**
 * Resolvers for every supported placeholder. Each receives the meeting and the
 * optional `:format` argument and returns the substituted text. A token with no
 * entry here resolves to an empty string.
 *
 * Supported: `title`, `date`, `start[:FMT]`, `end[:FMT]`, `duration`,
 * `location`, `meeting_url`, `organizer`, `attendees`, `attendees_list`,
 * `attendees_wikilinks`, `uid`, `event_id`, `event_link`, `year`, `month`,
 * `series` (the event summary; intended for folder templates, not note bodies).
 */
const RESOLVERS: Record<
	string,
	(ev: MeetingEventInfo, fmt?: string) => string
> = {
	title: (ev) => ev.summary,
	series: (ev) => ev.summary,
	date: (ev) => moment(ev.start).format("YYYY-MM-DD"),
	start: (ev, fmt) => moment(ev.start).format(fmt || "HH:mm"),
	end: (ev, fmt) => moment(ev.end).format(fmt || "HH:mm"),
	duration: (ev) => String(minutesBetween(ev)),
	location: (ev) => ev.location,
	meeting_url: (ev) => ev.meetLink ?? "",
	organizer: (ev) => ev.organizer ?? "",
	attendees: (ev) => ev.attendees.join(", "),
	attendees_list: (ev) => ev.attendees.map((a) => `- ${a}`).join("\n"),
	attendees_wikilinks: (ev) => ev.attendees.map((a) => `[[${a}]]`).join(", "),
	uid: (ev) => ev.iCalUID ?? "",
	event_id: (ev) => ev.id,
	event_link: (ev) => ev.htmlLink,
	year: (ev) => moment(ev.start).format("YYYY"),
	month: (ev) => moment(ev.start).format("MM"),
};

/**
 * Substitutes `{{placeholder}}` tokens in `template` with values drawn from the
 * meeting. Unknown placeholders become empty strings.
 */
export function renderTemplate(template: string, ev: MeetingEventInfo): string {
	return renderTemplateWith(template, ev, (value) => value);
}

/**
 * Like {@link renderTemplate}, but every resolved value (with its token name) is
 * passed through `transform` before being inserted. Folder-template rendering
 * uses this to sanitize each token — so e.g. a `{{series}}` value containing "/"
 * can't inject an extra folder level — while literal "/" typed in the template
 * itself is left alone, since it never matches a `{{…}}` token.
 */
export function renderTemplateWith(
	template: string,
	ev: MeetingEventInfo,
	transform: (value: string, name: string) => string
): string {
	return template.replace(PLACEHOLDER, (_match, name: string, fmt?: string) => {
		const resolver = RESOLVERS[name];
		const value = resolver ? resolver(ev, fmt) : "";
		return transform(value, name);
	});
}
