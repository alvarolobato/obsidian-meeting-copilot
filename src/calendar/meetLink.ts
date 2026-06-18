export interface RawConferenceEvent {
	hangoutLink?: string;
	conferenceData?: {
		entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
	};
}

/** Extracts a Google Meet URL from a raw Calendar API event, or null when absent. */
export function extractMeetLink(raw: RawConferenceEvent): string | null {
	if (raw.hangoutLink) return raw.hangoutLink;
	const video = raw.conferenceData?.entryPoints?.find(
		(e) => e.entryPointType === "video" && !!e.uri
	);
	return video?.uri ?? null;
}
