import { requestUrl } from "obsidian";
import type { GoogleOAuth } from "../auth/googleOAuth";
import { extractMeetLink, RawConferenceEvent } from "./meetLink";

export interface GCalEvent {
	id: string;
	summary: string;
	location: string;
	start: Date;
	end: Date;
	allDay: boolean;
	meetLink: string | null;
	htmlLink: string;
}

export interface GCalCalendar {
	id: string;
	summary: string;
	primary: boolean;
}

const API = "https://www.googleapis.com/calendar/v3";

interface RawEvent extends RawConferenceEvent {
	id?: string;
	summary?: string;
	location?: string;
	htmlLink?: string;
	start?: { date?: string; dateTime?: string };
	end?: { date?: string; dateTime?: string };
}

async function authedGet(oauth: GoogleOAuth, url: string): Promise<unknown> {
	const token = await oauth.getAccessToken();
	const res = await requestUrl({
		url,
		method: "GET",
		headers: { Authorization: `Bearer ${token}` },
		throw: false,
	});
	if (res.status >= 400) {
		throw new Error(`Google API HTTP ${res.status}: ${res.text}`);
	}
	return res.json;
}

export async function listCalendars(oauth: GoogleOAuth): Promise<GCalCalendar[]> {
	const json = (await authedGet(oauth, `${API}/users/me/calendarList?maxResults=250`)) as {
		items?: Array<{ id?: string; summary?: string; primary?: boolean }>;
	};
	return (json.items ?? []).map((c) => ({
		id: c.id ?? "",
		summary: c.summary ?? "(no name)",
		primary: !!c.primary,
	}));
}

export async function listEvents(
	oauth: GoogleOAuth,
	calendarId: string,
	timeMin: Date,
	timeMax: Date,
	maxResults = 50
): Promise<GCalEvent[]> {
	const params = new URLSearchParams({
		timeMin: timeMin.toISOString(),
		timeMax: timeMax.toISOString(),
		maxResults: String(maxResults),
		singleEvents: "true",
		orderBy: "startTime",
	}).toString();
	const url = `${API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
	const json = (await authedGet(oauth, url)) as { items?: RawEvent[] };
	return (json.items ?? []).map((ev) => {
		const isAllDay = !!ev.start?.date;
		const start = isAllDay
			? new Date((ev.start?.date ?? "") + "T00:00:00")
			: new Date(ev.start?.dateTime ?? "");
		const end = isAllDay
			? new Date((ev.end?.date ?? "") + "T00:00:00")
			: new Date(ev.end?.dateTime ?? "");
		return {
			id: ev.id ?? "",
			summary: ev.summary ?? "(no title)",
			location: ev.location ?? "",
			start,
			end,
			allDay: isAllDay,
			meetLink: extractMeetLink(ev),
			htmlLink: ev.htmlLink ?? "",
		};
	});
}
