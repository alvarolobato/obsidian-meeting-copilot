// English locale.
export const en = {
	ribbon: {
		toggleRecording: "Start/Stop on-demand meeting",
		openAgenda: "Open meeting agenda",
		openDashboard: "Open meetings dashboard",
		recordForMeeting: (title: string) => `Record for “${title}”`,
		newAdhoc: "New ad-hoc meeting",
	},
	commands: {
		startRecording: "Start unplanned meeting",
		stopRecording: "Stop recording",
		authenticateCalendar: "Authenticate calendar",
		toggleCalendarAutoRecording: "Toggle calendar auto-recording",
		openAgenda: "Open meeting agenda",
		openDashboard: "Open meetings dashboard",
		enrichNote: "Enrich meeting note (AI)",
		toggleAiNotes: "Toggle AI notes visibility",
		cleanupRecordings: "Clean up old recordings",
		cancelTranscription: "Cancel transcription",
		fixMeetingMetadata: "Fix meeting metadata for this note",
	},
	menu: {
		fixMetadataFile: "Fix meeting metadata",
		fixMetadataFolder: "Fix meeting metadata for this folder",
	},
	adhoc: {
		defaultTitle: "Meeting",
		started: "Recording unplanned meeting — rename the note title if you like",
		suggestingTitle: "Suggesting a title…",
		titleModal: {
			heading: "Rename this meeting?",
			desc: "Suggested title based on the discussion. Edit it or keep the current name.",
			rename: "Rename",
			keep: "Keep current",
			renamed: (name: string) => `Renamed to “${name}”`,
			failed: "Couldn't suggest a title",
		},
	},
	detect: {
		detected: (app: string) => `${app} meeting detected`,
		recordPrompt: "Create note & record",
		ended: (app: string) => `${app} meeting ended`,
	},
	notices: {
		autoRecordEnabled: "Calendar auto-recording enabled",
		autoRecordDisabled: "Calendar auto-recording disabled",
		// One-time tip shown the first time a meeting notification fires.
		notificationStyleHint:
			"Tip: if meeting prompts land only in Notification Center, it's a macOS setting — turn off Do Not Disturb / Focus and set Obsidian to “Alerts” so they pop up on screen (with a button).",
		openNotificationSettings: "Open settings",
		recordingError: (msg: string) => `Recording error: ${msg}`,
		screenPermission:
			"Recording failed: Screen Recording isn't authorized. Opening System Settings → Privacy & Security → Screen Recording — enable Obsidian there, then fully quit and reopen it. (macOS requires this for capturing system audio.)",
		alreadyRecording: "Already recording",
		macOnly: "System recording is only supported on macOS",
		downloadingHelper: "Downloading recorder helper…",
		downloadingModel: "Downloading local Whisper model…",
		downloadingRuntime: "Downloading recorder components…",
		localFallback:
			"Local transcription failed — falling back to the remote service.",
		localFallbackNoDiarization:
			"Local transcription failed — falling back to the remote service (without speaker separation).",
		micUnavailable: (device: string) =>
			`Microphone "${device}" isn't available — recording with the system default.`,
		recordingStarted: "Recording started",
		notRecording: "Not recording",
		stoppingRecording: "Stopping recording…",
		calendarError: (msg: string) => `Calendar error: ${msg}`,
		calendarReconnect: "Google Calendar disconnected — reconnect",
		calendarReconnectAction: "Reconnect",
		recordingSaved: "Recording saved",
		silentDiscarded: "No speech detected — recording discarded",
		autoTranscribeNotIndexed:
			"Recording saved, but auto-transcription could not start (the file never appeared in the vault index). Transcribe it from the agenda.",
		unknownError: "Unknown error",
		transcriptAdded: (note: string) => `Transcript added to ${note}`,
		enriching: "Enriching meeting note…",
		enrichDone: (note: string) => `Enriched ${note}`,
		enrichError: (msg: string) => `Enrichment failed: ${msg}`,
		enrichTimeout: (note: string, seconds: number) =>
			`Enrichment timed out for ${note} after ${seconds}s — increase the timeout in settings or retry`,
		endpointFallbackEnrich:
			"Primary AI endpoint failed — retrying enrichment on the fallback…",
		endpointFallbackTranscribe:
			"Primary AI endpoint failed — retrying transcription on the fallback…",
		endpointFallbackTranscribeNoDiarization:
			"Primary AI endpoint failed — retrying transcription on the fallback (without speaker separation)…",
		enrichNotConfigured:
			"Set the AI endpoint (base URL + API key) and an enrichment model in settings first.",
		enrichDisabled: "AI enrichment is disabled in settings.",
		enrichInProgress: "This note is already being enriched…",
		nothingToEnrich: "No notes or transcript to enrich in this note.",
		notAMeetingNote: "Open a meeting note to enrich it.",
		aiNotesHidden: "AI notes hidden",
		aiNotesShown: "AI notes shown",
		retentionDisabled:
			"Recording retention is off. Set a positive number of days in settings.",
		retentionCleaned: (n: number) =>
			`Trashed ${n} old recording${n === 1 ? "" : "s"}`,
		retentionNothing: "No recordings past the retention window.",
		transcribeError: (msg: string) => `Transcription failed: ${msg}`,
		transcribeEmpty: "Transcription produced no text.",
		transcribePartial:
			"Transcription only partially succeeded — not inserted. Try again.",
		retranscribeIncomplete:
			"Couldn't re-transcribe every take — kept the existing transcript. Try again.",
		transcribeInProgress: "This recording is already being transcribed…",
		transcribeQueued: (name: string) => `Queued "${name}" for transcription`,
		transcribeCancelled: "Transcription cancelled",
		nothingTranscribing: "No transcription is running.",
		recordingsPending: (n: number) =>
			`${n} recording${n === 1 ? "" : "s"} still need transcribing — open the meetings dashboard to finish them.`,
		transcribeNoNote: (audio: string) =>
			`Transcribed "${audio}" but found no meeting note to add it to.`,
		transcribeNoEndpoint:
			"Set the AI endpoint (base URL + API key) in settings before transcribing.",
		diarizationNoTimestamps:
			"Speaker separation was skipped: the endpoint returned no timestamps this time. Run 'Load models' to re-check.",
		diarizationNoTracks:
			"No separate speaker tracks were recorded for this meeting — transcribing the single joint track instead.",
		metadataFixLabelOneOnOne: (name: string) => `your 1:1 with ${name}`,
		metadataFixLabelRecurring: (title: string) => `the "${title}" series`,
		metadataFixConfirm: (count: number, label: string) =>
			count === 1
				? `This note looks like it belongs to ${label} — tag it?`
				: `${count} notes here look like they belong to ${label} — tag them?`,
		metadataFixApply: "Tag it",
		metadataFixDismiss: "Not now",
		metadataFixDone: (count: number) =>
			count === 1 ? "Tagged 1 note." : `Tagged ${count} notes.`,
		metadataFixNoSignal:
			"Couldn't tell what this belongs to — no consistently-tagged note nearby.",
		metadataFixAlreadyTagged: "This note already has 1:1/series metadata.",
		metadataFixNothingToFix:
			"Every note in this folder already has 1:1/series metadata.",
		metadataFixAmbiguousOneOnOne: (name: string, count: number) =>
			`1:1 with ${name} (${count} note${count === 1 ? "" : "s"})`,
		metadataFixAmbiguousRecurring: (title: string, count: number) =>
			`the "${title}" series (${count} note${count === 1 ? "" : "s"})`,
		metadataFixAmbiguous: (labels: string) =>
			`This folder's notes don't agree on one identity — found: ${labels}. Clean it up manually, then try again.`,
	},
	transcript: {
		// Prepended to a speaker-separated transcript. Tells the enrichment model
		// who "Me"/"Them" are (so it can attribute action items) and reads fine to
		// a human skimming the note.
		speakerBanner:
			'[Speaker labels: "Me" is the note\'s author; "Them" are the other attendees.]',
	},
	statusBar: {
		recording: (hms: string) => `Recording ${hms}`,
		enriching: "Enriching notes…",
		enriched: "Notes enriched",
		enrichFailed: "Enrichment failed",
		transcribing: "Transcribing…",
		transcribingProgress: (pct: number) => `${pct}% transcribing…`,
		// Percent leads so it stays visible even as the meeting name (and any
		// queued suffix) gets truncated in the narrow status bar. The busy
		// spinner already signals "transcribing", so the verb is dropped.
		transcribingNamed: (name: string) => `${name}…`,
		transcribingNamedProgress: (name: string, pct: number) =>
			`${pct}% ${name}`,
		queued: (name: string) => `Queued: ${name}`,
		queuedCount: (name: string, n: number) => `${name}… (+${n} queued)`,
		/** Appended to the running progress line when jobs wait behind it. */
		queuedSuffix: (n: number) => ` (+${n} queued)`,
		queuePopoverTitle: "Background tasks",
		queueMore: (n: number) => `+${n} more`,
		transcribingCount: (n: number) => `transcribing ${n}`,
		/** Verbs shown per task kind in the queue popover rows. */
		queueKindTranscribe: "Transcribing",
		queueKindEnrich: "Enriching",
		/** Accessible label / tooltip for a popover row's cancel (x) control. */
		queueCancel: "Cancel",
		transcriptAdded: "Transcript added",
		transcribeFailed: "Transcription failed",
		transcribeCancelled: "Transcription cancelled",
		creatingNote: "Creating note…",
	},
	event: {
		started: (title: string) => `"${title}" has started`,
		ended: (title: string) => `"${title}" has ended`,
		startRecordingAction: "Start recording",
		createNoteAndRecord: "Create note and start recording",
		recordAgain: "Record again (new take)",
		stopRecordingAction: "Stop recording",
		// Meeting-start prompt (native notification / in-app notice).
		startsInMin: (min: number) =>
			`Starts in ${min} min${min === 1 ? "" : "s"}`,
		startingNow: "Starting now",
		startedMinAgo: (min: number) =>
			`Started ${min} min${min === 1 ? "" : "s"} ago`,
		// Web-notification fallback only (a web banner can't render buttons, so
		// it points the user into Obsidian). The native path omits this.
		notificationWebHint: "Open Obsidian to choose",
		// Body of the "meeting ended" system/in-app prompt (the action button
		// carries the verb; this is the question).
		stopRecordingPrompt: "Stop recording?",
		join: "Join",
		record: "Record",
		/** Primary record action when another take is already in progress. */
		recordStopsCurrent: "Record (stops current)",
		joinAndRecord: "Join & record",
		/** Join & record when another take is already in progress. */
		joinAndRecordStopsCurrent: "Join & record (stops current)",
		openNote: "Open note",
		dismiss: "Dismiss",
		autoStarted: (title: string) => `Recording "${title}"`,
		autoStopped: (title: string) => `"${title}" ended — recording stopped`,
	},
	agenda: {
		title: "Meetings",
		comingUp: "Coming up",
		notConnected: "Not connected",
		loading: "Loading…",
		lastRefreshed: (rel: string) => `Updated ${rel}`,
		connectPrompt: "Connect your Google Calendar to see meetings here.",
		connectCta: "Connect Google Calendar",
		connectConnecting: "Waiting for you to finish in the browser…",
		connectCancel: "Cancel",
		nothingScheduled: "Nothing scheduled.",
		noMeetings: "No meetings",
		nothingElse: "Nothing else scheduled",
		earlierToday: "Earlier today",
		todayLabel: "Today",
		tomorrowLabel: "Tomorrow",
		yesterdayLabel: "Yesterday",
		daysWithoutEvents: (n: number) =>
			`${n} ${n === 1 ? "day" : "days"} without events`,
		now: "Now",
		recording: "Recording",
		startsIn: (min: number) => `Starts in ${min} min`,
		attendeesCount: (n: number) => `${n} attendees`,
		refresh: "Refresh calendar",
		openSettings: "Open plugin settings",
		daysShown: "Days shown",
		previousDay: "Previous day",
		nextDay: "Next day",
		previousMonth: "Previous month",
		nextMonth: "Next month",
		actions: {
			record: "Create note and record",
			recordAgain: "Record again (new take)",
			stop: "Stop recording",
			stopping: "Stopping…",
			openNote: "Open note",
			createNote: "Create note",
			openLink: "Open meeting link",
			copyLink: "Copy meeting link",
			openRecording: "Open recording",
			transcribe: "Transcribe recording",
			transcribeDiarized: "Transcribe with speaker separation",
			transcribeMixed: "Transcribe without speaker separation",
			enrich: "Enrich with AI",
			skipToday: "Hide for today",
		},
		notices: {
			linkCopied: "Meeting link copied",
			noRecording: "No recording for this meeting yet",
		},
		menuTitle: "Meeting Copilot",
	},
	dashboard: {
		/** View tab title and the ribbon icon's tooltip. */
		title: "Meetings dashboard",
		sections: {
			past: "Past meetings",
			actions: "Open action items",
			followups: "Meeting follow-ups",
		},
		attention: {
			moreActions: "More actions",
			transcribeAndEnrich: "Transcribe & enrich",
		},
		controls: {
			perPage: "Per page",
			prev: "Previous",
			next: "Next",
			refresh: "Refresh",
			pageOf: (current: number, total: number) =>
				`${current} / ${total}`,
		},
		meetings: {
			pastCount: (n: number) =>
				`${n} past meeting${n === 1 ? "" : "s"}`,
			pastEmpty: "No meetings need attention, and nothing in the last couple of days.",
			noDate: "No date",
			loading: "Loading calendar…",
			calendarError: "Couldn't load calendar meetings; showing notes only.",
			createNote: "Create note",
			// Status labels double as the pill text on each row.
			status: {
				scheduled: "Scheduled",
				recorded: "Recorded",
				transcribed: "Transcribed",
				enriched: "Enriched",
			},
		},
		// Shared between "Open action items" and "Meeting follow-ups": how a
		// note's tasks are grouped into a section, and the category pill each
		// section's header carries.
		groups: {
			oneOnOne: (name: string) => `1:1 · ${name}`,
			category: {
				"one-on-one": "1:1",
				recurring: "Recurring",
				"ad-hoc": "Ad-hoc",
			},
			// Shared by both task sections — same table format for each.
			ageDays: (n: number) => (n === 1 ? "1 day old" : `${n} days old`),
		},
		actions: {
			count: (n: number) =>
				`${n} open action item${n === 1 ? "" : "s"}`,
			empty: "No open action items.",
			loading: "Scanning notes…",
			taskMoved: "That task has changed in its note; refreshing.",
			taskError: (msg: string) => `Couldn't complete the task: ${msg}`,
		},
		followups: {
			count: (n: number) =>
				`${n} open follow-up${n === 1 ? "" : "s"}`,
			empty: "No open meeting follow-ups.",
			emptyRecent: "No recent follow-ups.",
			loading: "Scanning notes…",
			showOlder: (n: number) =>
				`Show older (${n})`,
			hideOlder: "Hide older",
			taskMoved: "That follow-up has changed in its note; refreshing.",
			taskError: (msg: string) =>
				`Couldn't complete the follow-up: ${msg}`,
		},
	},
	settings: {
		// Version line at the top of the settings tab. Release builds show just
		// the version; custom/local builds append this marker with provenance.
		customBuild: "custom build",
		compressedRecordings: {
			name: "Compressed recordings (m4a)",
			desc: "Save recordings as AAC .m4a (~28 MB/hour) instead of WAV (~173 MB/hour). Same mono 24 kHz audio either way; transcription handles both. Only affects new recordings.",
		},
		microphone: {
			name: "Microphone",
			desc: "Input device for the 'Me' channel. Use the refresh button to list connected microphones. If the chosen device isn't available when recording starts, the system default is used.",
			systemDefault: "System default",
			refresh: "Refresh device list",
			unavailableOption: (device: string) => `${device} (unavailable)`,
		},
		oneOffFolderTemplate: {
			name: "One-off meetings folder",
			desc: "Folder template for a one-off meeting's note and recording. Tokens: {{year}}, {{month}}, {{date}}, {{title}}, {{series}}. Date-format tokens like {{start:YYYY/MM}} may create nested folders.",
		},
		seriesFolderTemplate: {
			name: "New series folder",
			desc: "Folder template used the first time a recurring meeting is seen. Later occurrences follow wherever that folder ends up. Tokens: {{year}}, {{month}}, {{date}}, {{title}}, {{series}}. Date-format tokens like {{start:YYYY/MM}} may create nested folders.",
		},
		oneOnOneSeparately: {
			name: "Handle 1:1s separately",
			desc: "Give each 1:1 (a meeting with exactly one other attendee) its own folder under 'One-on-one folder' instead of the series/one-off rules above.",
		},
		oneOnOneFolder: {
			name: "One-on-one folder",
			desc: "Parent folder for per-person 1:1 subfolders, used when 'Handle 1:1s separately' is on.",
		},
		adhocFolder: {
			name: "Ad-hoc meetings folder",
			desc: "Folder for notes from unplanned (ad-hoc or detected) meetings.",
		},
		recordingSubfolder: {
			name: "Recordings subfolder",
			desc: "Subfolder, relative to each note's own folder, where that meeting's recordings are stored (e.g. 'Recordings' → notes in 'Meetings/' record into 'Meetings/Recordings/'). Leave empty to keep audio beside the note.",
		},
		noteTitlePatternCustomize: {
			name: "Customize note title pattern",
		},
		noteTitlePattern: {
			name: "Note title pattern",
			desc: "Filename pattern for meeting notes. While Customize is off, the plugin uses its built-in pattern (which improves with each update); toggle it on to edit and store your own. Placeholders: {{title}}, {{date}}, {{start:FMT}}, {{end:FMT}}.",
		},
		noteTemplateCustomize: {
			name: "Customize note template",
		},
		noteTemplate: {
			name: "Note template",
			desc: "Body for new meeting notes. While Customize is off, the plugin uses its built-in template (which improves with each update); toggle it on to edit and store your own. Placeholders: {{title}}, {{date}}, {{start:FMT}}, {{end:FMT}}, {{duration}}, {{location}}, {{meeting_url}}, {{organizer}}, {{attendees}}, {{attendees_list}}, {{attendees_wikilinks}}, {{event_link}}. Frontmatter (attendees, status, recording, …) is managed automatically.",
		},
		insertTranscript: {
			name: "Insert transcript into meeting note",
			desc: "When transcription finishes, write the transcript into the matching meeting note's collapsible transcript section and mark it transcribed.",
		},
		autoTranscribe: {
			name: "Auto-transcribe when recording stops",
			desc: "When a meeting recording finishes, transcribe it automatically (no dialog) and add the transcript to the meeting note. Requires the shared AI endpoint (base URL + API key) above.",
		},
		discardSilentRecordings: {
			name: "Discard silent recordings",
			desc: "When a just-stopped recording has no speech (e.g. you started before anyone joined), move it to the trash and remove it from the note so you can record again right away. Uses the auto-transcribe result, so it needs auto-transcribe enabled.",
		},
		retentionDays: {
			name: "Recording retention (days)",
			desc: "Move recordings older than this many days to the trash (audio only). A recording linked to a meeting note is kept until that note is transcribed or enriched, so you never lose audio you haven't captured yet. Runs on startup and via the 'Clean up old recordings' command. 0 keeps recordings forever. Default for new installs is 15 days (existing settings are unchanged).",
		},
		actionItemsAsTasks: {
			name: "Action items as tasks",
			desc: "When enriching, lift the AI's Next steps into checkboxes under '## Action items' and meeting-wide Follow-ups under '## Follow-ups' so the obsidian-tasks plugin can track them. Existing and completed tasks are preserved. Fresh tasks are stamped with a creation date (➕).",
		},
		followUpHorizonDays: {
			name: "Follow-up horizon (days)",
			desc: "On the dashboard, hide open meeting follow-ups older than this many days by default (reveal with Show older). Keeps the list from growing without bound. 0 shows all follow-ups.",
		},
		suggestAdhocTitle: {
			name: "Suggest a title for unplanned meetings",
			desc: "When enriching an unplanned (ad-hoc or detected) meeting, ask the same LLM call for a title and offer to rename the note, keeping the date prefix. Scheduled meetings keep their calendar title.",
		},
		tabs: {
			general: "General",
			calendar: "Calendar",
			detection: "Detection",
			recording: "Recording & notes",
			transcription: "Transcription",
			enrichment: "Enrichment",
		},
		calendarHeading: "Google Calendar integration",
		googleHeading: "Google Calendar",
		modelsHeading: "Models",
		googleAuth: {
			name: "Google authentication",
			descAuthenticated: "Authenticated. Re-authenticating refreshes the token.",
			descUnauthenticated: "Not authenticated. Click to connect your Google Calendar.",
			descConnecting: "Waiting for you to finish in the browser…",
			buttonReauthenticate: "Re-authenticate",
			buttonAuthenticate: "Authenticate",
			buttonCancel: "Cancel",
		},
		advancedCredentials: {
			summary: "Advanced: custom OAuth credentials",
			desc: "Override the built-in app credentials. Leave blank to use the bundled defaults. Only needed if you want to use your own Google Cloud project.",
		},
		clientId: {
			name: "Client ID",
			desc: "OAuth client ID from your Google Cloud Desktop app.",
		},
		clientSecret: {
			name: "Client secret",
			desc: "OAuth client secret from your Google Cloud Desktop app.",
		},
		optionalScopes: {
			heading: "Optional permissions",
			desc: "Calendar access is always required. These extra permissions only improve attendee names on the agenda — turn any off to reduce what's requested at sign-in. Turning one back on needs a re-authenticate before Google actually grants it.",
		},
		scopeGroups: {
			name: "Expand Google Group invitees",
			desc: "When a calendar invite lists a Google Group (e.g. a team distribution list) as an attendee, expand it into the individual people on that group instead of showing the group's raw address. Uses the Cloud Identity Groups API (`cloud-identity.groups.readonly`). Off: group invitees show as one humanized group label instead of the people in it.",
		},
		scopeDirectory: {
			name: "Resolve attendee names from your Workspace directory",
			desc: "Looks up a real display name for attendees your calendar invite doesn't already label (e.g. a bare email address). Uses the People API's directory scope (`directory.readonly`) — some Workspace domains disable this for third-party apps regardless of this setting. Off: those attendees show a name guessed from their email address instead.",
		},
		scopeOtherContacts: {
			name: "Resolve attendee names from Google \"Other contacts\"",
			desc: "A second, independent source for attendee display names — your own auto-populated Gmail correspondence history, not your organization's directory — useful when the directory lookup above is blocked by a Workspace admin. Uses the People API's other-contacts scope (`contacts.other.readonly`). Off: those attendees show a name guessed from their email address instead.",
		},
		scopeReauthNeeded: "Re-authenticate above to grant this — your current sign-in predates it.",
		calendarAutoRecord: {
			name: "Calendar meeting notifications",
			desc: "Notify you around each event's start with Join / Record options. Turn on 'Auto-start recording' below for hands-free recording.",
		},
		notifyBeforeStart: {
			name: "Heads-up lead time (minutes)",
			desc: "Give yourself a warning this many minutes ahead of a meeting's start. Set to 0 to skip the early warning — you'll still be prompted right at start time (0–60).",
		},
		calendarAutoStart: {
			name: "Auto-start recording",
			desc: "Start recording automatically when a calendar meeting begins, instead of only prompting. Back-to-back meetings stop the previous recording first.",
		},
		calendarAutoStop: {
			name: "Auto-stop recording",
			desc: "Stop a calendar meeting's recording automatically when the event ends. When off, you're prompted to stop instead (including when a recording outlives its meeting, e.g. after the laptop sleeps).",
		},
		targetCalendarId: {
			name: "Target calendar ID",
			desc: "ID of the calendar to watch. The default `primary` is your main calendar.",
		},
		exclusionKeywords: {
			name: "Exclusion keywords",
			desc: "Events whose title contains any of these words are excluded from the calendar entirely — not shown in the agenda and not recorded (separate by newline or comma; case-insensitive).",
		},
		groupExpandMaxMembers: {
			name: "Max group members to expand",
			desc: "When a calendar invite lists a Google Group, expand it into at most this many people (via Cloud Identity). Runs in the background after the agenda loads. Larger groups are represented by the first N members only (the group label is replaced). Default 50; max 500.",
		},
		excludeWithoutMeetingLink: {
			name: "Exclude meetings without a conference link",
			desc: "Hide events that have no Google Meet, Zoom, Teams, or Webex link in the conference data, location, or description.",
		},
		openMeet: {
			name: "Open meeting link automatically",
			desc: "If the event has a meeting link (Google Meet, Zoom, Teams, or Webex), open it in the browser at the start time.",
		},
		agendaPlacement: {
			name: "Agenda placement",
			desc: "Whether the meeting agenda opens as a main-panel tab or in the right sidebar.",
			main: "Main panel",
			sidebar: "Side panel",
		},
		agendaLookAhead: {
			name: "Agenda horizon (days)",
			desc: "Furthest a scheduled meeting can be in the future and still show up in the agenda.",
		},
		agendaLookBack: {
			name: "Agenda history (days)",
			desc: "Furthest back you can page into past meetings from the agenda (0–30).",
		},
		notificationsHeading: "Notifications (macOS)",
		notificationStyle: {
			name: "Enable system notifications",
			desc: "When Obsidian is in front you get an in-app prompt; otherwise a system notification. If those don't appear on screen, turn off Focus / Do Not Disturb and set Obsidian to Alerts in macOS notification settings.",
			button: "Open macOS notification settings",
		},
		detectionHeading: "Meeting detection (macOS)",
		detectMeetings: {
			name: "Detect meetings automatically",
			desc: "Watch for an in-progress meeting and offer to record it (even without a calendar event). Shows a native notification you'll see when Obsidian is minimized. macOS only.",
		},
		detectZoom: {
			name: "Detect Zoom",
			desc: "Detect an active Zoom call via its in-meeting helper process (only running during a call, not when Zoom is merely open).",
		},
		detectGoogleMeet: {
			name: "Detect Google Meet",
			desc: "Detect a live meet.google.com tab in Chrome, Brave, Edge, or Arc. Requires granting Obsidian Automation permission the first time.",
		},
		detectionInterval: {
			name: "Detection interval (seconds)",
			desc: "How often to check for a meeting in progress (3–120).",
		},
		endpointHeading: "AI endpoint",
		apiBaseUrl: {
			name: "API base URL",
			desc: "OpenAI-compatible endpoint used for both transcription (/audio/transcriptions) and enrichment (/chat/completions). OpenAI and LiteLLM work for both. Ollama works for enrichment only — it has no /audio/transcriptions endpoint. Azure requires the OpenAI-compatible surface (/openai/v1), not the classic deployment-path format.",
		},
		apiKey: {
			name: "API key",
			desc: "Use 'Load models' to verify it and load the available models.",
		},
		fallbackEndpoint: {
			summary: "Fallback endpoint (when primary is down)",
			desc: "Optional second OpenAI-compatible service. Used automatically when the primary fails with a service error (timeout, network, 5xx, auth). Pick fallback models under each primary model below. For local transcription, enable “Fall back to remote on failure” so a local failure can reach the primary remote and then this fallback.",
		},
		fallbackApiBaseUrl: {
			name: "API base URL",
			desc: "Leave empty to disable fallback. Example: https://api.openai.com/v1 or http://localhost:11434/v1.",
		},
		fallbackApiKey: {
			name: "API key",
			desc: "Optional. Leave empty for local servers that ignore keys; set it when the fallback gateway requires auth.",
		},
		fallbackModel: {
			summary: "Fallback model",
			descStt:
				"When the primary endpoint fails. “Same as primary” reuses the transcription model name above.",
			descEnrich:
				"When the primary endpoint fails. “Same as primary” reuses the enrichment model name above.",
			usePrimary: "Same as primary",
		},
		remoteFallbackModel: {
			name: "Remote transcription model",
			desc: "Model used on the primary remote endpoint when local transcription fails. Run ‘Load models’ above to list what the endpoint exposes — type to filter.",
		},
		endpointActions: {
			name: "Connection",
			desc: "Verify the primary endpoint (and the fallback, when configured) and load model lists for the pickers below.",
		},
		endpointStatus: {
			ok: "Connected — models loaded",
			error: "Connection failed",
		},
		transcriptionHeading: "Transcription",
		transcriptionEngine: {
			name: "Transcription engine",
			desc: "Remote sends audio to the OpenAI-compatible endpoint configured above. Local runs a Whisper model — audio never leaves the device.",
			remote: "Remote (API endpoint)",
			local: "Local (on-device Whisper)",
		},
		localModel: {
			name: "Local model",
			desc: "The on-device Whisper model. Larger models are more accurate but slower and use more memory. All are multilingual — set the language below, or leave it on auto-detect.",
			/** Descriptive label for a model id in the picker (size is appended separately). */
			option: (id: string): string => {
				switch (id) {
					case "small-q5_1":
						return "Small — fastest, least accurate";
					case "medium-q5_0":
						return "Medium — balanced";
					case "large-v3-turbo-q5_0":
						return "Large v3 Turbo — most accurate (recommended)";
					default:
						return id;
				}
			},
		},
		localModelDownload: {
			name: "Model file",
			missing: (size: string) =>
				`Not downloaded yet (${size}). Download it once — it's stored in this vault's plugin folder and reused for every meeting.`,
			present: (size: string) =>
				`Downloaded (${size}) — ready for local transcription.`,
			downloading: (pct: number) => `Downloading… ${pct}%`,
			download: "Download",
			delete: "Delete",
			cancel: "Cancel",
			done: "Local model downloaded.",
			cancelled: "Model download cancelled.",
			failed: (reason: string) => `Model download failed: ${reason}`,
		},
		localFallback: {
			name: "Fall back to remote on failure",
			desc: "If local transcription fails, transcribe with the remote endpoint instead — when one is configured. When on, pick the remote model (and optional fallback model) below.",
		},
		sttModel: {
			name: "Transcription model",
			desc: "Model sent to the endpoint. Run 'Load models' above to list the models your endpoint exposes — when it reports capabilities, the list is narrowed to speech-to-text models. Type to filter the list.",
		},
		sttApiType: {
			name: "Engine (advanced)",
			desc: "Which speech-to-text engine the model above speaks. Auto-detected from the model — only change it if your gateway's model name hides which engine it really is. Controls request shape and chunking; word timestamps are detected automatically.",
			gpt4o: "GPT-4o transcribe (most accurate)",
			gpt4oMini: "GPT-4o mini transcribe (lower cost)",
			whisper: "Whisper",
		},
		diarization: {
			name: "Separate my voice from others",
			desc: "Transcribes the mic and system audio channels separately so your side of the conversation can be told apart from everyone else's. Roughly doubles transcription cost, and needs a Whisper model whose endpoint returns timestamps — check the Timestamp support badge above.",
			descLocal:
				"Transcribes the mic and system audio channels separately so your side of the conversation can be told apart from everyone else's. Runs two on-device passes, so it takes roughly twice as long. Local Whisper always provides timestamps, so no endpoint check is needed.",
		},
		recheckSupport: {
			button: "Recheck",
			tooltip:
				"Re-test whether this model transcribes (and returns timestamps) against the current endpoint.",
			transcribes: "This model transcribes.",
			notTranscription:
				"This model can't transcribe — pick a speech-to-text model (e.g. whisper or gpt-4o-transcribe).",
			timestampsYes:
				"Transcribes and returns timestamps — speaker separation is available.",
			timestampsNo:
				"Transcribes, but this endpoint doesn't return timestamps — speaker separation is unavailable.",
			inconclusive: (detail: string) =>
				`Couldn't verify support (${detail}). Check the endpoint/key and try again.`,
		},
		transcriptionBadge: {
			name: "Transcription support",
			supported: "Transcription: supported",
			notSupported:
				"Transcription: not supported — pick a speech-to-text model",
			checking: "Transcription: checking…",
			unknown: "Transcription: not checked yet",
		},
		timestampBadge: {
			name: "Timestamp support",
			detected: "Timestamps: detected — speaker separation available",
			notDetected:
				"Timestamps: not detected — speaker separation unavailable",
			checking: "Timestamps: checking…",
			unknown: "Timestamps: not checked yet",
			notApplicable:
				"Timestamps: not applicable — use a Whisper model for speaker separation",
		},
		sttLanguage: {
			name: "Language",
			desc: "ISO 639-1 code (e.g. en, ja, ko, zh, es, de, fr) or 'auto' to detect. Use the two-letter code — full names like 'Spanish' will cause a 400 error from the API.",
			placeholder: "Auto-detect",
		},
		dictionaryCorrection: {
			name: "Custom dictionary correction",
			desc: "Apply the rules below to fix misheard names and terms after transcription.",
		},
		postProcessing: {
			name: "GPT-assisted dictionary correction",
			desc: "Use the model (instead of plain find-and-replace) to apply the dictionary more intelligently. Requires 'Custom dictionary correction' above.",
		},
		debugLogging: {
			name: "Debug logging",
			desc: "Log detailed transcription timing (per-chunk duration, rate-limit waits, retries) to the developer console (⌘⌥I). Verbose — leave off unless you're diagnosing slow or failing transcriptions.",
		},
		dictionary: {
			name: "Dictionary",
			desc: "One rule per line: misheard => correct. Example: elastic search => Elasticsearch. The top 50 rules by priority are applied — rules beyond that are silently ignored.",
			placeholder: "elastic search => Elasticsearch\nkubernetis => Kubernetes",
		},
		recordingHeading: "Recording & notes",
		enrichHeading: "AI enrichment",
		enableEnrichment: {
			name: "Enable AI enrichment",
			desc: "Allow generating an AI notes summary from your notes and the transcript.",
		},
		enrichModel: {
			name: "Enrichment model",
			desc: "Chat model used for enrichment. Use 'Load models' above to load the models your endpoint exposes, then pick one — type to filter the list.",
		},
		modelCombobox: {
			placeholder: "Type to filter models…",
			placeholderEmpty: "Model id",
		},
		testConnection: {
			button: "Load models",
			testing: "Loading…",
			noBaseUrl: "Set the API base URL first.",
			success: (n: number) =>
				`Connected. Loaded ${n} model${n === 1 ? "" : "s"}.`,
			successWithFallback: (primary: number, fallback: number) =>
				`Connected. Loaded ${primary} primary and ${fallback} fallback model${fallback === 1 ? "" : "s"}.`,
			empty: "Connected, but the endpoint returned no models.",
			fallbackFailed: (msg: string) =>
				`Primary models loaded; fallback endpoint failed: ${msg}`,
			primaryFailedFallbackOk: (msg: string, n: number) =>
				`Primary endpoint failed (${msg}). Loaded ${n} fallback model${n === 1 ? "" : "s"}.`,
			primaryFailedNoFallback: (primaryMsg: string, fallbackMsg: string) =>
				`Primary failed (${primaryMsg}); fallback failed (${fallbackMsg}).`,
			failure: (msg: string) => `Connection failed: ${msg}`,
		},
		enrichOnTranscribe: {
			name: "Enrich automatically after transcription",
			desc: "Run enrichment as soon as a transcript is inserted. On by default; turn it off if you want to trigger enrichment manually.",
		},
		enrichPromptCustomize: {
			name: "Customize enrichment prompt",
		},
		enrichPrompt: {
			name: "Enrichment prompt",
			desc: "Prompt sent to the model. While Customize is off, the plugin uses its built-in prompt (which improves with each update); toggle it on to edit and store your own. Placeholders: {{title}}, {{date}}, {{attendees}}, {{notes}}, {{actionItems}}, {{followUps}}, {{transcript}}.",
		},
		enrichMaxTranscriptTokens: {
			name: "Max transcript tokens for enrichment",
			desc: "Soft cap (~characters÷4) on how much of the transcript is spliced into the enrichment prompt. Longer transcripts keep the opening and closing with a visible truncation marker in the middle. 0 disables truncation. Default 12000.",
		},
		enrichTimeoutSeconds: {
			name: "Enrichment timeout (seconds)",
			desc: "How long to wait for the enrichment model before failing (and retrying once). Raise this for slow local/proxy LLMs. Range 60–600; default 120.",
		},
	},
	oauth: {
		notAuthenticated:
			"Not authenticated. Please authenticate from the command palette.",
		credentialsNotSet: "OAuth credentials are not set.",
		sessionExpired:
			"Google Calendar session expired. Please reconnect from settings or the command palette.",
		desktopOnly: "OAuth authentication is only supported on desktop.",
		setCredentialsFirst: "OAuth credentials are missing or incomplete. Open the Advanced section in Settings and enter both your Client ID and Client Secret.",
		openingBrowser: "Opening Google authentication in your browser…",
		noRefreshToken:
			"No refresh_token was returned. Add yourself as a test user on the OAuth consent screen and try again.",
		authComplete: "✅ Calendar authentication complete",
		cancelled: "Calendar authentication cancelled.",
		timeout: "Authentication timed out (5 minutes).",
		htmlError: (err: string) => `<h1>OAuth error</h1><p>${err}</p>`,
		htmlStateMismatch: "<h1>state mismatch</h1>",
		htmlCodeMissing: "<h1>code missing</h1>",
		htmlSuccess: `<!doctype html><html><head><title>Authentication complete</title></head><body style="font-family:system-ui;padding:40px;text-align:center;"><h1>✅ Authentication complete</h1><p>Close this tab and return to Obsidian.</p></body></html>`,
	},
};

export type Messages = typeof en;
