import { Component, FileSystemAdapter, MarkdownRenderer, MarkdownView, Menu, normalizePath, Notice, Platform, Plugin, setIcon, TFile, TFolder } from "obsidian";
import {
    DEFAULT_SETTINGS,
    inferSttApiType,
    migrateSettings,
    STT_MODELS,
    SttApiType,
    SystemRecordingSettings,
    SystemRecordingSettingTab,
} from "./settings";
import {
    Recorder,
    RecorderStatus,
    RecordingFormat,
    listInputDevices,
    type InputDevice,
} from "./recorder";
import {
    AssetProvisioner,
    BinaryProvisioner,
    EXPECTED_FVAD_SHA256,
    EXPECTED_WHISPER_SHA256,
    FVAD_WASM_SIZE,
    fvadWasmUrl,
    WHISPER_DYLIB_SIZE,
    whisperDylibUrl,
} from "./binary";
import { describeVersion } from "./buildInfo";
import { awaitIndexedFile } from "./util/awaitIndexedFile";
import { findByPathCaseInsensitive } from "./util/caseInsensitivePath";
import {
    assetNodeDeps,
    nodeDeps,
    resolveBinaryPath,
    resolveFvadWasmPath,
    resolveModelPath,
    resolveWhisperDylibPath,
    whisperCppNodeDeps,
} from "./binary-runtime";
import {
    LOCAL_MODELS,
    localModelSpec,
    type LocalModelSpec,
} from "./transcribe/localModels";
import * as path from "path";
import * as fs from "fs";
import {
	CONTACTS_OTHER_READONLY_SCOPE,
	CredentialsMissingError,
	DIRECTORY_READONLY_SCOPE,
	GoogleOAuth,
	GROUPS_READONLY_SCOPE,
	type StoredTokens,
} from "./auth/googleOAuth";
import { parseKeywords } from "./calendar/eventFilter";
import { CalendarScheduler, GRACE_MS, ScheduledEvent } from "./calendar/scheduler";
import { eventEndStopAction } from "./calendar/eventEnd";
import { actionNotice, multiActionNotice, NoticeAction } from "./ui/actionNotice";
import {
    ADHOC_ID_PREFIX,
    createMeetingNote,
    dropRecordingLink,
    effectiveNoteTemplate,
    effectiveTitlePattern,
    findMeetingNoteForAudio,
    folderOf,
    insertTranscript,
    linkRecording,
    MeetingEventInfo,
    MeetingNoteConfig,
    normalizeFolderPathOrEmpty,
    notePathRenamed,
    notePathDeleted,
    parseStampDate,
    recordingLinkTarget,
    recordingLinkTargets,
    sanitizeName,
    scanMeetingNotes,
    templateStaticRoot,
    TRANSCRIPT_SEGMENT_SEPARATOR,
} from "./notes/meetingNote";
import {
    extractSection,
    extractTranscript,
    HIDE_AI_CLASS,
} from "./notes/enrichedBlock";
import {
    extractActionItems,
    extractFollowUps,
    extractManualActionItems,
    stripTaskMeta,
} from "./notes/actionItems";
import { normalizeManualNotes } from "./notes/manualNotes";
import { applyEnrichToContent } from "./notes/applyEnrich";
import { looksLikeZoomVtt, parseZoomTranscript } from "./notes/zoomTranscript";
import { mcLog } from "./util/logLine";
import {
	fallbackEndpoint,
	isFallbackEndpointConfigured,
} from "./util/endpointFallback";
import { isServiceFailure } from "./util/serviceFailure";
import {
    computeAttention,
    type AttentionInput,
    type AttentionRow,
} from "./notes/attention";
import {
    meetingRows,
    normalizePageSize,
    PAGE_SIZE_OPTIONS,
    paginate,
    type DashboardMeetingInput,
    type Page,
} from "./notes/dashboardMeetings";
import {
    countTasks,
    mergeGroupsByKey,
    parseNoteTasks,
    sortActionNoteGroups,
    splitByHorizon,
    taskAgeDays,
    tasksOutsideHeadings,
    type ActionGroupCategory,
    type ActionNoteGroup,
    type GroupedTask,
} from "./notes/dashboardActions";
import {
    findNoteIssues,
    inferIdentityFromSiblings,
    type IdentityInference,
    type InferredIdentity,
    type NoteIdentityRow,
    type NoteIssue,
    type OneOnOneCandidate,
    type RecurringCandidate,
    type SiblingIdentity,
} from "./notes/metadataRepair";
import { isPathExcluded, parseFolderPatterns } from "./notes/folderExclusion";
import { seriesKey } from "./calendar/recurringSeries";
import { listEvents, type GCalEvent } from "./calendar/googleCalendar";
import {
	createCloudIdentityDirectory,
	DEFAULT_GROUP_EXPAND_MAX_MEMBERS,
	GroupExpandCache,
	inviteeFingerprint,
	mapAttendeesExpanded,
	type ExpandableAttendee,
} from "./calendar/expandGroupAttendees";
import {
	createPeopleDirectory,
	PersonNameCache,
} from "./calendar/personDirectory";
import { syncOtherContacts } from "./calendar/otherContactsSync";
import {
	DIRECTORY_CACHE_FILENAME,
	DirectoryCache,
	OTHER_CONTACTS_RESYNC_INTERVAL_MS,
	PEOPLE_MAX_REQUESTS_PER_MINUTE,
	PeopleApiRateLimiter,
} from "./calendar/directoryCache";
import { maxRecordingAction } from "./recordings/maxRecordingLength";
import { silenceAutoStopAction } from "./recordings/silenceAutoStop";
import { findExpiredRecordings, underFolder } from "./recordings/retention";

/** Note section that holds personal action-item checkboxes (obsidian-tasks compatible). */
const ACTION_ITEMS_HEADING = "## Action items";
/** Note section that holds meeting-wide follow-up checkboxes. */
const FOLLOW_UPS_HEADING = "## Follow-ups";
/**
 * How far back "Past meetings" reaches by default. Shared with
 * `renderNoteIssues`, which picks up anything (attention reason or identity
 * issue) that falls outside this same window — the two lists are meant to
 * partition the vault's problem notes by recency, not overlap.
 */
const PAST_WINDOW_DAYS = 2;
import { chatComplete, ChatAbortError, EnrichTimeoutError } from "./enrich/llm";
import {
    cliChatComplete,
    CLIAbortError,
    CLINotFoundError,
} from "./enrich/cliBridge";
import { isPartialTranscript } from "./transcribe/partial";
import { stripHallucinatedLines } from "./transcribe/hallucination";
import {
    initTranscribeEngine,
    isDiarizationCancelled,
    shouldInvalidateProbe,
    transcribeAudio,
    transcribeDiarized,
    type TranscribeConfig,
} from "./transcribe/TranscriptionService";
import { OpenAICompatibleBackend } from "./transcribe/OpenAICompatibleBackend";
import { WhisperCppBackend } from "./transcribe/WhisperCppBackend";
import type { TranscriptionBackend } from "./transcribe/backend";
import { canSeparateSpeakers } from "./transcribe/sttModel";
import { probeKey } from "./transcribe/probe";
import {
    RECORDING_FORMATS,
    baseRecordingCandidatesOf,
    isSidecarPath,
    parseSpeechWindows,
    sidecarPathsFor,
} from "./transcribe/sidecar";
import { preferWindows, pregateSources, type SpeechWindows } from "./transcribe/diarize";
import { computeSpeechWindows } from "./transcribe/vadWindows";
import { parseDictionary } from "./transcribe/dictionary";
import type { TranscriptionModel } from "./transcribe/vendor/ApiSettings";
import {
    ADHOC_TITLE_PROMPT_SUFFIX,
    effectiveEnrichPrompt,
    ENRICH_SYSTEM_PROMPT,
    extractEmbeddedTitle,
    fillPrompt,
    truncateTranscriptForBudget,
} from "./enrich/prompt";
import {
    cleanSuggestedTitle,
    shouldSuggestAdhocTitle,
} from "./enrich/adhocTitle";
import {
    buildTranscriptCleanupPrompt,
    TRANSCRIPT_CLEANUP_SYSTEM_PROMPT,
} from "./enrich/transcriptCleanup";
import { RenameModal } from "./ui/renameModal";
import { t } from "./i18n";
import { TypedEventBus } from "./util/eventBus";
import {
    AgendaMeeting,
    buildNoteIndex,
    toAgendaMeeting,
    toMeetingInfo as agendaToMeetingInfo,
} from "./ui/agenda/agendaModel";
import {
    AgendaViewEvents,
    AgendaViewHost,
    MeetingAgendaView,
    VIEW_TYPE_AGENDA,
    AGENDA_ICON,
} from "./ui/agenda/MeetingAgendaView";
import {
    DashboardViewHost,
    MeetingDashboardView,
    VIEW_TYPE_DASHBOARD,
    DASHBOARD_ICON,
} from "./ui/dashboard/MeetingDashboardView";
import {
    populateMeetingMenu,
    RowHandlers,
} from "./ui/agenda/components/eventRow";
import { accentClass } from "./ui/agenda/components/accent";
import { registerIcons, RECORD_ICON } from "./ui/icons";
import {
	notifyOs,
	requestNotificationPermission,
	OsNotificationAction,
} from "./ui/osNotification";
import {
	startDualChannelPrompt,
	DualChannelController,
	InAppHandle,
} from "./ui/dualChannelPrompt";
import { notifLog, notifDebugEnabled } from "./util/notifLog";
import { decideWindowFocused, BrowserWindowState } from "./util/windowFocus";
import {
    QueueItem,
    QueueSnapshot,
    TaskCancelledError,
    TaskKind,
    TaskQueue,
} from "./transcribe/queue";
import { MeetingDetector } from "./detect/meetingDetector";
import { googleMeetActive, zoomInMeeting } from "./detect/probe";
import { execFile } from "child_process";
import { BUNDLED_CLIENT_ID, BUNDLED_CLIENT_SECRET } from "./auth/credentials";

/**
 * How a transcribe run treats speaker separation:
 *   - "auto":     respect the speaker-separation setting (auto-transcribe path)
 *   - "diarized": force the separated pass (fall back to the joint track if
 *                 no separate tracks were recorded)
 *   - "mixed":    always transcribe the single joint track
 */
type TranscribeMode = "auto" | "diarized" | "mixed";

/**
 * The outcome of transcribing one recording (take) to text, before any note
 * write. "text" carries the ready-to-insert transcript; the rest are the
 * no-transcript outcomes each caller handles differently (a fresh single take
 * may discard an "empty" as silence; a multi-take rebuild just skips it). User
 * cancellation is not modelled here — it throws so the queue rejects.
 */
type TranscribeTakeResult =
    | { kind: "text"; text: string }
    | { kind: "empty" }
    | { kind: "partial" }
    | { kind: "error"; message: string };

/**
 * Cap on how long the diarized pass waits for the (optional, ~20 KB) fvad.wasm
 * fetch before proceeding with the RMS fallback. The download is normally
 * sub-second (and a no-op once present), but `requestUrl` can't be aborted
 * mid-flight, so a stalled connection must not hang transcription — after this
 * it continues in the background for the next run.
 */
const FVAD_PROVISION_TIMEOUT_MS = 15_000;

/**
 * How long before an auto-stop cutoff to warn, with a chance to cancel,
 * before force-stopping. Shared by both recording safety nets: the absolute
 * `maxRecordingHours` cap (`checkMaxRecordingLength`) and the
 * `silenceAutoStopMinutes` cap (`checkSilenceAutoStop`).
 */
const AUTO_STOP_WARNING_SECONDS = 30;

export default class SystemRecordingPlugin extends Plugin {
    settings: SystemRecordingSettings;
    private recorder = new Recorder();
    private provisioner = new BinaryProvisioner(nodeDeps());
    private modelProvisioner = new AssetProvisioner(assetNodeDeps());
    private starting = false;
    /** Dedupe identical capture warnings so a flapping device can't spam. */
    private lastWarningMessage: string | null = null;
    private lastWarningAt = 0;
    private statusBarEl: HTMLElement | null = null;
    private statusTimeout: number | null = null;
    private durationInterval: number | null = null;
    private recordingStartTime: number | null = null;
    /** Live "recording will stop soon" prompt from `checkMaxRecordingLength`, if any. */
    private maxRecordingWarningNotice: DualChannelController | null = null;
    /**
     * True once the user dismisses the max-recording-length warning ("Keep
     * recording"). Suppresses further warnings/auto-stop for the rest of this
     * recording session — an explicit choice to keep going shouldn't be
     * re-litigated every second. Reset when a new recording starts.
     */
    private maxRecordingCancelled = false;
    /** Live "recording will stop soon" prompt from `checkSilenceAutoStop`, if any. */
    private silenceWarningNotice: DualChannelController | null = null;
    /** Same as `maxRecordingCancelled`, for the silence-based auto-stop warning. */
    private silenceCancelled = false;
    /**
     * Seconds of continuous silence last reported by the recorder's status
     * heartbeat (see `handleStatus`'s `"recording"` branch). `0` until the
     * first heartbeat arrives after a recording starts.
     */
    private lastSilentSeconds = 0;
    /** Hover popover listing the task queue (running + next few waiting), with per-item cancel. */
    private queuePopoverEl: HTMLElement | null = null;
    /** True while the pointer is over the status bar item or the popover (keeps it shown). */
    private statusHovered = false;
    /**
     * Deferred popover teardown: leaving the status bar (or the popover) hides it
     * after a short grace so the pointer can cross the small gap between them —
     * the popover is interactive now (per-item cancel), so it must survive the
     * hand-off instead of vanishing mid-reach.
     */
    private popoverHideTimer: number | null = null;
    /** The recording timer text span, and the small transcription-count badge beside it. */
    private recTimeEl: HTMLElement | null = null;
    private recQueueEl: HTMLElement | null = null;
    /** How many waiting jobs the hover popover lists before collapsing the rest into "+N more". */
    private static readonly QUEUE_POPOVER_LIMIT = 5;
    private ribbonIconEl: HTMLElement | null = null;
	private oauth = new GoogleOAuth(
		{
			getCredentials: () => {
				const idOverride = this.settings.googleClientId.trim();
				const secretOverride = this.settings.googleClientSecret.trim();
				// Treat overrides atomically: a partial override (one field set,
				// the other blank) would silently pair mismatched credentials and
				// produce an opaque Google 401. Require both or neither.
				if (idOverride || secretOverride) {
					return idOverride && secretOverride
						? { client_id: idOverride, client_secret: secretOverride }
						: null;
				}
				// No overrides: use bundled credentials.
				return BUNDLED_CLIENT_ID && BUNDLED_CLIENT_SECRET
					? { client_id: BUNDLED_CLIENT_ID, client_secret: BUNDLED_CLIENT_SECRET }
					: null;
			},
			getTokens: () => this.settings.googleTokens,
			setTokens: async (tokens) => {
				this.settings.googleTokens = tokens;
				await this.saveSettings();
			},
			getOptionalScopes: () => {
				const scopes: string[] = [];
				if (this.settings.scopeGroupsEnabled) scopes.push(GROUPS_READONLY_SCOPE);
				if (this.settings.scopeDirectoryEnabled) scopes.push(DIRECTORY_READONLY_SCOPE);
				if (this.settings.scopeOtherContactsEnabled) {
					scopes.push(CONTACTS_OTHER_READONLY_SCOPE);
				}
				return scopes;
			},
		},
		() => this.onCalendarAuthExpired()
	);
	private scheduler: CalendarScheduler | null = null;
	/** True once the refresh token died; suppresses the looping calendar-error notice until reconnect. */
	private authExpired = false;
	/** Set while `authenticateCalendar()` is waiting on the browser consent flow — lets a "Cancel" button abandon it instead of leaving the button stuck forever. */
	private authAbort: AbortController | null = null;
	/** The in-flight `authenticateCalendar()` promise, if any — see {@link getAuthPromise}. */
	private authPromise: Promise<void> | null = null;
	/** Tier 1 meeting detector + its poll interval id (macOS only). */
	private detector: MeetingDetector | null = null;
	private detectorIntervalId: number | null = null;
	/** Note the in-progress recording belongs to, so we can link it back on stop. */
	private currentMeetingNotePath: string | null = null;
	/**
	 * Live reference to that note. Preferred over the path on stop so renaming
	 * the note mid-recording (Obsidian updates `TFile.path`) still links back.
	 */
	private currentMeetingNote: TFile | null = null;
	/** Calendar event id of the in-progress meeting recording, for agenda state. */
	private currentRecordingEventId: string | null = null;
	/** End time (epoch ms) of the calendar event being recorded, for auto-stop/sleep recovery. Null for ad-hoc. */
	private currentRecordingEventEnd: number | null = null;
	/** Vault-relative path of the in-progress recording, protected from retention. */
	private currentRecordingPath: string | null = null;
	/**
	 * Visible, serial task queue (running + waiting) for all long-running
	 * background work — transcription and enrichment — with per-item cancellation
	 * and a transcribe→enrich dependency pipeline (issue #96).
	 */
	private taskQueue = new TaskQueue((s) =>
		this.renderQueueStatus(s)
	);
	/**
	 * Last progress percent for the running transcription, so queue-change
	 * repaints (which fire between the sparse progress ticks) can keep showing
	 * it instead of dropping back to a percent-less label.
	 */
	private runningProgress: { id: string; pct: number } | null = null;
	/** Calendar event ids whose meeting link was already auto-opened, so it opens once. */
	private openedLinkEventIds = new Set<string>();
	/**
	 * Meeting prompts currently on screen, keyed by meeting (calendar event id,
	 * or a detection key). Each is an exclusive-channel controller (in-app Notice
	 * when focused, OS notification when not — never both). A new prompt
	 * supersedes *all* live prompts so surfaces don't stack.
	 */
	private meetingNotices = new Map<string, DualChannelController>();
	/**
	 * The current "meeting ended — stop recording?" prompt, if any. A recording
	 * never stops on its own (unless the user opted into calendar auto-stop), so
	 * the end of a meeting only offers to stop; we keep one reference to supersede
	 * a stale prompt and to clear it once recording actually ends.
	 */
	private stopPromptNotice: DualChannelController | null = null;
	/** Resolvers waiting for the current recording to fully stop (back-to-back chaining). */
	private stopWaiters: Array<() => void> = [];
	/**
	 * Nested count of in-flight `replaceCurrent` handoffs. Suppresses stop
	 * prompts while > 0. A refcount (not a boolean) so a concurrent
	 * startRecording that early-returns can't clear suppression for another
	 * handoff still in stopAndWait/provision/spawn.
	 */
	private replacingDepth = 0;
	/** True while a stopped recording is still being linked/handled in attachRecording. */
	private attaching = false;
	/**
	 * Pending auto-transcribe waits, keyed by the recording's vault path. Each
	 * waits for Obsidian's index to catch up to a just-written recording (index
	 * lag; see {@link awaitIndexedFile}). A manual transcribe of the same file —
	 * or plugin unload — aborts the wait so the take isn't transcribed twice.
	 */
	private pendingAutoTranscribe = new Map<string, AbortController>();
	/** Wall-clock of the previous duration tick, for sleep detection while recording. */
	private lastDurationTickAt: number | null = null;
	/** Note paths currently being offered an AI title, to prevent duplicate modals. */
	private titleSuggestingPaths = new Set<string>();
	/** One-shot startup retention sweep, cleared on unload. */
	private retentionTimeout: number | null = null;
	/** Serializes retention sweeps so the startup timer and the command can't overlap. */
	private cleanupRunning = false;
	/**
	 * Session cache for Cloud Identity group expansion. Shared across polls so
	 * the same group/person isn't looked up again until the plugin reloads
	 * (or auth reconnect / invitee change invalidates it).
	 */
	private groupExpandCache = new GroupExpandCache();
	/** Session cache for People directory display-name lookups. */
	private personNameCache = new PersonNameCache();
	/**
	 * Persistent People/Groups directory cache
	 * (`<pluginDir>/directory-cache.json`). Loaded on startup; flushed on unload.
	 */
	private directoryCache = new DirectoryCache(null);
	/** Caps People API calls under the 90/min per-user quota. */
	private peopleRateLimiter = new PeopleApiRateLimiter();
	/** Expanded attendee labels keyed by Google event id + invitee fingerprint. */
	private expandedAttendeesByEventId = new Map<
		string,
		{ fingerprint: string; labels: string[] }
	>();
	/** Bumped to cancel an in-flight background expansion when a newer fetch wins. */
	private groupExpandGeneration = 0;
	/** Guards against overlapping otherContacts syncs (see scheduleOtherContactsSync). */
	private otherContactsSyncInFlight = false;
	private agendaEvents = new TypedEventBus<AgendaViewEvents>();

    async onload() {
        // Log the version + build provenance once at load (verbose console) so a
        // support report can tell an official release from a custom build. The
        // "custom build" label is intentionally left in English here (dev/support
        // log, not localized UI); the settings tab uses the localized label.
        console.debug(
            `${this.manifest.name} v${describeVersion(this.manifest.version)}`
        );
        await this.loadSettings();
		await this.initDirectoryCache();
        // Prime the vendored transcription engine (i18n + plugin dir).
        initTranscribeEngine(this.manifest.dir ?? null);

        // Ribbon icon
        registerIcons();
        this.ribbonIconEl = this.addRibbonIcon(
            RECORD_ICON,
            t().ribbon.toggleRecording,
            (evt) => this.onRibbonClick(evt)
        );

        // Meeting agenda sidebar view
        this.registerView(
            VIEW_TYPE_AGENDA,
            (leaf) => new MeetingAgendaView(leaf, this.agendaHost())
        );
        this.addRibbonIcon(AGENDA_ICON, t().ribbon.openAgenda, () =>
            void this.openAgenda()
        );
        this.addCommand({
            id: "open-agenda",
            name: t().commands.openAgenda,
            callback: () => void this.openAgenda(),
        });

        // Meetings dashboard — a plain tab, no vault file backing it.
        this.registerView(
            VIEW_TYPE_DASHBOARD,
            (leaf) => new MeetingDashboardView(leaf, this.dashboardHost())
        );
        this.addRibbonIcon(DASHBOARD_ICON, t().ribbon.openDashboard, () =>
            void this.openDashboard()
        );
        this.addCommand({
            id: "open-dashboard",
            name: t().commands.openDashboard,
            callback: () => void this.openDashboard(),
        });

        // Expose the same actions as the agenda list (record, transcribe,
        // enrich, links, …) from the note's editor and file context menus.
        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu, _editor, info) => {
                const file = info.file;
                if (file instanceof TFile) this.addNoteMeetingMenu(menu, file);
            })
        );
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file instanceof TFile) {
                    this.addNoteMeetingMenu(menu, file);
                } else if (file instanceof TFolder) {
                    this.addFolderMeetingMenu(menu, file);
                }
            })
        );

        // Keep the dashboard view's sections live: when the vault or pipeline
        // changes (recording, transcription, enrichment, note creation)
        // re-render the tracked blocks in place. Debounced; each block
        // keeps the page the user was on (see blockPage), disconnected ones
        // are pruned on the next pass.
        this.agendaEvents.on("changed", () => this.scheduleDashboardRefresh());

        // Status bar
        this.statusBarEl = this.addStatusBarItem();
        this.statusBarEl.addClass("system-recording-hidden");
        // Hovering the status bar reveals the queue popover with the full list.
        this.registerDomEvent(this.statusBarEl, "mouseenter", () =>
            this.setStatusHover(true)
        );
        this.registerDomEvent(this.statusBarEl, "mouseleave", () =>
            this.setStatusHover(false)
        );

        // Commands
        this.addCommand({
            id: "start-recording",
            name: t().commands.startRecording,
            callback: () => void this.startAdHocMeeting(),
        });

        this.addCommand({
            id: "stop-recording",
            name: t().commands.stopRecording,
            callback: () => this.stopRecording(),
        });

        // Settings tab
        this.addSettingTab(new SystemRecordingSettingTab(this.app, this));

		this.addCommand({
			id: "authenticate-google-calendar",
			name: t().commands.authenticateCalendar,
			callback: () => void this.authenticateCalendar(),
		});

		this.addCommand({
			id: "toggle-calendar-auto-recording",
			name: t().commands.toggleCalendarAutoRecording,
			callback: async () => {
				this.settings.calendarAutoRecord = !this.settings.calendarAutoRecord;
				await this.saveSettings();
				void this.updateScheduler();
				new Notice(
					this.settings.calendarAutoRecord
						? t().notices.autoRecordEnabled
						: t().notices.autoRecordDisabled
				);
			},
		});

		this.addCommand({
			id: "enrich-meeting-note",
			name: t().commands.enrichNote,
			callback: () => void this.enrichActiveNote(),
		});

		this.addCommand({
			id: "fix-meeting-metadata",
			name: t().commands.fixMeetingMetadata,
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.looksLikeMeetingNote(file)) return false;
				if (!checking) this.fixMetadataForNote(file);
				return true;
			},
		});

		this.addCommand({
			id: "toggle-ai-notes",
			name: t().commands.toggleAiNotes,
			callback: () => void this.toggleAiNotes(),
		});

		this.addCommand({
			id: "cleanup-old-recordings",
			name: t().commands.cleanupRecordings,
			callback: () => void this.cleanupOldRecordings(true),
		});

		this.addCommand({
			id: "cancel-transcription",
			name: t().commands.cancelTranscription,
			callback: () => this.cancelActiveTranscription(),
		});

		// Dev-only (gated on the `mc:notif-debug` localStorage flag, off in
		// shipped builds): fire a sample meeting prompt after a delay so you can
		// click away first to test the system-notification (not-focused) path.
		// Watch the DevTools console (Cmd+Opt+I) filtered by `mc:notif`.
		if (notifDebugEnabled()) {
			this.addCommand({
				id: "debug-test-notification",
				name: "Debug test meeting notification",
				callback: () => {
					notifLog(
						"debug-test-notification: scheduled (4s) — click away now to test the system notification"
					);
					new Notice(
						"Test notification in 4s — click away to test the system notification",
						4000
					);
					window.setTimeout(() => {
						notifLog("debug-test-notification: firing", {
							focused: this.isWindowFocused(),
						});
						this.promptMeeting({
							key: "debug:test",
							title: "Test meeting",
							subtitle: "Debug notification",
							meetLink: "https://example.com/meet",
							onRecord: () =>
								notifLog("debug-test-notification: onRecord picked"),
							onOpenNote: () =>
								notifLog("debug-test-notification: onOpenNote picked"),
						});
					}, 4000);
				},
			});
		}

		// Once the vault index is ready, nudge the user about recordings that
		// finished but were never transcribed (e.g. a reload mid-transcription).
		this.app.workspace.onLayoutReady(() =>
			this.notifyPendingTranscriptions()
		);

		// Keep the in-session identity map accurate when the user moves or
		// deletes a note (#118) — metadataCache lag would otherwise recreate
		// a duplicate or trust a stale session claim.
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					notePathRenamed(oldPath, file.path);
					this.maybeSuggestMetadataFixOnMove(file, oldPath);
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile) notePathDeleted(file.path);
			})
		);

		// Start listening for metadataCache resolution immediately so enabling
		// calendar automation *after* the initial index doesn't wait 15s (#118).
		this.beginWatchingMetadataResolved();

		// Sweep expired recordings shortly after startup (never blocks load).
		this.retentionTimeout = window.setTimeout(() => {
			this.retentionTimeout = null;
			void this.cleanupOldRecordings(false);
		}, 15000);

		// Restore the AI-notes visibility toggle from the last session.
		document.body.toggleClass(HIDE_AI_CLASS, this.settings.hideAiNotes);

        // Recorder callbacks
        this.recorder.onStatus = (status: RecorderStatus) =>
            this.handleStatus(status);
        this.recorder.onError = (message: string) => {
            this.notifyRecordingError(message);
            // Fatal failures (spawn error / non-zero exit / terminal "error"
            // status) flip isRecording off before invoking onError. Skip while
            // attachRecording is in flight — a late exit line must not tear
            // down state mid-attach; attachRecording's finally owns that teardown.
            if (!this.recorder.isRecording && !this.attaching)
                this.resetRecordingUi();
        };

		void this.updateScheduler();
		requestNotificationPermission();
		this.logNotificationEnvironment();
		this.updateDetector();
		// When Obsidian becomes frontmost, swap any live OS-only prompt to the
		// in-app Notice (exclusive-channel policy).
		this.registerDomEvent(window, "focus", () => this.onPromptWindowFocused());
		// Electron can report isFocused=false while the document still has focus
		// (no window "focus" event will fire). Visibility flips also recover an
		// OS-only prompt when the user is already looking at Obsidian.
		this.registerDomEvent(document, "visibilitychange", () => {
			if (document.visibilityState === "visible") this.onPromptWindowFocused();
		});

    }

	/** One-shot startup dump so "no notifications" reports have concrete context. */
	private logNotificationEnvironment(): void {
		// Skip the probing entirely when tracing is off — `notifLog` would drop it
		// anyway, so there's no reason to compute focus state or poke the (flaky)
		// Electron seam on every startup.
		if (!notifDebugEnabled()) return;
		let remoteAvailable = false;
		try {
			const req = (window as unknown as { require?: (id: string) => unknown })
				.require;
			if (typeof req === "function") {
				const electron = req("electron") as
					| { remote?: { Notification?: unknown } }
					| undefined;
				remoteAvailable = !!electron?.remote?.Notification;
			}
		} catch {
			remoteAvailable = false;
		}
		notifLog("environment", {
			isMacOS: Platform.isMacOS,
			focused: this.isWindowFocused(),
			webPermission:
				typeof window !== "undefined" && window.Notification
					? window.Notification.permission
					: "n/a",
			electronRemoteNotification: remoteAvailable,
		});
	}

    onunload() {
        if (this.recorder.isRecording) {
            this.recorder.stop();
        }
        this.clearDurationTimer();
        this.clearActionStatus();
		void this.directoryCache.flush();
        if (this.retentionTimeout !== null) {
            window.clearTimeout(this.retentionTimeout);
            this.retentionTimeout = null;
        }
        if (this.dashboardRefreshTimer !== null) {
            window.clearTimeout(this.dashboardRefreshTimer);
            this.dashboardRefreshTimer = null;
        }
        if (this.moveFixTimer !== null) {
            window.clearTimeout(this.moveFixTimer);
            this.moveFixTimer = null;
        }
        this.pendingMoveFixes.clear();
        this.dashboardBlocks.clear();
		this.statusHovered = false;
		this.hideQueuePopover();
		this.taskQueue.cancelAll();
		this.scheduler?.stop();
		this.agendaEvents.clear();
		for (const renderer of this.liveActionRenderers) renderer.unload();
		this.liveActionRenderers.clear();
		for (const controller of this.meetingNotices.values())
			controller.dispose();
		this.meetingNotices.clear();
		this.stopPromptNotice?.dispose();
		this.stopPromptNotice = null;
		this.maxRecordingWarningNotice?.dispose();
		this.maxRecordingWarningNotice = null;
		this.silenceWarningNotice?.dispose();
		this.silenceWarningNotice = null;
		// Settle any in-flight auto-transcribe waits so their listeners/timers
		// don't outlive the plugin.
		for (const ac of this.pendingAutoTranscribe.values()) ac.abort();
		this.pendingAutoTranscribe.clear();
    }

    async loadSettings() {
        const raw = (await this.loadData()) as
            | (Partial<SystemRecordingSettings> & {
                  enrichBaseUrl?: string;
                  enrichApiKey?: string;
                  /** Retired: canonical family used to live in sttModel + wire id in sttModelId. */
                  sttModelId?: string;
              })
            | null;
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            migrateSettings(raw as Record<string, unknown> | null)
        );
        // Ensure per-CLI maps are independent copies, not shared with DEFAULT_SETTINGS
        this.settings.enrichCliPaths = { ...DEFAULT_SETTINGS.enrichCliPaths, ...this.settings.enrichCliPaths };
        this.settings.enrichCliModels = { ...DEFAULT_SETTINGS.enrichCliModels, ...this.settings.enrichCliModels };
        // Normalize the shared endpoint (tolerate hand-edited data.json).
        this.settings.apiBaseUrl = (this.settings.apiBaseUrl ?? "").trim();
        this.settings.apiKey = (this.settings.apiKey ?? "").trim();
        this.settings.fallbackApiBaseUrl = (
            this.settings.fallbackApiBaseUrl ?? ""
        ).trim();
        this.settings.fallbackApiKey = (this.settings.fallbackApiKey ?? "").trim();
        this.settings.sttApiBaseUrl = (this.settings.sttApiBaseUrl ?? "").trim();
        this.settings.sttApiKey = (this.settings.sttApiKey ?? "").trim();
        this.settings.sttFallbackApiBaseUrl = (this.settings.sttFallbackApiBaseUrl ?? "").trim();
        this.settings.sttFallbackApiKey = (this.settings.sttFallbackApiKey ?? "").trim();
        this.settings.fallbackSttModel = (
            this.settings.fallbackSttModel ?? ""
        ).trim();
        this.settings.fallbackEnrichModel = (
            this.settings.fallbackEnrichModel ?? ""
        ).trim();
        // Clamp the transcription engine + local model to known values so a
        // hand-edited/corrupt data.json can't persist an unknown engine (which
        // would fall through to remote in the UI but stay wrong on disk) or a
        // stale model id.
        if (this.settings.transcriptionBackend !== "local") {
            this.settings.transcriptionBackend = "remote";
        }
        // Own-property check, not `in`: `in` walks the prototype chain, so a
        // hand-edited "constructor"/"toString"/etc. would slip past the clamp.
        if (
            !Object.prototype.hasOwnProperty.call(
                LOCAL_MODELS,
                this.settings.localWhisperModel
            )
        ) {
            this.settings.localWhisperModel = DEFAULT_SETTINGS.localWhisperModel;
        }
        {
            const n = Number(this.settings.enrichTimeoutSeconds);
            this.settings.enrichTimeoutSeconds = Number.isFinite(n)
                ? Math.min(600, Math.max(60, Math.round(n)))
                : DEFAULT_SETTINGS.enrichTimeoutSeconds;
        }
        const VALID_ENRICH_BACKENDS = ["api", "claude-cli", "codex-cli", "opencode-cli", "pi-cli"] as const;
        if (!VALID_ENRICH_BACKENDS.includes(this.settings.enrichBackend as typeof VALID_ENRICH_BACKENDS[number])) {
            this.settings.enrichBackend = "api";
        }
        // Migrate the previously enrichment-only endpoint into the shared fields
        // when the shared ones are still unset or at the default.
        const legacyBase = raw?.enrichBaseUrl?.trim();
        const legacyKey = raw?.enrichApiKey?.trim();
        if (
            legacyBase &&
            (!this.settings.apiBaseUrl ||
                this.settings.apiBaseUrl === DEFAULT_SETTINGS.apiBaseUrl)
        ) {
            this.settings.apiBaseUrl = legacyBase;
        }
        if (legacyKey && !this.settings.apiKey) {
            this.settings.apiKey = legacyKey;
        }
        // Clamp a value to a valid engine family, inferring one when the value
        // is a free-form wire id (e.g. a gateway deployment name).
        const clampApiType = (m: string): SttApiType =>
            (STT_MODELS as readonly string[]).includes(m)
                ? (m as SttApiType)
                : inferSttApiType(m);
        // Migrate the old split (sttModel = canonical family, sttModelId = wire id)
        // into the new model: sttModel is the wire id, sttApiType is the family.
        const legacyModelId = raw?.sttModelId?.trim();
        if (legacyModelId) {
            this.settings.sttApiType = clampApiType(
                String(raw?.sttModel ?? DEFAULT_SETTINGS.sttModel)
            );
            this.settings.sttModel = legacyModelId;
        } else if (raw?.sttApiType === undefined) {
            // Pre-apiType data: derive the family from the model name.
            this.settings.sttApiType = clampApiType(this.settings.sttModel);
        }
        // Don't persist the retired keys back into data.json.
        const bag = this.settings as unknown as Record<string, unknown>;
        delete bag.enrichBaseUrl;
        delete bag.enrichApiKey;
        delete bag.sttModelId;
        delete bag.vadMode;
        // Guard against corrupt/hand-edited data selecting an unknown engine
        // family, which would silently fall through to the GPT-4o path.
        this.settings.sttApiType = clampApiType(this.settings.sttApiType);
        // The UI no longer exposes a separate no-timestamps Whisper: collapse
        // the retired "whisper-1" family into the timestamp-intent one. Real
        // transcriptions downgrade back to plain whisper-1 on the wire when the
        // endpoint doesn't actually return timestamps (see resolveEngineFamily),
        // so nothing breaks for backends that reject verbose_json.
        if (this.settings.sttApiType === "whisper-1") {
            this.settings.sttApiType = "whisper-1-ts";
        }
        // Keep the OAuth refresh token and client secret out of the synced/
        // committed data.json: load them from per-vault localStorage instead,
        // migrating any legacy plaintext copies that still live in data.json.
        const localTokens = this.loadLocal<StoredTokens>("googleTokens");
        const localSecret = this.loadLocal<string>("googleClientSecret");
        const legacyTokens = raw?.googleTokens ?? null;
        const legacySecret =
            typeof raw?.googleClientSecret === "string"
                ? raw.googleClientSecret
                : "";
        this.settings.googleTokens = localTokens ?? legacyTokens;
        // localStorage is authoritative: use its value even when it's an empty
        // string (an intentionally cleared secret) and only fall back to the
        // legacy data.json copy when localStorage has nothing at all.
        this.settings.googleClientSecret =
            typeof localSecret === "string" ? localSecret : legacySecret;
        // If data.json still carries either secret (whether or not localStorage
        // already has a copy), re-persist so it gets moved into localStorage and
        // stripped from the synced file — don't leave a stale plaintext copy behind.
        const legacyInDataJson =
            legacyTokens !== null || legacySecret !== "";
        if (legacyInDataJson) {
            await this.saveSettings();
        }
    }

    async saveSettings() {
        // Sensitive fields live in per-vault localStorage, never in the synced/
        // committed data.json. Strip a field from data.json only once we've
        // *verified* it was durably written to localStorage — otherwise (older
        // Obsidian without the API, or a write failure) keep it in data.json so
        // we never silently lose the user's calendar credentials. Persist each
        // field independently so a failure on one doesn't skip the other.
        const tokensStored = this.saveLocal(
            "googleTokens",
            this.settings.googleTokens
        );
        const secretStored = this.saveLocal(
            "googleClientSecret",
            this.settings.googleClientSecret || null
        );
        const persisted: Record<string, unknown> = { ...this.settings };
        if (tokensStored) delete persisted.googleTokens;
        if (secretStored) delete persisted.googleClientSecret;
        await this.saveData(persisted);
        // A settings change (excludedFolders, oneOnOneSeparately, either of
        // which changes what the scan considers) shouldn't leave "Notes with
        // issues" serving a stale cache/view until the next unrelated event.
        this.refreshNoteIssuesBlocks();
    }

    /** Per-vault localStorage key for a sensitive credential field. */
    private secretKey(name: string): string {
        return `meeting-copilot/${name}`;
    }

    /** Obsidian's per-vault localStorage helpers (added in 1.8.7), if present. */
    private localStore(): {
        load(key: string): unknown;
        save(key: string, value: unknown): void;
    } | null {
        const app = this.app as unknown as {
            loadLocalStorage?(key: string): unknown;
            saveLocalStorage?(key: string, value: unknown): void;
        };
        if (
            typeof app.loadLocalStorage === "function" &&
            typeof app.saveLocalStorage === "function"
        ) {
            return {
                load: (k) => app.loadLocalStorage!(k),
                save: (k, v) => app.saveLocalStorage!(k, v),
            };
        }
        return null;
    }

    /** Reads a JSON value from per-vault localStorage (null if absent/unavailable/corrupt). */
    private loadLocal<T>(name: string): T | null {
        const store = this.localStore();
        if (!store) return null;
        const v = store.load(this.secretKey(name));
        if (typeof v !== "string") return null;
        try {
            return JSON.parse(v) as T;
        } catch {
            // Corrupt entry — treat as absent so we fall back to legacy/none.
            return null;
        }
    }

    /**
     * Writes (or clears, when null) a JSON value to per-vault localStorage and
     * verifies the round-trip. Returns false when the API is unavailable or the
     * value didn't persist, so the caller can keep the value in data.json.
     */
    private saveLocal(name: string, value: unknown): boolean {
        const store = this.localStore();
        if (!store) return false;
        const key = this.secretKey(name);
        try {
            store.save(key, value == null ? null : JSON.stringify(value));
            const back = store.load(key);
            if (value == null) return back == null;
            return back === JSON.stringify(value);
        } catch {
            return false;
        }
    }

    // MARK: - Recording control

    /**
     * Ribbon mic behavior. While recording it stops. Otherwise, if a meeting
     * note is the active file, it offers a choice — record another take for that
     * meeting, or start a fresh ad-hoc one — so the ribbon is useful when you're
     * looking at a meeting (e.g. the person finally joined and you want to
     * record again). With no meeting note in focus it just starts an ad-hoc
     * meeting, exactly as before.
     */
    private onRibbonClick(evt: MouseEvent): void {
        if (this.recorder.isRecording) {
            this.stopRecording();
            return;
        }
        const active = this.app.workspace.getActiveFile();
        if (active && this.isMeetingNote(active)) {
            const meeting = this.agendaMeetingFromNote(active);
            const menu = new Menu();
            menu.addItem((item) =>
                item
                    // Mirror the agenda row: "Record again" once a take exists.
                    .setTitle(
                        meeting.recording
                            ? t().event.recordAgain
                            : t().ribbon.recordForMeeting(meeting.title)
                    )
                    .setIcon("mic")
                    .onClick(() => this.startRecordingForMeeting(meeting))
            );
            menu.addItem((item) =>
                item
                    .setTitle(t().ribbon.newAdhoc)
                    .setIcon("plus")
                    .onClick(() => void this.startAdHocMeeting())
            );
            menu.showAtMouseEvent(evt);
            return;
        }
        void this.startAdHocMeeting();
    }

    /**
     * Starts an unplanned meeting: creates a meeting note (default title, ready
     * to rename), opens it with the title selected, and records beside it. On
     * stop the recording follows the same link → transcribe → enrich pipeline
     * as calendar meetings.
     */
    private async startAdHocMeeting(): Promise<void> {
        if (!Platform.isMacOS) {
            new Notice(t().notices.macOnly);
            return;
        }
        const now = new Date();
        const info: MeetingEventInfo = {
            // A stable non-empty id makes it a recognized meeting note right
            // away and avoids note-path collisions with other ad-hoc meetings.
            id: `${ADHOC_ID_PREFIX}${now.getTime()}`,
            summary: t().adhoc.defaultTitle,
            start: now,
            end: new Date(now.getTime() + 60 * 60 * 1000),
            meetLink: null,
            location: "",
            htmlLink: "",
            attendees: [],
            organizer: null,
            iCalUID: null,
            recurringEventId: null,
            oneOnOnePartner: null,
            oneOnOnePartnerEmail: null,
        };
        try {
            const ref = await createMeetingNote(this.app, info, this.noteConfig());
            const leaf = this.app.workspace.getLeaf(false);
            await leaf.openFile(ref.file);
            this.selectNoteTitle(leaf);
            await this.startRecording(
                {
                    folder: ref.folder,
                    basename: ref.basename,
                    notePath: ref.notePath,
                    eventId: info.id,
                    note: ref.file,
                },
                { replaceCurrent: true }
            );
            new Notice(t().adhoc.started);
        } catch (e) {
            new Notice(
                t().notices.recordingError(
                    e instanceof Error ? e.message : String(e)
                )
            );
        }
    }

    /** Selects the H1 title in a freshly opened note so the user can rename it. */
    private selectNoteTitle(leaf: import("obsidian").WorkspaceLeaf): void {
        const view = leaf.view instanceof MarkdownView ? leaf.view : null;
        if (!view) return;
        const editor = view.editor;
        for (let i = 0; i < editor.lineCount(); i++) {
            const line = editor.getLine(i);
            if (line.startsWith("# ")) {
                editor.setSelection(
                    { line: i, ch: 2 },
                    { line: i, ch: line.length }
                );
                editor.focus();
                return;
            }
        }
    }

    private async startRecording(
        meeting: {
            folder: string;
            basename: string;
            notePath: string;
            eventId?: string;
            /** Calendar event end (epoch ms) for auto-stop; null/omitted for ad-hoc. */
            eventEnd?: number | null;
            note?: TFile;
        },
        opts?: { replaceCurrent?: boolean }
    ) {
        mcLog("recorder", "startRecording requested", {
            note: meeting.basename,
            eventId: meeting.eventId,
            isRecording: this.recorder.isRecording,
            starting: this.starting,
            replaceCurrent: opts?.replaceCurrent ?? false,
        });
        const replace = opts?.replaceCurrent ?? false;
        // Hold stop-prompt suppression for the whole handoff (stop → provision →
        // spawn) so a calendar/detector end can't kill the take we're starting.
        // Refcount: a second overlapping start that early-returns must not clear
        // suppression for an earlier handoff still in flight.
        if (replace) {
            this.dismissStopPrompt();
            this.dismissMaxRecordingWarning();
            this.dismissSilenceWarning();
            this.replacingDepth++;
        }
        try {
            if (this.recorder.isRecording) {
                // Back-to-back meetings: stop the prior recording (and let it finish
                // linking/auto-transcribing) before starting this one, so B's first
                // minutes aren't lost to an "already recording" bail.
                if (replace) {
                    await this.stopAndWait();
                } else {
                    console.warn(
                        "[Meeting Copilot][recorder] startRecording skipped: already recording"
                    );
                    new Notice(t().notices.alreadyRecording);
                    return;
                }
            }

            // A start is already in progress (binary provisioning may be awaiting)
            if (this.starting) {
                console.warn(
                    "[Meeting Copilot][recorder] startRecording skipped: a start is already in progress"
                );
                return;
            }

            if (!Platform.isMacOS) {
                new Notice(t().notices.macOnly);
                return;
            }

            this.starting = true;
            try {
                // Ensure the recorder helper runtime is present and verified: the
                // binary AND the whisper.framework dylib it links at launch (dyld
                // rejects the binary without it, so this guards recording too — not
                // just transcription).
                let binaryPath: string;
                try {
                    binaryPath = await this.ensureHelperRuntime();
                } catch (e) {
                    new Notice(e instanceof Error ? e.message : String(e));
                    return;
                }

                const adapter = this.app.vault.adapter;
                // Sampled once so the path extension and the helper's --format
                // can't diverge if the settings toggle flips during the awaits
                // below.
                const format = this.recordingFormat();

                // Meeting recordings go under a "Recordings" subfolder of the note's
                // own folder (configurable; empty = colocate beside the note).
                // A note at the vault root has folder "" (nothing to create).
                // Ensure the note's folder before its (nested) Recordings child,
                // so the subfolder mkdir can't fail on a missing parent.
                if (meeting.folder && !(await adapter.exists(meeting.folder))) {
                    await adapter.mkdir(meeting.folder);
                }
                const recFolder = this.recordingFolderFor(meeting.folder);
                if (
                    recFolder &&
                    recFolder !== meeting.folder &&
                    !(await adapter.exists(recFolder))
                ) {
                    await adapter.mkdir(recFolder);
                }
                const relativePath = await this.uniqueRecordingPath(
                    adapter,
                    recFolder,
                    meeting.basename,
                    format
                );
                this.currentMeetingNotePath = meeting.notePath;
                this.currentMeetingNote = meeting.note ?? null;
                this.currentRecordingEventId = meeting.eventId ?? null;
                this.currentRecordingEventEnd = meeting.eventEnd ?? null;

                this.currentRecordingPath = relativePath;
                const vaultBasePath =
                    adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
                const absolutePath = path.join(vaultBasePath, relativePath);

                // Start recording. --split writes the per-speaker sidecars only when
                // separation is actually usable, so we don't pay for them otherwise.
                // Re-arm the screen-recording-settings opener for this attempt: a
                // permission failure surfaces asynchronously via onError, and each
                // new recording attempt is a deliberate user action that should get
                // one fresh chance to deep-link to System Settings.
                this.screenSettingsOpened = false;
                const inputDeviceUid = await this.resolveInputDeviceUid(binaryPath);
                this.recorder.start(binaryPath, absolutePath, {
                    split: this.shouldSeparateSpeakers(),
                    format,
                    inputDeviceUid,
                });
                this.recordingStartTime = Date.now();
                this.maxRecordingCancelled = false;
                this.silenceCancelled = false;
                this.lastSilentSeconds = 0;
                this.startDurationTimer();
                this.updateRibbonIcon(true);
                this.agendaEvents.emit("changed", undefined);
                // A recording is now underway — drop every pending join/record/stop
                // prompt so a stale action can't kill this take.
                this.dismissAllLivePrompts();

                new Notice(t().notices.recordingStarted);
            } finally {
                this.starting = false;
            }
        } finally {
            if (replace) this.replacingDepth = Math.max(0, this.replacingDepth - 1);
        }
    }

    private stopRecording(opts?: { notice?: boolean }) {
        const showNotice = opts?.notice !== false;
        if (!this.recorder.isRecording) {
            if (showNotice) new Notice(t().notices.notRecording);
            return;
        }

        this.dismissStopPrompt();
        this.dismissMaxRecordingWarning();
        this.dismissSilenceWarning();
        if (this.recorder.hasStopBeenSignaled) {
            if (showNotice) new Notice(t().notices.stoppingRecording);
            return;
        }

        this.recorder.stop();
        this.agendaEvents.emit("changed", undefined);
        if (showNotice) new Notice(t().notices.stoppingRecording);
    }

    /** Stop-file written; helper has not yet reported `stopped`. */
    private isStopInProgress(): boolean {
        return this.recorder.isRecording && this.recorder.hasStopBeenSignaled;
    }

    /**
     * Stops the current recording and resolves once it has fully wound down —
     * the recorder has terminated and its file has been linked/handled — so a
     * back-to-back recording can start against clean state. Resolves immediately
     * when nothing is recording.
     */
    private stopAndWait(): Promise<void> {
        // "Fully wound down" means both the recorder has terminated *and* the
        // just-stopped file has finished linking/handling — not merely
        // `isRecording === false` — so a chained start begins against clean
        // shared state. Wait when either is still true.
        if (!this.recorder.isRecording && !this.attaching) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            this.stopWaiters.push(resolve);
            if (this.recorder.isRecording) this.recorder.stop();
        });
    }

    /** Resolves any pending back-to-back waiters once a stop has fully settled. */
    private resolveStopWaiters(): void {
        const waiters = this.stopWaiters;
        this.stopWaiters = [];
        for (const resolve of waiters) resolve();
    }

	// MARK: - Calendar integration

	isCalendarAuthenticated(): boolean {
		return this.oauth.isAuthenticated();
	}

	/** False for a community build compiled with no baked-in Google OAuth
	 * client id/secret (see `src/auth/credentials.ts`) — used by the settings
	 * tab to decide whether the Advanced Credentials section should expand
	 * itself by default (the user *must* fill it in) or stay collapsed (the
	 * common case, where bundled credentials already work). */
	hasBundledGoogleCredentials(): boolean {
		return Boolean(BUNDLED_CLIENT_ID && BUNDLED_CLIENT_SECRET);
	}

	/** Whether the current sign-in was granted the given scope — used by the
	 * settings tab to show a "re-authenticate to grant this" hint when a
	 * user turns an optional scope on after already having connected. */
	hasGoogleScope(scope: string): boolean {
		return this.oauth.hasScope(scope);
	}

	/**
	 * Coalesces concurrent callers onto one in-flight attempt: returns the same
	 * promise if already running, rather than opening a second browser tab/
	 * loopback server. {@link getAuthPromise} exposes that promise so the
	 * settings tab's Cancel button can await it even if a *different* click
	 * (e.g. from the agenda's Connect button) is the one that actually started
	 * it — the agenda view itself doesn't need this: it just reloads on the
	 * "changed" event this always emits below, regardless of who started or
	 * cancelled the attempt.
	 */
	authenticateCalendar(): Promise<void> {
		if (this.authPromise) return this.authPromise;
		const promise = this.runAuthenticateCalendar();
		this.authPromise = promise;
		void promise.finally(() => {
			this.authPromise = null;
		});
		return promise;
	}

	private async runAuthenticateCalendar(): Promise<void> {
		const abort = new AbortController();
		this.authAbort = abort;
		try {
			await this.oauth.authenticate(abort.signal);
			this.authExpired = false;
			// New consent / token — retry Groups expansion from a clean slate.
			this.resetGroupAttendeeExpansion();
			void this.updateScheduler();
		} catch (e) {
			if (e instanceof Error && e.name === "AbortError") {
				new Notice(t().oauth.cancelled);
			} else if (e instanceof CredentialsMissingError) {
				// Not just an inert error notice: take the user straight to
				// where they can fix it (the now always-expanded Advanced
				// Credentials section) instead of leaving them to hunt for it.
				new Notice(e.message);
				this.openPluginSettings();
			} else {
				new Notice(e instanceof Error ? e.message : String(e));
			}
		} finally {
			this.authAbort = null;
			// Fires on every outcome (success, real failure, or cancel) so any
			// open agenda view — even one created after this attempt started —
			// reloads out of its connecting/cancel state, not just the instance
			// that happened to click "Authenticate".
			this.agendaEvents.emit("changed", undefined);
		}
	}

	/** True while {@link authenticateCalendar} is waiting on the browser consent flow. */
	isAuthenticating(): boolean {
		return this.authAbort !== null;
	}

	/** True when a usable client id/secret pair (bundled or user-provided) is
	 * available — false for a community build with no bundled credentials
	 * until the user enters their own in the Advanced Credentials section. */
	hasGoogleCredentials(): boolean {
		return this.oauth.hasCredentials();
	}

	/** The in-flight {@link authenticateCalendar} call, if any — see that
	 * method's doc comment for why this is looked up fresh rather than cached
	 * per-view. */
	getAuthPromise(): Promise<void> | null {
		return this.authPromise;
	}

	/** Cancels an in-flight {@link authenticateCalendar} call, if any. */
	cancelAuthenticate(): void {
		this.authAbort?.abort();
	}

	/** Drop session expansion state so the next fetch re-looks up groups/names.
	 * Persistent positive hits stay; negative (miss) disk entries are cleared so
	 * a re-auth after enabling APIs/scopes can retry. */
	resetGroupAttendeeExpansion(): void {
		this.groupExpandGeneration++;
		this.groupExpandCache = new GroupExpandCache();
		this.personNameCache = new PersonNameCache();
		this.expandedAttendeesByEventId.clear();
		this.directoryCache.clearNegativeEntries();
		void this.directoryCache.flush();
	}

	/** Load `<pluginDir>/directory-cache.json` into {@link directoryCache}. */
	private async initDirectoryCache(): Promise<void> {
		const dir = this.manifest.dir;
		if (!dir) return;
		const path = normalizePath(`${dir}/${DIRECTORY_CACHE_FILENAME}`);
		const adapter = this.app.vault.adapter;
		this.directoryCache = new DirectoryCache({
			read: async () => {
				if (!(await adapter.exists(path))) return null;
				return adapter.read(path);
			},
			write: async (json) => {
				await adapter.write(path, json);
			},
		});
		await this.directoryCache.load();
		// Seed from the persisted timestamps so a reload's fresh rate limiter
		// doesn't start its local count at zero against Google's real,
		// server-side quota window (see PeopleApiRateLimiter's doc comment).
		this.peopleRateLimiter = new PeopleApiRateLimiter(
			PEOPLE_MAX_REQUESTS_PER_MINUTE,
			() => Date.now(),
			this.directoryCache.peopleRateLimitTimestamps,
			(timestamps) => this.directoryCache.setPeopleRateLimitTimestamps(timestamps)
		);
	}

	private createGroupDirectory() {
		return createCloudIdentityDirectory(
			this.oauth,
			this.directoryCache,
			this.settings.scopeGroupsEnabled
		);
	}

	private createPersonDirectory() {
		return createPeopleDirectory(this.oauth, {
			directoryCache: this.directoryCache,
			rateLimiter: this.peopleRateLimiter,
			debugLogging: this.settings.debugLogging,
			nameCache: this.personNameCache,
			enabled: this.settings.scopeDirectoryEnabled,
		});
	}

	/**
	 * The refresh token is permanently dead (tokens already cleared by the OAuth
	 * layer). Stop polling and show a single actionable "reconnect" notice — the
	 * agenda flips to its Connect state on its own since we're no longer
	 * authenticated. The flag stops the scheduler's per-poll error notice from
	 * also firing for this cycle.
	 */
	private onCalendarAuthExpired(): void {
		if (this.authExpired) return;
		this.authExpired = true;
		this.scheduler?.stop();
		this.dismissMeetingNotices(SystemRecordingPlugin.CAL_NOTICE_PREFIX, {
			keepOs: true,
		});
		this.agendaEvents.emit("changed", undefined);
		actionNotice(
			t().notices.calendarReconnect,
			t().notices.calendarReconnectAction,
			() => void this.authenticateCalendar()
		);
	}

	/**
	 * Starts the scheduler when any calendar automation is on (notifications,
	 * auto-start, or auto-stop) and we're authenticated; stops it otherwise.
	 * Auto-start/stop drive the scheduler on their own — they aren't inert just
	 * because the notification prompts are turned off.
	 *
	 * Waits (bounded) for metadataCache to resolve once before the first start
	 * so identity lookups don't create duplicate notes on a cold cache (#118).
	 */
	async updateScheduler(): Promise<void> {
		const shouldRun =
			(this.settings.calendarAutoRecord ||
				this.settings.calendarAutoStart ||
				this.settings.calendarAutoStop) &&
			this.oauth.isAuthenticated();
		if (shouldRun) {
			if (!this.scheduler) {
				this.scheduler = new CalendarScheduler({
					now: () => Date.now(),
					fetchEvents: (minMs, maxMs) => this.fetchCalendarEvents(minMs, maxMs),
					leadMs: () =>
						Math.max(0, this.settings.notifyBeforeStartMinutes) *
						60 * 1000,
					onEventUpcoming: (event) => this.handleEventUpcoming(event),
					onEventStart: (event) => this.handleEventStart(event),
					onEventEnd: (event) => this.handleEventEnd(event),
					onError: (message) => {
						// A dead-token error is handled by onCalendarAuthExpired
						// (which shows a reconnect prompt); don't also loop the raw error.
						if (this.authExpired) return;
						new Notice(t().notices.calendarError(message));
					},
					registerInterval: (id) => this.registerInterval(id),
				});
			}
			if (!this.scheduler.isRunning) {
				await this.awaitMetadataResolvedOnce();
				// Re-check after the await: a concurrent void updateScheduler()
				// may have disabled automation while we waited on metadata.
				const stillShouldRun =
					(this.settings.calendarAutoRecord ||
						this.settings.calendarAutoStart ||
						this.settings.calendarAutoStop) &&
					this.oauth.isAuthenticated();
				if (stillShouldRun && !this.scheduler.isRunning) {
					this.scheduler.start();
				}
			}
		} else {
			this.scheduler?.stop();
			// No more boundary callbacks will fire, so sweep any calendar prompts'
			// in-app notices rather than leaving them stale (detection prompts,
			// driven separately, are left alone). Keep the OS notifications in
			// Notification Center so a missed prompt stays recoverable there.
			this.dismissMeetingNotices(SystemRecordingPlugin.CAL_NOTICE_PREFIX, {
				keepOs: true,
			});
		}
	}

	/**
	 * Resolves after the first `metadataCache.on("resolved")` (or a 15s timeout
	 * so a stuck index can't block calendar automation forever). Listening
	 * starts in {@link beginWatchingMetadataResolved} at load so enabling
	 * calendar later doesn't miss the initial resolution and wait on timeout.
	 */
	private metadataHasResolved = false;
	private metadataResolvedOnce: Promise<void> | null = null;
	private beginWatchingMetadataResolved(): void {
		if (this.metadataResolvedOnce) return;
		this.metadataResolvedOnce = new Promise((resolve) => {
			const finish = (): void => {
				if (this.metadataHasResolved) return;
				this.metadataHasResolved = true;
				window.clearTimeout(timeout);
				this.app.metadataCache.offref(ref);
				resolve();
			};
			const timeout = window.setTimeout(finish, 15_000);
			const ref = this.app.metadataCache.on("resolved", finish);
			// If the vault finished indexing before we registered (plugin enabled
			// mid-session / after Obsidian's initial resolve), don't wait on the
			// timeout — treat a populated cache as already warm.
			window.setTimeout(() => {
				if (this.metadataHasResolved) return;
				const files = this.app.vault.getMarkdownFiles();
				if (files.length === 0) {
					finish();
					return;
				}
				for (const f of files.slice(0, 20)) {
					if (this.app.metadataCache.getFileCache(f)) {
						finish();
						return;
					}
				}
			}, 0);
		});
	}
	private awaitMetadataResolvedOnce(): Promise<void> {
		if (this.metadataHasResolved) return Promise.resolve();
		this.beginWatchingMetadataResolved();
		return this.metadataResolvedOnce!;
	}

	/** Re-poll the calendar immediately (e.g. after changing the target calendar). No-op if not running. */
	refreshCalendarNow(): void {
		void this.scheduler?.poll();
	}

	// MARK: - Meeting detection (Tier 1, macOS)

	/** Starts/stops the meeting-detection poller based on settings (macOS only). */
	updateDetector(): void {
		if (this.detectorIntervalId !== null) {
			window.clearInterval(this.detectorIntervalId);
			this.detectorIntervalId = null;
		}
		const enabled = this.enabledProbeApps();
		// Don't poll if disabled, off-platform, or no probe is enabled (an empty
		// probe set would otherwise be read as "all meetings ended"). Drop the
		// detector so a later re-enable starts from a clean state (no stale
		// "active" app that would false-end an unrelated recording).
		if (
			!this.settings.detectMeetings ||
			enabled.size === 0 ||
			!Platform.isMacOS
		) {
			this.detector = null;
			// No probe will fire onEnd now, so sweep any detection prompts'
			// in-app notices (mirrors the calendar sweep when the scheduler stops),
			// keeping their OS notifications in Notification Center.
			this.dismissMeetingNotices("detect:", { keepOs: true });
			return;
		}
		if (!this.detector) {
			this.detector = new MeetingDetector({
				probe: () => this.probeMeetings(),
				onStart: (app) => this.onMeetingDetected(app),
				onEnd: (app) => this.onMeetingEnded(app),
				onError: (e) => console.error("Meeting detection probe failed", e),
			});
		} else {
			// A probe may have just been disabled — forget it silently (not an end).
			this.detector.retainOnly(enabled);
		}
		const seconds = Math.min(
			120,
			Math.max(3, this.settings.detectionIntervalSeconds)
		);
		void this.detector.poll();
		this.detectorIntervalId = window.setInterval(
			() => void this.detector?.poll(),
			seconds * 1000
		);
		this.registerInterval(this.detectorIntervalId);
	}

	/** The conferencing app names currently enabled for detection. */
	private enabledProbeApps(): Set<string> {
		const apps = new Set<string>();
		if (this.settings.detectZoom) apps.add("Zoom");
		if (this.settings.detectGoogleMeet) apps.add("Google Meet");
		return apps;
	}

	/** Collects the set of conferencing apps currently in a meeting. */
	private async probeMeetings(): Promise<Set<string>> {
		const active = new Set<string>();
		const checks: Promise<void>[] = [];
		if (this.settings.detectZoom) {
			checks.push(
				zoomInMeeting().then((on) => {
					if (on) active.add("Zoom");
				})
			);
		}
		if (this.settings.detectGoogleMeet) {
			checks.push(
				googleMeetActive().then((on) => {
					if (on) active.add("Google Meet");
				})
			);
		}
		await Promise.all(checks);
		return active;
	}

	/** Offers to record when a meeting is detected — unless we're already recording. */
	private onMeetingDetected(app: string): void {
		if (this.recorder.isRecording) return;
		// A calendar meeting happening right now already produced its own
		// (scheduler) notification — don't stack a second detection prompt for
		// what is almost certainly the same meeting. (No scheduler / no live
		// event ⇒ this is an unplanned meeting, so still prompt.)
		if (this.scheduler?.isRunning && this.scheduler.hasActiveEvent()) return;
		// A detected meeting has no calendar link to join, so only offer Record.
		this.promptMeeting({
			key: `detect:${app}`,
			title: t().detect.detected(app),
			subtitle: t().event.startingNow,
			meetLink: null,
			onRecord: () => void this.startAdHocMeeting(),
		});
	}

	/**
	 * When a detected meeting ends, offer to stop the recording by default, for
	 * both ad-hoc and scheduled recordings — unless `detectionAutoStop` is on,
	 * in which case it stops automatically instead. This is deliberately a
	 * separate opt-in from `calendarAutoStop` (see {@link handleEventEnd}): a
	 * meeting that runs past its *calendar* slot shouldn't be cut off just
	 * because the scheduled end time passed, but once the detector sees the
	 * meeting itself actually end, that's a real signal.
	 */
	private onMeetingEnded(app: string): void {
		// The detected meeting is over, so a pending "record?" prompt for it is
		// moot — drop its in-app notice whether or not we go on to stop/offer a
		// stop below, but keep the OS notification recoverable in Notification
		// Center.
		this.dismissMeetingNotice(`detect:${app}`, { keepOs: true });
		// Ignore if detection was disabled meanwhile (an in-flight poll's onEnd
		// must not prompt after the user opted out), and only act once *all*
		// detected meetings have ended so one of several concurrent calls ending
		// doesn't prompt while another is still live.
		if (!this.detector || this.detector.activeCount() > 0) return;
		if (!this.recorder.isRecording) return;
		if (this.settings.detectionAutoStop) {
			const title =
				this.currentMeetingNote?.basename ?? t().adhoc.defaultTitle;
			new Notice(t().event.autoStopped(title));
			this.stopRecording({ notice: false });
			return;
		}
		this.promptStopRecording(t().detect.ended(app), t().event.stopRecordingPrompt);
	}

	/**
	 * Posts a meeting prompt on exactly one channel so surfaces never stack:
	 *
	 *  - **Focused** → in-app Notice only.
	 *  - **Unfocused** → native OS notification only; when Obsidian becomes
	 *    frontmost, {@link onPromptWindowFocused} closes the OS handle and shows
	 *    the in-app Notice.
	 *
	 * The returned controller's `dispose()` closes the OS notification by default
	 * (supersede / user action); housekeeping sweeps pass `{ keepOs: true }` to
	 * leave it in Notification Center so a missed prompt stays recoverable.
	 */
	private startOsPrompt(opts: {
		title: string;
		body: string;
		webHint: string;
		/** Native/web body click (Obsidian is already brought to the front). */
		onClick: () => void;
		/** Native action buttons (first = default). */
		actions: OsNotificationAction[];
		/** Builds the in-app notice (called when focused, or on focus-swap). */
		showInApp: () => InAppHandle;
	}): DualChannelController {
		const focused = this.isWindowFocused();
		notifLog("startOsPrompt", {
			title: opts.title,
			focused,
			actions: opts.actions.length,
		});
		const controller = startDualChannelPrompt({
			focused,
			showInApp: () => {
				notifLog("startOsPrompt: showInApp -> creating in-app notice", {
					title: opts.title,
				});
				return opts.showInApp();
			},
			showOs: (fallbackToInApp) => {
				notifLog("startOsPrompt: unfocused -> posting OS notification", {
					title: opts.title,
				});
				return notifyOs({
					title: opts.title,
					body: opts.body,
					webHint: opts.webHint,
					onClick: opts.onClick,
					actions: opts.actions,
					onShown: () => {
						notifLog("startOsPrompt: onShown (OS delivered)", {
							title: opts.title,
						});
						// A system notification reached the screen — a good moment
						// to teach (once) how to make them show/persist reliably.
						this.maybeShowNotificationStyleHint();
					},
					onFailed: () => {
						notifLog("startOsPrompt: onFailed (OS could not show)", {
							title: opts.title,
						});
						fallbackToInApp();
					},
				});
			},
		});
		// Electron's isFocused can disagree with document.hasFocus while the user
		// is already in Obsidian — recover the in-app Notice immediately so the
		// exclusive-channel path doesn't leave them with only an OS banner.
		if (
			!focused &&
			typeof document !== "undefined" &&
			document.visibilityState === "visible" &&
			document.hasFocus()
		) {
			controller.onBecameFocused();
		}
		return controller;
	}

	/**
	 * Obsidian became frontmost: swap every live OS-only prompt to its in-app
	 * Notice so the full action set is waiting in the window.
	 */
	private onPromptWindowFocused(): void {
		this.stopPromptNotice?.onBecameFocused();
		this.maxRecordingWarningNotice?.onBecameFocused();
		this.silenceWarningNotice?.onBecameFocused();
		for (const controller of this.meetingNotices.values()) {
			controller.onBecameFocused();
		}
	}

	/**
	 * True when Obsidian's window is actually frontmost and visible — so an
	 * in-app notice would be seen. Prefers Electron's `BrowserWindow` state
	 * (reliable), falling back to the document's focus/visibility when `remote`
	 * isn't reachable. Logs the raw signals so a focus-detection regression is
	 * visible in traces.
	 */
	private isWindowFocused(): boolean {
		const doc = typeof document !== "undefined" ? document : null;
		const hasFocus = !!doc && doc.hasFocus();
		const visibilityState = doc ? doc.visibilityState : "n/a";
		let win: BrowserWindowState | null = null;
		try {
			const req = (window as unknown as { require?: (id: string) => unknown })
				.require;
			const electron =
				typeof req === "function"
					? (req("electron") as
							| {
									remote?: {
										getCurrentWindow?: () => {
											isFocused: () => boolean;
											isMinimized: () => boolean;
											isVisible: () => boolean;
										};
									};
							  }
							| undefined)
					: undefined;
			const current = electron?.remote?.getCurrentWindow?.();
			if (current) {
				win = {
					isFocused: current.isFocused(),
					isMinimized: current.isMinimized(),
					isVisible: current.isVisible(),
				};
			}
		} catch (err) {
			notifLog("isWindowFocused: remote threw", { err: String(err) });
		}
		const result = decideWindowFocused({ win, visibilityState, hasFocus });
		notifLog("isWindowFocused", {
			hasFocus,
			visibilityState,
			isFocused: win?.isFocused ?? null,
			isMinimized: win?.isMinimized ?? null,
			isVisible: win?.isVisible ?? null,
			result,
		});
		return result;
	}

	/**
	 * Opens macOS System Settings at the Notifications pane. macOS won't let an
	 * app change these for you, so this is the one-click path to the two settings
	 * meeting prompts need: the global "Allow notifications when mirroring or
	 * sharing the display" toggle (so they appear *while recording* instead of
	 * landing silently in Notification Center) and Obsidian's row set to "Alerts"
	 * (so they persist on screen with a button). Both live on this pane.
	 */
	openMacNotificationSettings(): void {
		if (!Platform.isMacOS) return;
		execFile(
			"open",
			["x-apple.systempreferences:com.apple.Notifications-Settings.extension"],
			(err) => {
				if (err)
					console.warn("Failed to open Notification settings", err);
			}
		);
	}

	/**
	 * One-time onboarding tip: the first time a meeting notification is shown,
	 * point the user at the macOS "Alerts" style so notifications stay on screen
	 * (with their buttons) instead of auto-dismissing. Never nags again.
	 */
	private maybeShowNotificationStyleHint(): void {
		if (!Platform.isMacOS || this.settings.notificationStyleHintShown) return;
		this.settings.notificationStyleHintShown = true;
		void this.saveSettings();
		multiActionNotice(t().notices.notificationStyleHint, [
			{
				label: t().notices.openNotificationSettings,
				onClick: () => this.openMacNotificationSettings(),
				cta: true,
			},
			{ label: t().event.dismiss, onClick: () => undefined },
		]);
	}

	/**
	 * Offers to stop the current recording (a recording never stops on its own)
	 * on a single channel: in-app Notice when focused, OS notification when not.
	 * Supersedes every live prompt so end-of-meeting triggers that overlap
	 * (detected-meeting end + calendar event end) don't stack.
	 */
	private promptStopRecording(title: string, body: string): void {
		// A back-to-back replace is stopping/starting on purpose — don't nag, and
		// don't leave a stop action that could kill the next take.
		if (this.replacingDepth > 0) {
			notifLog("promptStopRecording: suppressed (replace in flight)", {
				title,
			});
			return;
		}
		if (this.isStopInProgress()) {
			notifLog("promptStopRecording: suppressed (stop in progress)", {
				title,
			});
			return;
		}
		notifLog("promptStopRecording", { title, body });
		this.dismissAllLivePrompts();
		const stop = (): void => {
			// Tear down our own prompt first (hides the in-app notice and closes
			// the OS notification) so nothing stale survives the stop.
			this.dismissStopPrompt();
			this.stopRecording();
		};
		this.stopPromptNotice = this.startOsPrompt({
			title,
			body,
			webHint: t().event.notificationWebHint,
			// Body click focuses Obsidian (handled by notifyOs); the in-app Notice
			// appears via onBecameFocused with the Stop action.
			onClick: () => {},
			actions: [{ text: t().event.stopRecordingAction, run: stop }],
			showInApp: () =>
				actionNotice(`${title} — ${body}`, t().event.stopRecordingAction, stop),
		});
	}

	/**
	 * Prompts the user to act on an upcoming/starting meeting on a single channel
	 * (in-app Notice when focused, OS notification when not). No modal — the
	 * Notice / native action button carry Join, Record, Join & record, Open note.
	 *
	 * `onRecord` is the record action; a valid https `meetLink` adds the Join
	 * affordances, and an `onOpenNote` adds an "Open note" action (Granola-style).
	 */
	private promptMeeting(opts: {
		/** Stable per-meeting key (used for bookkeeping; a new prompt clears all). */
		key: string;
		title: string;
		subtitle: string;
		meetLink: string | null;
		onRecord: () => void;
		/** Opens (creating if needed) the meeting note without recording. Omitted for ad-hoc/detected meetings. */
		onOpenNote?: () => void;
		/** Called whenever the user opens the link (Join / Join & record), so the auto-open at start can be suppressed. */
		onLinkOpened?: () => void;
	}): void {
		notifLog("promptMeeting", {
			key: opts.key,
			title: opts.title,
			hasLink: !!opts.meetLink,
		});
		const link =
			opts.meetLink && opts.meetLink.startsWith("https://")
				? opts.meetLink
				: null;
		// Every channel shares these handlers, and each first dismisses the live
		// prompt for this meeting so acting from the OS notification doesn't leave
		// a parallel in-app Notice after a focus-swap.
		const dismissNotice = (): void => this.dismissMeetingNotice(opts.key);
		const onRecord = (): void => {
			dismissNotice();
			opts.onRecord();
		};
		const onOpenNote = opts.onOpenNote
			? (): void => {
					dismissNotice();
					opts.onOpenNote?.();
				}
			: null;
		const onJoin = link
			? (): void => {
					dismissNotice();
					opts.onLinkOpened?.();
					this.openMeetingLink(link);
				}
			: null;
		const onJoinAndRecord = link
			? (): void => {
					dismissNotice();
					opts.onLinkOpened?.();
					this.openMeetingLink(link);
					opts.onRecord();
				}
			: null;

		// Action order mirrors Granola: a combined primary (Join & record) when
		// there's a link — else Record — then Join, then Open note. Only the first
		// becomes the OS notification's button; the full set stays in the in-app
		// notice. When already recording, primary labels warn that the current
		// take will stop.
		const e = t().event;
		const stopsCurrent = this.recorder.isRecording;
		const actions: NoticeAction[] = [];
		if (onJoinAndRecord) {
			actions.push({
				label: stopsCurrent ? e.joinAndRecordStopsCurrent : e.joinAndRecord,
				onClick: onJoinAndRecord,
				cta: true,
			});
			if (onJoin) actions.push({ label: e.join, onClick: onJoin });
		} else {
			actions.push({
				label: stopsCurrent ? e.recordStopsCurrent : e.record,
				onClick: onRecord,
				cta: true,
			});
		}
		if (onOpenNote)
			actions.push({ label: e.openNote, onClick: onOpenNote });

		// One prompt surface at a time — drop every live meeting/stop prompt
		// before posting this one.
		this.dismissAllLivePrompts();
		this.meetingNotices.set(
			opts.key,
			this.startOsPrompt({
				title: opts.title,
				body: opts.subtitle,
				webHint: e.notificationWebHint,
				// Body click focuses Obsidian; the in-app Notice (full actions)
				// appears via onBecameFocused. No modal.
				onClick: () => {},
				// macOS/Electron renders a *single* action as a named inline
				// button but collapses two-or-more into a generic "Options ▾"
				// dropdown. Users want the named default button, so the OS
				// notification carries only the primary action; the rest stay one
				// tap away via the in-app notice after focus.
				actions: actions
					.slice(0, 1)
					.map((a) => ({ text: a.label, run: a.onClick })),
				showInApp: () =>
					multiActionNotice(
						`${opts.title} — ${opts.subtitle}`,
						actions,
						// Once the user picks an action the notice is gone — drop
						// our bookkeeping entry so the map only ever holds live
						// prompts.
						() => this.meetingNotices.delete(opts.key)
					),
			})
		);
	}

	/** Prefix for calendar-event prompt keys (vs. `detect:` for detected meetings). */
	private static readonly CAL_NOTICE_PREFIX = "cal:";

	/** Drops the live stop-recording prompt, if any. */
	private dismissStopPrompt(): void {
		this.stopPromptNotice?.dispose();
		this.stopPromptNotice = null;
	}

	/** Drops the live max-recording-length warning prompt, if any. */
	private dismissMaxRecordingWarning(): void {
		this.maxRecordingWarningNotice?.dispose();
		this.maxRecordingWarningNotice = null;
	}

	/**
	 * Warns that the recording is about to hit `maxRecordingHours` and will be
	 * force-stopped, with a "Keep recording" action to cancel. Same single-channel
	 * (in-app when focused, OS notification otherwise) pattern as
	 * {@link promptStopRecording} — a stuck/forgotten recording is exactly the
	 * case where the user may be away from Obsidian, so the OS channel matters
	 * here more than most prompts. Also supersedes every other live prompt, same
	 * as {@link promptStopRecording}, so this doesn't stack a second overlapping
	 * OS notification on top of e.g. a live "meeting ended, stop?" prompt.
	 */
	private promptMaxRecordingWarning(maxHours: number): void {
		this.dismissAllLivePrompts();
		const title = t().event.maxRecordingWarningTitle;
		const body = t().event.maxRecordingWarning(maxHours);
		const keepRecording = (): void => {
			this.dismissMaxRecordingWarning();
			this.maxRecordingCancelled = true;
		};
		this.maxRecordingWarningNotice = this.startOsPrompt({
			title,
			body,
			webHint: t().event.notificationWebHint,
			onClick: () => {},
			actions: [{ text: t().event.maxRecordingWarningCancel, run: keepRecording }],
			showInApp: () =>
				actionNotice(
					`${title} — ${body}`,
					t().event.maxRecordingWarningCancel,
					keepRecording
				),
		});
	}

	/**
	 * Safety net against a forgotten/stuck recording (a real ~15h accidental
	 * recording OOM-crashed transcription once — see `vadWindows.ts`'s duration
	 * guard). Warns `AUTO_STOP_WARNING_SECONDS` before `maxRecordingHours`
	 * with a chance to cancel, then force-stops. Driven by the 1s duration-timer
	 * tick rather than its own `setTimeout`, so it naturally tracks wall-clock
	 * elapsed time (including any sleep gap the tick's own sleep-detection
	 * branch already accounts for) without a second timer to keep in sync.
	 */
	private checkMaxRecordingLength(elapsedSeconds: number): void {
		// A stop already in flight (stop-file written, helper still finalizing)
		// must not re-fire "stop"/re-notice every tick until the helper's
		// "stopped" status lands and clears the duration timer — finalize scales
		// with recording length, so for the very long recordings this exists to
		// catch, that window is the opposite of instant.
		if (!this.recorder.isRecording || this.isStopInProgress()) return;
		const maxHours = this.settings.maxRecordingHours;
		const action = maxRecordingAction({
			elapsedSeconds,
			maxHours,
			warningSeconds: AUTO_STOP_WARNING_SECONDS,
			warningAlreadyShown: this.maxRecordingWarningNotice !== null,
			cancelled: this.maxRecordingCancelled,
		});
		switch (action) {
			case "stop":
				this.dismissMaxRecordingWarning();
				new Notice(t().event.maxRecordingStopped(maxHours));
				this.stopRecording({ notice: false });
				break;
			case "warn":
				this.promptMaxRecordingWarning(maxHours);
				break;
			case "none":
				break;
		}
	}

	/** Drops the live silence-based auto-stop warning prompt, if any. */
	private dismissSilenceWarning(): void {
		this.silenceWarningNotice?.dispose();
		this.silenceWarningNotice = null;
	}

	/**
	 * Warns that the recording has seen no speech for `silenceAutoStopMinutes`
	 * and will be force-stopped, with a "Keep recording" action to cancel. Same
	 * single-channel dual-prompt pattern — including superseding every other
	 * live prompt — as {@link promptMaxRecordingWarning}.
	 */
	private promptSilenceWarning(thresholdMinutes: number): void {
		this.dismissAllLivePrompts();
		const title = t().event.silenceWarningTitle;
		const body = t().event.silenceWarning(thresholdMinutes);
		const keepRecording = (): void => {
			this.dismissSilenceWarning();
			this.silenceCancelled = true;
		};
		this.silenceWarningNotice = this.startOsPrompt({
			title,
			body,
			webHint: t().event.notificationWebHint,
			onClick: () => {},
			actions: [{ text: t().event.maxRecordingWarningCancel, run: keepRecording }],
			showInApp: () =>
				actionNotice(
					`${title} — ${body}`,
					t().event.maxRecordingWarningCancel,
					keepRecording
				),
		});
	}

	/**
	 * Earlier, more targeted safety net than {@link checkMaxRecordingLength}:
	 * stops a recording that's had no detected speech on either stream for
	 * `silenceAutoStopMinutes` — the common real shape of a forgotten
	 * recording (an empty room, not necessarily an open meeting app). Reads
	 * `lastSilentSeconds`, kept fresh by `handleStatus`'s `"recording"` branch
	 * from the helper's live status heartbeat (roughly every 0.5s), rather than
	 * anything computed from the duration-timer tick itself.
	 */
	private checkSilenceAutoStop(): void {
		// See the same guard in checkMaxRecordingLength: a stop already in
		// flight must not re-fire every tick while finalize is still running.
		if (!this.recorder.isRecording || this.isStopInProgress()) return;
		const thresholdMinutes = this.settings.silenceAutoStopMinutes;
		const action = silenceAutoStopAction({
			silentSeconds: this.lastSilentSeconds,
			thresholdMinutes,
			warningSeconds: AUTO_STOP_WARNING_SECONDS,
			warningAlreadyShown: this.silenceWarningNotice !== null,
			cancelled: this.silenceCancelled,
		});
		switch (action) {
			case "stop":
				this.dismissSilenceWarning();
				new Notice(t().event.silenceStopped(thresholdMinutes));
				this.stopRecording({ notice: false });
				break;
			case "warn":
				this.promptSilenceWarning(thresholdMinutes);
				break;
			case "none":
				break;
		}
	}

	/**
	 * Drops every live meeting + stop prompt (closes OS unless a caller already
	 * disposed with keepOs). Used when starting a recording or posting a new
	 * exclusive prompt so stale actions can't fire.
	 */
	private dismissAllLivePrompts(): void {
		for (const controller of this.meetingNotices.values()) {
			controller.dispose();
		}
		this.meetingNotices.clear();
		this.dismissStopPrompt();
		this.dismissMaxRecordingWarning();
		this.dismissSilenceWarning();
	}

	/**
	 * Dismisses the persistent meeting prompt for one key (if any). Used once a
	 * decision has been made for the meeting (auto-start fired, we're already
	 * recording it, or it just ended) so a now-stale prompt doesn't linger or
	 * stack under a new one.
	 *
	 * Housekeeping callers (a meeting that just ended, not a user action) pass
	 * `{ keepOs: true }` so the OS notification stays in Notification Center and a
	 * missed prompt remains recoverable there.
	 */
	private dismissMeetingNotice(
		key: string,
		opts?: { keepOs?: boolean }
	): void {
		this.meetingNotices.get(key)?.dispose(opts);
		this.meetingNotices.delete(key);
	}

	/**
	 * Dismisses every live prompt whose key starts with `prefix`. Housekeeping
	 * sweeps (scheduler/detector turned off, auth expired) pass `{ keepOs: true }`
	 * so the OS notifications survive in Notification Center.
	 */
	private dismissMeetingNotices(
		prefix: string,
		opts?: { keepOs?: boolean }
	): void {
		for (const [key, controller] of this.meetingNotices) {
			if (!key.startsWith(prefix)) continue;
			controller.dispose(opts);
			this.meetingNotices.delete(key);
		}
	}

	private async fetchCalendarEvents(
		minMs: number,
		maxMs: number
	): Promise<ScheduledEvent[]> {
		const events = await listEvents(
			this.oauth,
			this.settings.calendarId,
			new Date(minMs),
			new Date(maxMs),
			250,
			parseKeywords(this.settings.exclusionKeywords),
			this.settings.excludeWithoutMeetingLink
		);
		this.applyCachedExpandedAttendees(events);
		this.scheduleGroupAttendeeExpand(events);
		return events.map((e) => ({
			id: e.id,
			summary: e.summary,
			start: e.start.getTime(),
			end: e.end.getTime(),
			meetLink: e.meetLink,
			location: e.location,
			htmlLink: e.htmlLink,
			attendees: e.attendees,
			invitees: e.invitees,
			organizer: e.organizer,
			iCalUID: e.iCalUID,
			recurringEventId: e.recurringEventId,
			oneOnOnePartner: e.oneOnOnePartner,
			oneOnOnePartnerEmail: e.oneOnOnePartnerEmail,
		}));
	}

	/**
	 * Overlay any already-expanded attendee labels onto freshly fetched events
	 * so a re-poll doesn't flash raw group labels after a prior expansion.
	 * Drops cache entries whose invitee fingerprint no longer matches.
	 */
	private applyCachedExpandedAttendees(
		events: Array<{
			id: string;
			attendees: string[];
			invitees: ExpandableAttendee[];
		}>
	): void {
		for (const ev of events) {
			const cached = this.expandedAttendeesByEventId.get(ev.id);
			if (!cached) continue;
			const fp = inviteeFingerprint(ev.invitees);
			if (cached.fingerprint !== fp) {
				this.expandedAttendeesByEventId.delete(ev.id);
				continue;
			}
			ev.attendees = cached.labels;
		}
	}

	/**
	 * Expand Google Group invitees in the background after the calendar UI has
	 * already rendered with raw labels. Soft-fails; successful results are
	 * cached for the session (keyed by invitee fingerprint) and trigger an
	 * agenda/dashboard refresh when anything changes.
	 */
	private scheduleGroupAttendeeExpand(
		events: Array<{
			id: string;
			attendees: string[];
			invitees: ExpandableAttendee[];
		}>
	): void {
		const pending = events.filter((ev) => {
			if (ev.invitees.length === 0) return false;
			const cached = this.expandedAttendeesByEventId.get(ev.id);
			if (!cached) return true;
			return cached.fingerprint !== inviteeFingerprint(ev.invitees);
		});
		if (pending.length === 0) return;
		const generation = ++this.groupExpandGeneration;
		void this.runGroupAttendeeExpand(pending, generation);
	}

	private async runGroupAttendeeExpand(
		events: Array<{
			id: string;
			attendees: string[];
			invitees: ExpandableAttendee[];
		}>,
		generation: number
	): Promise<void> {
		// Allow one network retry per background pass after a prior soft-fail
		// (e.g. API enabled / scopes granted mid-session). Keep People disabled
		// while a 429 cooldown is active so we don't re-blast the quota.
		this.groupExpandCache.disabled = false;
		if (!this.directoryCache.peopleIsRateLimited()) {
			this.personNameCache.disabled = false;
		}
		const dir = this.createGroupDirectory();
		const people = this.createPersonDirectory();
		const opts = {
			maxPeople: Math.max(
				1,
				this.settings.groupExpandMaxMembers ||
					DEFAULT_GROUP_EXPAND_MAX_MEMBERS
			),
		};
		let changed = false;
		for (const ev of events) {
			if (generation !== this.groupExpandGeneration) return;
			const fp = inviteeFingerprint(ev.invitees);
			const existing = this.expandedAttendeesByEventId.get(ev.id);
			if (existing && existing.fingerprint === fp) continue;
			try {
				const labels = await mapAttendeesExpanded(
					ev.invitees,
					dir,
					opts,
					this.groupExpandCache,
					people,
					this.personNameCache
				);
				if (generation !== this.groupExpandGeneration) return;
				const unchanged =
					labels.length === ev.attendees.length &&
					labels.every((l, i) => l === ev.attendees[i]);
				// Soft-fail: Groups API disabled and labels unchanged — don't
				// cache, so the next poll (which clears `disabled`) can retry.
				if (this.groupExpandCache.disabled && unchanged) {
					continue;
				}
				this.expandedAttendeesByEventId.set(ev.id, {
					fingerprint: fp,
					labels,
				});
				if (!unchanged) {
					ev.attendees = labels;
					changed = true;
				}
			} catch (err) {
				console.warn(
					"[Meeting Copilot] Background group attendee expansion failed.",
					err
				);
				return;
			}
		}
		if (changed && generation === this.groupExpandGeneration) {
			// Keep the dashboard cache in sync (it may hold different object
			// refs than the events we just mutated).
			if (this.dashboardEventsCache) {
				this.applyCachedExpandedAttendees(
					this.dashboardEventsCache.events
				);
			}
			// Refresh agenda/dashboard so expanded people replace group labels.
			this.agendaEvents.emit("changed", undefined);
		}
	}

	/**
	 * Kicks off a background otherContacts sync (display names for people
	 * you've corresponded with over Gmail — see `otherContactsSync.ts`) at
	 * most once per {@link OTHER_CONTACTS_RESYNC_INTERVAL_MS}. No-ops when
	 * the setting is off, not authenticated, already mid-sync, or the user
	 * hasn't re-consented to the scope yet (setting just turned on, or an
	 * old install predates it).
	 */
	private scheduleOtherContactsSync(): void {
		if (!this.settings.scopeOtherContactsEnabled) return;
		if (!this.isCalendarAuthenticated()) return;
		if (this.otherContactsSyncInFlight) return;
		if (!this.oauth.hasScope(CONTACTS_OTHER_READONLY_SCOPE)) return;
		if (
			Date.now() - this.directoryCache.otherContactsSyncedAt <
			OTHER_CONTACTS_RESYNC_INTERVAL_MS
		) {
			return;
		}
		this.otherContactsSyncInFlight = true;
		syncOtherContacts(this.oauth, this.directoryCache, this.peopleRateLimiter)
			.then((result) => {
				if (result.updated > 0) this.agendaEvents.emit("changed", undefined);
			})
			.catch((err) => {
				mcLog("otherContacts", "sync failed", {
					error: err instanceof Error ? err.message : String(err),
				});
			})
			.finally(() => {
				this.otherContactsSyncInFlight = false;
			});
	}

	/**
	 * Await expansion for a single meeting before writing a note so attendees
	 * don't land as an unexpanded group label when the user creates a note
	 * before the background pass finishes.
	 */
	private async ensureAttendeesExpanded(opts: {
		id: string;
		attendees: string[];
		invitees: ExpandableAttendee[];
	}): Promise<string[]> {
		const fp = inviteeFingerprint(opts.invitees);
		const cached = this.expandedAttendeesByEventId.get(opts.id);
		if (cached && cached.fingerprint === fp) return cached.labels;
		if (opts.invitees.length === 0) return opts.attendees;
		// Allow a foreground note-create to retry after a prior soft-fail.
		this.groupExpandCache.disabled = false;
		if (!this.directoryCache.peopleIsRateLimited()) {
			this.personNameCache.disabled = false;
		}
		try {
			const labels = await mapAttendeesExpanded(
				opts.invitees,
				this.createGroupDirectory(),
				{
					maxPeople: Math.max(
						1,
						this.settings.groupExpandMaxMembers ||
							DEFAULT_GROUP_EXPAND_MAX_MEMBERS
					),
				},
				this.groupExpandCache,
				this.createPersonDirectory(),
				this.personNameCache
			);
			const unchanged =
				labels.length === opts.attendees.length &&
				labels.every((l, i) => l === opts.attendees[i]);
			if (this.groupExpandCache.disabled && unchanged) {
				return opts.attendees;
			}
			this.expandedAttendeesByEventId.set(opts.id, {
				fingerprint: fp,
				labels,
			});
			opts.attendees = labels;
			return labels;
		} catch (err) {
			console.warn(
				"[Meeting Copilot] Group attendee expansion failed for note; using raw labels.",
				err
			);
			return opts.attendees;
		}
	}

	/**
	 * Fired `notifyBeforeStartMinutes` before an event begins: warn the user the
	 * meeting is about to start, with Join / Record options. When auto-start is
	 * on the recording will begin on its own at the boundary, so the lead-time
	 * prompt is mainly a heads-up (Record still lets them start early).
	 */
	private handleEventUpcoming(event: ScheduledEvent): void {
		// The scheduler may be running purely for auto-start/stop; the lead-time
		// heads-up is a notification, so only show it when notifications are on.
		if (!this.settings.calendarAutoRecord) return;
		const minutesUntil = Math.max(
			1,
			Math.round((event.start - Date.now()) / 60000)
		);
		this.promptCalendarMeeting(event, t().event.startsInMin(minutesUntil));
	}

	private handleEventStart(event: ScheduledEvent): void {
		this.maybeOpenMeetLink(event);

		// Auto-start: begin recording without asking (back-to-back chaining stops
		// any prior recording first). Skip if we're already recording this event
		// (e.g. the user hit Record on the lead-time prompt).
		if (this.settings.calendarAutoStart) {
			// The lead-time heads-up is now moot — recording is (or is about to
			// be) underway — so clear it rather than leaving it on screen.
			this.dismissMeetingNotice(SystemRecordingPlugin.CAL_NOTICE_PREFIX + event.id);
			if (this.currentRecordingEventId !== event.id) {
				new Notice(t().event.autoStarted(event.summary));
				void this.toMeetingInfoExpanded(event).then((info) =>
					this.startMeetingRecording(info, event.end)
				);
			}
			return;
		}

		// Otherwise prompt — unless the user already started recording this event
		// from the lead-time prompt (its Record button), in which case there's
		// nothing to ask.
		if (this.currentRecordingEventId === event.id) {
			this.dismissMeetingNotice(SystemRecordingPlugin.CAL_NOTICE_PREFIX + event.id);
			return;
		}
		// Auto-start is off and notifications are off (scheduler is running only
		// for auto-stop): don't surface a start prompt the user didn't ask for.
		if (!this.settings.calendarAutoRecord) return;
		const lateMs = Date.now() - event.start;
		const subtitle =
			lateMs > GRACE_MS
				? t().event.startedMinAgo(Math.max(1, Math.round(lateMs / 60000)))
				: t().event.startingNow;
		this.promptCalendarMeeting(event, subtitle);
	}

	/** Opens the event's meeting link once, if configured and it's a safe https URL. */
	private maybeOpenMeetLink(event: ScheduledEvent): void {
		if (
			!this.settings.openMeetAutomatically ||
			!event.meetLink ||
			!event.meetLink.startsWith("https://") ||
			this.openedLinkEventIds.has(event.id)
		) {
			return;
		}
		// Guard against double-opening across the upcoming/start boundaries.
		this.openedLinkEventIds.add(event.id);
		window.open(event.meetLink, "_blank");
	}

	/** Shared calendar meeting prompt (upcoming + start). */
	private promptCalendarMeeting(event: ScheduledEvent, subtitle: string): void {
		this.promptMeeting({
			key: SystemRecordingPlugin.CAL_NOTICE_PREFIX + event.id,
			title: event.summary,
			subtitle,
			meetLink: event.meetLink,
			onRecord: () =>
				void this.toMeetingInfoExpanded(event).then((info) =>
					this.startMeetingRecording(info, event.end)
				),
			// Open (or create) the meeting note without recording — the "Open
			// note" affordance, mirroring the agenda card.
			onOpenNote: () =>
				void this.toMeetingInfoExpanded(event).then((info) =>
					this.openOrCreateEventNote(info)
				),
			// A manual Join opens the link, so don't let the auto-open fire again
			// when the start boundary is crossed.
			onLinkOpened: () => this.openedLinkEventIds.add(event.id),
		});
	}

	/**
	 * Opens the meeting note for an event, creating it first if none exists yet.
	 * Unlike the record path this never starts a recording — it's the prompt's
	 * "Open note" action (and reuses an already-created note so a later Record
	 * links into the same note rather than duplicating it).
	 */
	private async openOrCreateEventNote(info: MeetingEventInfo): Promise<void> {
		try {
			const existing =
				buildNoteIndex(
					this.app,
					scanMeetingNotes(this.app, this.excludedFolderPatterns())
				).get(info.id)?.file ?? null;
			const file =
				existing ??
				(await createMeetingNote(this.app, info, this.noteConfig())).file;
			await this.app.workspace.getLeaf(false).openFile(file);
			this.agendaEvents.emit("changed", undefined);
		} catch (e) {
			new Notice(
				t().notices.recordingError(
					e instanceof Error ? e.message : String(e)
				)
			);
		}
	}

	/**
	 * Creates & opens the meeting note from calendar data, then records beside
	 * it. `eventEndMs` is the event's end time, tracked so the recording can be
	 * auto-stopped at the boundary (and recovered after sleep). Passing
	 * `replaceCurrent` lets a back-to-back meeting stop the prior recording
	 * first instead of bailing with "already recording".
	 */
	private async startMeetingRecording(
		info: MeetingEventInfo,
		eventEndMs?: number
	): Promise<void> {
		if (!Platform.isMacOS) {
			new Notice(t().notices.macOnly);
			return;
		}
		// Fall back to the meeting's own end so the sleep/wake auto-stop safety net
		// covers every meeting recording (e.g. agenda "Create and record"), not
		// just the calendar-scheduler paths that pass an explicit end.
		const endMs = eventEndMs ?? info.end.getTime();
		try {
			const ref = await createMeetingNote(this.app, info, this.noteConfig());
			await this.app.workspace.getLeaf(false).openFile(ref.file);
			await this.startRecording(
				{
					folder: ref.folder,
					basename: ref.basename,
					notePath: ref.notePath,
					eventId: info.id,
					eventEnd: Number.isFinite(endMs) ? endMs : null,
					// Track the live TFile so a rename mid-recording still links the
					// WAV correctly (matches the ad-hoc path).
					note: ref.file,
				},
				{ replaceCurrent: true }
			);
		} catch (e) {
			new Notice(t().notices.recordingError(e instanceof Error ? e.message : String(e)));
		}
	}

	/**
	 * Starts a recording for a meeting. When the note already exists (agenda row,
	 * note context menu, or the ribbon on an open meeting note) it records
	 * straight into that file, bypassing the identity lookup — otherwise a note
	 * without an `event_id` (e.g. a hand-made `meeting_url`-only note) would be
	 * duplicated at the template-resolved path. Only when there is no note yet
	 * (a calendar meeting never opened) does it create one.
	 */
	private startRecordingForMeeting(m: AgendaMeeting): void {
		if (m.note) {
			void this.recordIntoNote(
				m.note,
				m.id || undefined,
				m.end instanceof Date ? m.end.getTime() : undefined
			);
		} else {
			void this.ensureAttendeesExpanded(m).then((attendees) =>
				this.startMeetingRecording({
					...agendaToMeetingInfo(m),
					attendees,
				})
			);
		}
	}

	/**
	 * True when meeting `m` is the one currently recording. Matches on the
	 * calendar event id, and falls back to the note path so record-again into a
	 * note without an `event_id` (e.g. a hand-made `meeting_url`-only note, whose
	 * `m.id` is "") still shows "Stop" on its row instead of "Record again".
	 */
	private isRecordingMeeting(m: AgendaMeeting): boolean {
		if (!this.recorder.isRecording) return false;
		if (this.currentRecordingEventId && this.currentRecordingEventId === m.id) {
			return true;
		}
		// Prefer the live note TFile's path over the string captured at record
		// start, so a rename mid-recording (which updates the TFile in place)
		// still matches the row.
		const recordingNotePath =
			this.currentMeetingNote?.path ?? this.currentMeetingNotePath;
		return m.note != null && recordingNotePath === m.note.path;
	}

	private isStoppingMeeting(m: AgendaMeeting): boolean {
		return this.isStopInProgress() && this.isRecordingMeeting(m);
	}

	/** Records a new take directly into an existing note (no createMeetingNote). */
	private async recordIntoNote(
		file: TFile,
		eventId?: string,
		endMs?: number
	): Promise<void> {
		if (!Platform.isMacOS) {
			new Notice(t().notices.macOnly);
			return;
		}
		try {
			await this.app.workspace.getLeaf(false).openFile(file);
			await this.startRecording(
				{
					folder: folderOf(file),
					basename: file.basename,
					notePath: file.path,
					eventId,
					eventEnd:
						typeof endMs === "number" && Number.isFinite(endMs)
							? endMs
							: null,
					note: file,
				},
				{ replaceCurrent: true }
			);
		} catch (e) {
			new Notice(
				t().notices.recordingError(
					e instanceof Error ? e.message : String(e)
				)
			);
		}
	}

	private noteConfig(): MeetingNoteConfig {
		return {
			oneOffFolderTemplate: this.settings.oneOffFolderTemplate,
			seriesFolderTemplate: this.settings.seriesFolderTemplate,
			oneOnOneSeparately: this.settings.oneOnOneSeparately,
			oneOnOneFolder: this.settings.oneOnOneFolder,
			adhocFolder: this.settings.adhocFolder,
			titlePattern: effectiveTitlePattern(
				this.settings.noteTitlePatternCustomize,
				this.settings.noteTitlePattern
			),
			template: effectiveNoteTemplate(
				this.settings.noteTemplateCustomize,
				this.settings.noteTemplate
			),
			excludeFolders: this.excludedFolderPatterns(),
		};
	}

	/** Parsed, ready-to-use form of the "Excluded folders" setting. */
	private excludedFolderPatterns(): string[] {
		return parseFolderPatterns(this.settings.excludedFolders);
	}

	/**
	 * Distinct non-empty folders the plugin is configured to write meeting
	 * notes under: the static (token-free) prefix of each folder template,
	 * plus the ad-hoc and 1:1 folders. Used to scope "Needs attention" to
	 * plugin-owned territory, and as a retention fallback for a recording
	 * whose note was deleted.
	 */
	private configuredMeetingRoots(): string[] {
		// The empty-returning normalizer, deliberately: a folder setting that
		// normalizes to nothing must not claim the "Meetings" fallback as
		// plugin territory for the attention scan or the retention sweep.
		const roots = [
			templateStaticRoot(this.settings.oneOffFolderTemplate),
			templateStaticRoot(this.settings.seriesFolderTemplate),
			normalizeFolderPathOrEmpty(this.settings.adhocFolder),
			// Only claimed while the 1:1 feature is on: with it off the
			// plugin never writes there, and a user's own folder of the same
			// name must not become attention/retention territory.
			...(this.settings.oneOnOneSeparately
				? [normalizeFolderPathOrEmpty(this.settings.oneOnOneFolder)]
				: []),
		].filter((r) => r.length > 0);
		return [...new Set(roots)];
	}

	private toMeetingInfo(e: ScheduledEvent): MeetingEventInfo {
		return {
			...e,
			start: new Date(e.start),
			end: new Date(e.end),
		};
	}

	/** Like {@link toMeetingInfo}, but awaits group expansion first when needed. */
	private async toMeetingInfoExpanded(
		e: ScheduledEvent
	): Promise<MeetingEventInfo> {
		const attendees = await this.ensureAttendeesExpanded(e);
		return {
			...this.toMeetingInfo(e),
			attendees,
		};
	}

	private handleEventEnd(event: ScheduledEvent): void {
		// The meeting is over: forget its auto-open state so a later recurrence
		// (same id, re-added by a poll) can open its link afresh, and drop the
		// lingering upcoming/start prompt's in-app notice (whether or not we
		// recorded), keeping its OS notification recoverable in Notification
		// Center.
		this.openedLinkEventIds.delete(event.id);
		this.dismissMeetingNotice(SystemRecordingPlugin.CAL_NOTICE_PREFIX + event.id, {
			keepOs: true,
		});

		// Decide what to do with an active recording at the scheduled end. Only
		// acts on *this* meeting's recording (so overlapping meetings can't stop
		// the wrong one). Auto-stop is honored as before; otherwise the "stop?"
		// suggestion is deferred while a conferencing app is still in a meeting
		// (the event ran over) — the detector will offer to stop when the real
		// meeting ends. `detectedOngoing` is null when detection can't answer,
		// which falls back to prompting at the boundary as before.
		const action = eventEndStopAction({
			isRecording: this.recorder.isRecording,
			isThisEventsRecording: this.currentRecordingEventId === event.id,
			autoStop: this.settings.calendarAutoStop,
			detectedOngoing: this.detector
				? this.detector.activeCount()
				: null,
		});
		switch (action) {
			case "auto-stop":
				new Notice(t().event.autoStopped(event.summary));
				this.stopRecording({ notice: false });
				break;
			case "prompt-stop":
				this.promptStopRecording(
					t().event.ended(event.summary),
					t().event.stopRecordingPrompt
				);
				break;
			case "defer":
			case "none":
				break;
		}
	}

    // MARK: - Meeting agenda

    /**
     * Opens (or reveals) the agenda view. The `agendaPlacement` setting decides
     * whether it attaches to a main-panel tab (default) or the right sidebar; an
     * already-open view is just revealed wherever it currently lives.
     */
    async openAgenda(): Promise<void> {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_AGENDA)[0] ?? null;
        if (!leaf) {
            leaf =
                this.settings.agendaPlacement === "sidebar"
                    ? workspace.getRightLeaf(false)
                    : workspace.getLeaf("tab");
            await leaf?.setViewState({ type: VIEW_TYPE_AGENDA, active: true });
        }
        if (leaf) void workspace.revealLeaf(leaf);
    }

    /**
     * Moves any already-open agenda view to wherever `agendaPlacement` now
     * points. Without this, an existing leaf just sits where it was created —
     * `openAgenda()` only picks a location for a *new* leaf — so flipping the
     * setting silently did nothing until the view was closed (no in-app way to
     * do that for a sidebar leaf) or the app restarted.
     */
    async relocateAgenda(): Promise<void> {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(VIEW_TYPE_AGENDA);
        if (existing.length === 0) return;
        for (const leaf of existing) leaf.detach();
        await this.openAgenda();
    }

    /** Tells any open agenda view to reload (e.g. after a settings change). */
    refreshAgenda(): void {
        this.agendaEvents.emit("changed", undefined);
    }

    /** Opens (or reveals) the meetings dashboard. Always a tab — unlike the
     * agenda, there's no sidebar placement option for it. */
    async openDashboard(): Promise<void> {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD)[0] ?? null;
        if (!leaf) {
            leaf = workspace.getLeaf("tab");
            await leaf?.setViewState({ type: VIEW_TYPE_DASHBOARD, active: true });
        }
        if (leaf) void workspace.revealLeaf(leaf);
    }

    private dashboardHost(): DashboardViewHost {
        return {
            renderPastMeetings: (el, page, force) =>
                this.renderPastMeetings(el, page, force),
            renderActionItems: (el, page, force) =>
                this.renderActionItems(el, page, force),
            renderFollowUps: (el, page, force) =>
                this.renderFollowUps(el, page, force),
            renderNoteIssues: (el, force) => this.renderNoteIssues(el, force),
            trackDashboardBlock: (el, rerender) =>
                this.trackDashboardBlock(el, rerender),
            trackNoteIssuesBlock: (el) => this.trackNoteIssuesBlock(el),
            openSettings: () => this.openPluginSettings(),
        };
    }

    private agendaHost(): AgendaViewHost {
        return {
            getLookAhead: () => this.settings.agendaLookAheadDays,
            getLookBack: () => this.settings.agendaLookBackDays,
            setLookAhead: (n) => {
                this.settings.agendaLookAheadDays = n;
                void this.saveSettings();
            },
            isAuthenticated: () => this.isCalendarAuthenticated(),
            authenticate: () => this.authenticateCalendar(),
            isAuthenticating: () => this.isAuthenticating(),
            cancelAuthenticate: () => this.cancelAuthenticate(),
            fetchMeetings: (fromMs, toMs) => this.fetchAgendaMeetings(fromMs, toMs),
            isRecordingThis: (m) => this.isRecordingMeeting(m),
            isStoppingThis: (m) => this.isStoppingMeeting(m),
            onOpenOrCreate: (m) => void this.openOrCreateNote(m),
            onCreateAndRecord: (m) => this.startRecordingForMeeting(m),
            onCreateNote: (m) => void this.createNoteOnly(m),
            onStop: () => this.stopRecording(),
            onOpenRecording: (m) => void this.openRecording(m),
            onTranscribe: (m, mode) => void this.transcribeRecording(m, mode),
            onImportTranscript: (m) => {
                if (m.note) void this.importTranscript(m.note);
            },
            onEnrich: (m) => {
                if (m.note) void this.enqueueEnrich(m.note);
            },
            onOpenLink: (url) => this.openMeetingLink(url),
            onCopyLink: (url) => void this.copyMeetingLink(url),
            openSettings: () => this.openPluginSettings(),
            events: this.agendaEvents,
        };
    }

    /** True when a note carries meeting frontmatter we can act on. */
    private isMeetingNote(file: TFile): boolean {
        if (file.extension !== "md") return false;
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
            | Record<string, unknown>
            | undefined;
        if (!fm) return false;
        const nonEmpty = (k: string): boolean => {
            const v = fm[k];
            return typeof v === "string" && v.trim().length > 0;
        };
        // `recording` may be a single link (legacy) or a YAML list (multiple
        // takes), so resolve through the list-aware helper rather than a bare
        // string check — otherwise a multi-take note wouldn't be recognized.
        const hasRecording = recordingLinkTarget(fm["recording"]) !== "";
        return (
            nonEmpty("event_id") || hasRecording || nonEmpty("meeting_url")
        );
    }

    /**
     * Broader than {@link isMeetingNote}: also recognises a note synced from
     * a third-party tool (currently Granola, via its `granola_id` stamp) that
     * never goes through this plugin's own record/transcribe pipeline and so
     * never gets `event_id`/`meeting_url`/`recording` — but is still a real
     * meeting note worth offering a "Fix meeting metadata" identity fix for.
     */
    private looksLikeMeetingNote(file: TFile): boolean {
        if (this.isMeetingNote(file)) return true;
        if (file.extension !== "md") return false;
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
            | Record<string, unknown>
            | undefined;
        const granolaId = fm?.["granola_id"];
        return typeof granolaId === "string" && granolaId.trim().length > 0;
    }

    /** True when a note already carries 1:1 or recurring-series identity. */
    private hasMeetingIdentity(file: TFile): boolean {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
            | Record<string, unknown>
            | undefined;
        return !!(fm?.["recurring_event_id"] || fm?.["one_on_one_with"]);
    }

    /**
     * Adds a "Meeting Copilot" submenu: the shared meeting actions when the
     * note is plugin-recognized, plus a "Fix meeting metadata" item when it
     * looks like a meeting note (including a Granola-style import) but has no
     * 1:1/series identity yet. Adds nothing when neither applies, so callers
     * can invoke this unconditionally.
     */
    private addNoteMeetingMenu(menu: Menu, file: TFile): void {
        const isMeeting = this.isMeetingNote(file);
        const canFixMetadata =
            this.looksLikeMeetingNote(file) && !this.hasMeetingIdentity(file);
        if (!isMeeting && !canFixMetadata) return;
        menu.addItem((item) => {
            item.setTitle(t().agenda.menuTitle).setIcon("mic");
            const sub = item.setSubmenu();
            if (isMeeting) {
                populateMeetingMenu(
                    sub,
                    this.agendaMeetingFromNote(file),
                    this.noteRowHandlers(),
                    { includeNavigation: false }
                );
            }
            if (canFixMetadata) {
                sub.addItem((fixItem) =>
                    fixItem
                        .setTitle(t().menu.fixMetadataFile)
                        .setIcon("link")
                        .onClick(() => this.fixMetadataForNote(file))
                );
            }
        });
    }

    /** Adds a "Meeting Copilot" submenu with the folder-scoped metadata fix. */
    private addFolderMeetingMenu(menu: Menu, folder: TFolder): void {
        menu.addItem((item) => {
            item.setTitle(t().agenda.menuTitle).setIcon("mic");
            const sub = item.setSubmenu();
            sub.addItem((fixItem) =>
                fixItem
                    .setTitle(t().menu.fixMetadataFolder)
                    .setIcon("link")
                    .onClick(() => this.fixMetadataForFolder(folder))
            );
        });
    }

    /**
     * A folder's direct markdown children — never a subfolder's — split into
     * `tagged` (already carry `recurring_event_id` or `one_on_one_with` — the
     * signal {@link inferIdentityFromSiblings} learns from) and `untagged`
     * (meeting notes, including a Granola-style import, with neither — the
     * candidates a fix would apply to). Notes that don't look like meeting
     * notes at all are ignored on both sides. Deliberately non-recursive:
     * `folderOf(entry.file) !== folderPath` only matches a file whose
     * *immediate* parent is this exact folder, so fixing a high-level folder
     * (e.g. "Meetings/1-1s") can never reach into "Meetings/1-1s/Andres" and
     * mistag its notes with a sibling from a different person's subfolder.
     */
    private scanFolderForIdentity(folderPath: string): {
        tagged: SiblingIdentity[];
        untagged: TFile[];
    } {
        const tagged: SiblingIdentity[] = [];
        const untagged: TFile[] = [];
        for (const entry of scanMeetingNotes(
            this.app,
            this.excludedFolderPatterns()
        )) {
            if (folderOf(entry.file) !== folderPath) continue;
            if (entry.recurringEventId || entry.oneOnOneWith) {
                const fm = this.app.metadataCache.getFileCache(entry.file)
                    ?.frontmatter as Record<string, unknown> | undefined;
                const titleRaw = fm?.["title"];
                const title =
                    typeof titleRaw === "string" && titleRaw
                        ? titleRaw
                        : entry.file.basename;
                tagged.push({
                    oneOnOneWith: entry.oneOnOneWith,
                    oneOnOneEmail: entry.oneOnOneEmail,
                    recurringEventId: entry.recurringEventId,
                    title,
                });
            } else if (this.looksLikeMeetingNote(entry.file)) {
                untagged.push(entry.file);
            }
        }
        return { tagged, untagged };
    }

    /**
     * Infers a folder's identity from its *direct* children's already-tagged
     * notes — never a subfolder's, so a folder with its own siblings two
     * levels down can never steer (or be steered by) an unrelated ancestor
     * folder's fix. Honours the `oneOnOneSeparately` gate the dashboard's own
     * 1:1 grouping uses (with it off, a folder full of 1:1 notes has nothing
     * meaningful to offer — 1:1 metadata wouldn't be read anywhere).
     */
    private inferFolderIdentity(folderPath: string): IdentityInference {
        const { tagged } = this.scanFolderForIdentity(folderPath);
        const result = inferIdentityFromSiblings(tagged);
        if (
            result.kind === "resolved" &&
            result.identity.kind === "one-on-one" &&
            !this.settings.oneOnOneSeparately
        ) {
            return { kind: "none" };
        }
        return result;
    }

    /**
     * Offers to tag `targets` with `identity` — a single persistent Notice the
     * user must click to apply; nothing is written on its own. Shared by the
     * move-detection suggestion and the manual fix command/menu items.
     */
    private confirmMetadataFix(
        targets: TFile[],
        identity: InferredIdentity,
        onApplied?: () => void
    ): void {
        if (targets.length === 0) return;
        const n = t().notices;
        const label =
            identity.kind === "one-on-one"
                ? n.metadataFixLabelOneOnOne(identity.name)
                : n.metadataFixLabelRecurring(identity.title);
        multiActionNotice(n.metadataFixConfirm(targets.length, label), [
            {
                label: n.metadataFixApply,
                cta: true,
                onClick: () =>
                    void this.applyMetadataFix(targets, identity).then(onApplied),
            },
            { label: n.metadataFixDismiss, onClick: () => {} },
        ]);
    }

    /**
     * Reports exactly what disagrees when a folder's siblings don't resolve
     * to one identity — a persistent Notice (no auto-timeout) since it can
     * list several candidates and the user needs to actually go clean the
     * folder up, not just glance at a toast.
     */
    private reportAmbiguousMetadata(
        result: Extract<IdentityInference, { kind: "ambiguous" }>
    ): void {
        const n = t().notices;
        const labels = this.formatAmbiguousLabels(
            result.oneOnOnes,
            result.recurring
        );
        new Notice(n.metadataFixAmbiguous(labels.join(", ")), 0);
    }

    /**
     * Builds one label per ambiguous candidate — shared by the Notice-based
     * fix commands and the "Notes with issues" dashboard section. Two
     * candidates can render the exact same label text (most commonly: a
     * recurring series recreated under a new `recurring_event_id` keeps its
     * old title, so both occurrences show e.g. `the "Standup" series`) —
     * when that happens the label alone can't tell the user which is which,
     * so this appends a short disambiguator (the series' own event ID, or a
     * 1:1 candidate's email) only to the labels that actually collide.
     */
    private formatAmbiguousLabels(
        oneOnOnes: OneOnOneCandidate[],
        recurring: RecurringCandidate[]
    ): string[] {
        const n = t().notices;
        // Truncated for display only — countCandidates already groups by
        // seriesKey, so two candidates reaching this function with the same
        // title necessarily have genuinely different series keys (a lineage
        // split alone can no longer produce this collision).
        const shortEventId = (id: string): string => {
            const base = seriesKey(id);
            return base.length > 10 ? `${base.slice(0, 10)}…` : base;
        };
        const oneOnOneNameCounts = new Map<string, number>();
        for (const o of oneOnOnes) {
            oneOnOneNameCounts.set(o.name, (oneOnOneNameCounts.get(o.name) ?? 0) + 1);
        }
        const recurringTitleCounts = new Map<string, number>();
        for (const r of recurring) {
            recurringTitleCounts.set(
                r.title,
                (recurringTitleCounts.get(r.title) ?? 0) + 1
            );
        }
        return [
            ...oneOnOnes.map((o) => {
                const label = n.metadataFixAmbiguousOneOnOne(o.name, o.count);
                return (oneOnOneNameCounts.get(o.name) ?? 0) > 1 && o.email
                    ? `${label} (${o.email})`
                    : label;
            }),
            ...recurring.map((r) => {
                const label = n.metadataFixAmbiguousRecurring(r.title, r.count);
                return (recurringTitleCounts.get(r.title) ?? 0) > 1
                    ? `${label} — id ${shortEventId(r.recurringEventId)}`
                    : label;
            }),
        ];
    }

    /** Writes the inferred identity's frontmatter to every target note. */
    private async applyMetadataFix(
        targets: TFile[],
        identity: InferredIdentity
    ): Promise<void> {
        for (const file of targets) {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                const f = fm as Record<string, unknown>;
                // Clears the *other* kind's fields too — a target can arrive
                // here already carrying a conflicting identity (that's what
                // made it an "outlier" in the first place), and 1:1 identity
                // outranks recurring everywhere it's read (countCandidates,
                // the accent classifier), so leaving a stale
                // one_on_one_with behind would make this note keep reading
                // as its old identity even after a successful "fix".
                if (identity.kind === "one-on-one") {
                    f.one_on_one_with = identity.name;
                    if (identity.email) f.one_on_one_email = identity.email;
                    else delete f.one_on_one_email;
                    delete f.recurring_event_id;
                } else {
                    f.recurring_event_id = identity.recurringEventId;
                    delete f.one_on_one_with;
                    delete f.one_on_one_email;
                }
            });
        }
        // Keeps the dashboard's grouping (and the agenda) live — the notes
        // just tagged should immediately stop showing as "Ad-hoc". Also
        // refreshes any open "Notes with issues" section regardless of which
        // caller applied the fix (the list's own wrench button already
        // re-renders itself synchronously after this returns, so this is a
        // harmless redundant refresh there, but the command palette and the
        // file/folder context menu items go through this same method too and
        // have no section element of their own to refresh).
        this.agendaEvents.emit("changed", undefined);
        this.refreshNoteIssuesBlocks();
        new Notice(t().notices.metadataFixDone(targets.length));
    }

    private pendingMoveFixes: Map<string, TFile[]> = new Map();
    private moveFixTimer: number | null = null;

    /**
     * Auto-detection (option B): when a meeting note with no 1:1/series
     * identity is moved into a different folder, and that folder's other
     * notes consistently agree on one identity, offer to tag it — never
     * silently. A same-folder rename (title edit) is ignored; only an actual
     * folder change is worth checking. Stays quiet (no report) when the
     * folder is ambiguous — an automatic trigger shouldn't scold the user
     * for an unrelated folder that merely happens to mix identities; the
     * manual fix commands report that explicitly instead.
     *
     * Debounced and batched by target folder: dragging several notes into
     * one folder fires one `rename` event per file, and each would
     * otherwise trigger its own full vault scan plus its own
     * never-auto-dismissing confirm Notice stacked on top of the last.
     */
    private maybeSuggestMetadataFixOnMove(file: TFile, oldPath: string): void {
        if (file.extension !== "md") return;
        const oldFolder = oldPath.includes("/")
            ? oldPath.slice(0, oldPath.lastIndexOf("/"))
            : "";
        const newFolder = file.parent?.path ?? "";
        if (oldFolder === newFolder) return;
        if (!this.looksLikeMeetingNote(file) || this.hasMeetingIdentity(file)) return;

        const pending = this.pendingMoveFixes.get(newFolder);
        if (pending) pending.push(file);
        else this.pendingMoveFixes.set(newFolder, [file]);

        if (this.moveFixTimer !== null) window.clearTimeout(this.moveFixTimer);
        this.moveFixTimer = window.setTimeout(() => {
            this.moveFixTimer = null;
            const batches = this.pendingMoveFixes;
            this.pendingMoveFixes = new Map();
            for (const [folder, files] of batches) {
                const result = this.inferFolderIdentity(folder);
                if (result.kind === "resolved") {
                    this.confirmMetadataFix(files, result.identity);
                }
            }
        }, 500);
    }

    /**
     * Manual fix (option C), single note: infers from the note's current
     * folder siblings, same as the move-detection path, but explicitly
     * triggered — covers a note moved before this feature existed, or one
     * whose auto-suggestion was missed/dismissed.
     */
    private fixMetadataForNote(file: TFile): void {
        if (this.hasMeetingIdentity(file)) {
            new Notice(t().notices.metadataFixAlreadyTagged);
            return;
        }
        const result = this.inferFolderIdentity(file.parent?.path ?? "");
        if (result.kind === "resolved") {
            this.confirmMetadataFix([file], result.identity);
        } else if (result.kind === "ambiguous") {
            this.reportAmbiguousMetadata(result);
        } else {
            new Notice(t().notices.metadataFixNoSignal);
        }
    }

    /**
     * Manual fix (option C), whole folder: infers one identity from the
     * folder's already-tagged *direct* children (subfolders are never
     * scanned — see {@link scanFolderForIdentity}) and offers to apply it to
     * every note still missing it — e.g. run once on "Andres" after moving
     * several ad-hoc 1:1 notes in there over time. If the folder's notes
     * don't agree on one identity, reports exactly what disagrees instead of
     * guessing.
     */
    private fixMetadataForFolder(folder: TFolder): void {
        const { tagged, untagged } = this.scanFolderForIdentity(folder.path);
        if (untagged.length === 0) {
            new Notice(t().notices.metadataFixNothingToFix);
            return;
        }
        let result = inferIdentityFromSiblings(tagged);
        if (
            result.kind === "resolved" &&
            result.identity.kind === "one-on-one" &&
            !this.settings.oneOnOneSeparately
        ) {
            result = { kind: "none" };
        }
        if (result.kind === "resolved") {
            this.confirmMetadataFix(untagged, result.identity);
        } else if (result.kind === "ambiguous") {
            this.reportAmbiguousMetadata(result);
        } else {
            new Notice(t().notices.metadataFixNoSignal);
        }
    }

    /**
     * Fetches the calendar events for the dashboard's past-meetings table,
     * over the *same* window the agenda sidebar uses (look-back/look-ahead
     * days), and caches the raw events briefly so the two blocks — and repeated
     * re-renders from paging/refresh — share a single request. Note/recording
     * state is intentionally *not* cached: each render re-derives it from the
     * vault, so creating a note updates both tables without a refetch. Returns
     * `[]` (no throw) when the calendar isn't connected, so the tables still
     * show vault notes. `force` bypasses the TTL (the Refresh button).
     */
    private dashboardEventsCache: { at: number; events: GCalEvent[] } | null =
        null;
    private dashboardEventsInFlight: Promise<GCalEvent[]> | null = null;
    private async loadDashboardEvents(force = false): Promise<GCalEvent[]> {
        if (!this.isCalendarAuthenticated()) return [];
        const TTL_MS = 60_000;
        const now = Date.now();
        if (
            !force &&
            this.dashboardEventsCache &&
            now - this.dashboardEventsCache.at < TTL_MS
        ) {
            this.applyCachedExpandedAttendees(this.dashboardEventsCache.events);
            return this.dashboardEventsCache.events;
        }
        if (!force && this.dashboardEventsInFlight) {
            return this.dashboardEventsInFlight;
        }
        const dayMs = 24 * 60 * 60 * 1000;
        const lookAhead = Math.max(1, this.settings.agendaLookAheadDays);
        const lookBack = Math.max(
            0,
            Math.min(30, this.settings.agendaLookBackDays)
        );
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const from = new Date(startOfToday.getTime() - lookBack * dayMs);
        const to = new Date(startOfToday.getTime() + lookAhead * dayMs);
        const p = listEvents(
            this.oauth,
            this.settings.calendarId,
            from,
            to,
            250,
            parseKeywords(this.settings.exclusionKeywords),
            this.settings.excludeWithoutMeetingLink
        )
            .then((events) => {
                this.applyCachedExpandedAttendees(events);
                this.dashboardEventsCache = { at: Date.now(), events };
                this.scheduleGroupAttendeeExpand(events);
                return events;
            })
            .finally(() => {
                this.dashboardEventsInFlight = null;
            });
        this.dashboardEventsInFlight = p;
        return p;
    }

    /**
     * Renders the dashboard's single "Past meetings" section: recent meeting
     * notes/calendar events, strictly the last {@link PAST_WINDOW_DAYS} days —
     * a row is never kept around past that window just because it still
     * needs attention (a missing transcript/summary, a truncated transcript,
     * or a folder/tag mismatch). Anything outside the window with an
     * outstanding issue instead surfaces in "Notes with issues"
     * ({@link renderNoteIssues}); within the window, an issue only decorates
     * a row already shown here (missing-piece badges, an overflow menu for
     * Transcribe/Enrich) rather than pulling it into view. Merges the
     * vault's meeting notes with the calendar events the agenda already
     * loads ({@link loadDashboardEvents}): a scheduled meeting with no note
     * yet shows a "create note" action; noted meetings link straight to the
     * note. `page` is 1-based; the controls re-render this same element.
     * `force` re-fetches the calendar (the Refresh button).
     */
    private async renderPastMeetings(
        el: HTMLElement,
        page = 1,
        force = false
    ): Promise<void> {
        // Sentinel "start" for a row with no usable date at all (a broken
        // frontmatter stamp) so it still sorts — to the very top, same as
        // `computeAttention`'s own "broken date first" rule — without giving
        // `DashboardMeetingRow.start` a null case just for this one row kind.
        // Such a row can never fall inside the recency window (see the
        // filter below), so it only ever shows up via "Notes with issues".
        const NO_DATE_SENTINEL = new Date(8640000000000000);

        const d = t().dashboard.meetings;
        const ad = t().dashboard.attention;
        const id = t().dashboard.issues;
        const n = t().notices;
        const acts = t().agenda.actions;
        const seq = this.nextRenderSeq(el);
        const restoreScroll = this.preserveScroll(el);
        // Only clear up front on the very first paint (nothing to preserve).
        // On a refresh/page change we keep the old rows visible while the
        // calendar loads, then swap in one pass below — otherwise the section
        // briefly collapses to empty and the view jumps.
        if (el.childElementCount === 0 && this.isCalendarAuthenticated()) {
            el.createEl("p", { text: d.loading, cls: "mc-meetings-loading" });
        }

        let events: GCalEvent[] = [];
        let calendarError = false;
        // Identity-issue detection (folder-vs-tag mismatches) is a low-priority
        // sanity check, not something that needs to track every edit live —
        // scanNoteIssues() only rescans on the same explicit `force` this
        // section's own Refresh button already passes, otherwise reusing
        // whatever was cached from this render's (or the dashboard's) first.
        // Fetched alongside the calendar, but kept in its own try/catch so a
        // failure here can't masquerade as (or swallow) a calendar error.
        const [eventsResult, issuesResult] = await Promise.allSettled([
            this.loadDashboardEvents(force),
            this.scanNoteIssues(force),
        ]);
        if (eventsResult.status === "fulfilled") {
            events = eventsResult.value;
        } else {
            calendarError = true;
        }
        const issues: NoteIssue[] =
            issuesResult.status === "fulfilled" ? issuesResult.value : [];
        // A newer render started while the calendar loaded — let it win.
        if (this.renderSeq.get(el) !== seq) return;

        const roots = this.configuredMeetingRoots();
        const notesByPath = new Map<string, TFile>();
        const meetingsByKey = new Map<string, AgendaMeeting>();
        const inputs: DashboardMeetingInput[] = [];
        const attentionInputs: AttentionInput[] = [];
        // Collapse notes sharing a key (event id, or path for legacy url-only
        // notes) to the most recently modified one, so a duplicated `event_id`
        // (e.g. a sync-conflict copy) shows the meeting once, not twice.
        const notedByKey = new Map<
            string,
            { input: DashboardMeetingInput; file: TFile; mtime: number }
        >();
        // Normalized meeting URLs of noted meetings, so a calendar event a
        // legacy `meeting_url` note already covers (but which carries no
        // matching `event_id`) isn't listed a second time below.
        const notedUrls = new Set<string>();
        const normalizeUrl = (v: unknown): string =>
            typeof v === "string"
                ? v.trim().replace(/\/+$/, "").toLowerCase()
                : "";
        // One vault scan feeds the noted-meeting inputs below, the "needs
        // attention" inputs, and the note index used to dedup calendar events
        // — reused, not re-walked. Two independent inclusion rules apply: the
        // past-meetings list itself (any plugin-owned note, or a legacy
        // `meeting_url` note wherever it lives) and "needs attention" (also
        // requires a recording, and — for a foreign note — that it lives
        // under one of our configured folders, so we don't offer to rewrite a
        // note we don't own).
        const scanned = scanMeetingNotes(this.app, this.excludedFolderPatterns());
        for (const entry of scanned) {
            const recLink = recordingLinkTarget(entry.recording);
            const hasRecording = recLink !== "";
            const pluginOwned = entry.eventId !== null;
            const inPastList = pluginOwned || entry.hasMeetingUrl;
            const inAttention =
                pluginOwned ||
                ((hasRecording || entry.hasMeetingUrl) &&
                    roots.some((root) => underFolder(entry.file.path, root)));
            if (!inPastList && !inAttention) continue;

            const fm = this.app.metadataCache.getFileCache(entry.file)
                ?.frontmatter as Record<string, unknown> | undefined;
            const titleRaw = fm?.["title"];
            const title =
                typeof titleRaw === "string" && titleRaw
                    ? titleRaw
                    : entry.file.basename;
            const start = entry.stamp ? parseStampDate(entry.stamp) : null;

            if (inPastList) {
                const url = normalizeUrl(fm?.["meeting_url"]);
                if (url) notedUrls.add(url);
                const key = entry.eventId ?? entry.file.path;
                const mtime = entry.file.stat?.mtime ?? 0;
                const existing = notedByKey.get(key);
                if (!existing || existing.mtime < mtime) {
                    notedByKey.set(key, {
                        input: {
                            key,
                            title,
                            start,
                            status: entry.status ?? "",
                            hasRecording,
                            notePath: entry.file.path,
                        },
                        file: entry.file,
                        mtime,
                    });
                }
            }
            if (inAttention) {
                notesByPath.set(entry.file.path, entry.file);
                // "Processing" = the plugin is already advancing this note on
                // its own — the recording is transcribing/queued, or it's
                // being enriched — so there's nothing for the user to do.
                const recDest = hasRecording
                    ? this.app.metadataCache.getFirstLinkpathDest(
                          recLink,
                          entry.file.path
                      )
                    : null;
                const processing =
                    this.taskQueue.has(this.enrichTaskId(entry.file.path)) ||
                    (recDest instanceof TFile &&
                        this.taskQueue.has(recDest.path));
                attentionInputs.push({
                    path: entry.file.path,
                    title,
                    start,
                    status: entry.status,
                    hasRecording,
                    processing,
                    transcriptTruncated: entry.transcriptTruncated,
                });
            }
        }
        for (const { input, file } of notedByKey.values()) {
            notesByPath.set(file.path, file);
            inputs.push(input);
        }

        // Calendar events without a note yet — the enrichment. A timed event
        // whose note already exists is dropped here (the note row above
        // represents it, with fresh state), whether the match is by `event_id`
        // or a legacy note's meeting URL. All-day calendar events never reach
        // here (`listEvents` filters them out — #121).
        const index = buildNoteIndex(this.app, scanned);
        for (const ev of events) {
            const m = toAgendaMeeting(ev, index);
            if (m.note) continue;
            const url = normalizeUrl(m.meetingUrl);
            if (url && notedUrls.has(url)) continue;
            meetingsByKey.set(m.id, m);
            inputs.push({
                key: m.id,
                title: m.title,
                start: m.start,
                status: "",
                hasRecording: false,
                notePath: null,
            });
        }

        const attentionByPath = new Map(
            computeAttention(attentionInputs).map((row) => [row.path, row])
        );
        // Neither an attention reason nor an identity issue pulls a note into
        // view past the short window on its own — both are lighter-touch
        // flags on a row already being shown for another reason (recency).
        // Anything outside the window with either problem instead surfaces
        // in "Notes with issues" (see `renderNoteIssues`'s own independent
        // scan), so the two lists partition by recency rather than overlap.
        const issueByPath = new Map(issues.map((issue) => [issue.path, issue]));

        const now = new Date();
        let rows = meetingRows(inputs, now, "past");
        // Attention items the merge above doesn't already cover (a broken
        // date, or matched only by the stricter attention predicate) still
        // need a row of their own so a *recent* one isn't simply missing from
        // the list — it's still subject to the same cutoff filter below.
        const represented = new Set(
            rows.map((r) => r.notePath).filter((p): p is string => p !== null)
        );
        for (const ar of attentionByPath.values()) {
            if (represented.has(ar.path)) continue;
            rows.push({
                key: ar.path,
                title: ar.title,
                start: ar.start ?? NO_DATE_SENTINEL,
                status: ar.status,
                hasRecording: true,
                notePath: ar.path,
            });
            represented.add(ar.path);
        }

        // Strictly the last couple of days — no exception for a row that
        // still needs attention (see the doc comment above): that's what
        // "Notes with issues" is for, so this list doesn't grow without
        // bound. A `NO_DATE_SENTINEL` row (no usable date at all) can never
        // be "recent", so it's excluded here too despite its sentinel value
        // technically being >= cutoff.
        const cutoff = now.getTime() - PAST_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        rows = rows
            .filter(
                (r) =>
                    r.start.getTime() !== NO_DATE_SENTINEL.getTime() &&
                    r.start.getTime() >= cutoff
            )
            .sort((a, b) => b.start.getTime() - a.start.getTime());

        const pageSize = normalizePageSize(this.settings.dashboardPastPageSize);
        const view = paginate(rows, pageSize, page);
        // Remember the page so an auto-refresh re-renders where the user is.
        el.dataset.mcPage = String(view.page);

        el.empty();

        if (calendarError) {
            el.createEl("p", {
                text: d.calendarError,
                cls: "mc-meetings-error",
            });
        }

        if (view.total === 0) {
            el.createEl("p", { text: d.pastEmpty, cls: "mc-meetings-empty" });
        } else {
            // Card rows — the exact same .mc-cal-event markup the agenda's own
            // day cards use, so this list reads as part of the same product
            // instead of a spreadsheet: a coloured accent bar (by status, same
            // colours as the dot/legend below), title + time/status meta, and
            // the whole row clickable (open the note, or create one).
            const list = el.createDiv({ cls: "mc-cal-events" });
            const pad = (n: number): string => String(n).padStart(2, "0");
            const isNoDate = (dt: Date): boolean =>
                dt.getTime() === NO_DATE_SENTINEL.getTime();
            const timeStr = (dt: Date): string =>
                isNoDate(dt) ? d.noDate : `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
            const dayKey = (dt: Date): string =>
                isNoDate(dt)
                    ? "no-date"
                    : `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(
                          dt.getDate()
                      )}`;
            const dayLabel = (dt: Date): string =>
                isNoDate(dt)
                    ? d.noDate
                    : dt.toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                      });
            const statusLabels = d.status as Record<string, string>;

            // Aggregate by day: a subheader replaces a per-row date. Rows are
            // already sorted, so a running key is enough.
            let lastDay = "";
            for (const row of view.rows) {
                const key = dayKey(row.start);
                if (key !== lastDay) {
                    lastDay = key;
                    list.createDiv({
                        cls: "mc-dash-daylabel",
                        text: dayLabel(row.start),
                    });
                }

                const file = row.notePath
                    ? notesByPath.get(row.notePath)
                    : null;
                const meeting = !file ? meetingsByKey.get(row.key) : null;
                const attention = row.notePath
                    ? attentionByPath.get(row.notePath)
                    : undefined;
                const issue = row.notePath
                    ? issueByPath.get(row.notePath)
                    : undefined;
                // Keyed off `file` (not `row.notePath`) so this can never
                // disagree with the click/action branching below — a notePath
                // whose file lookup misses must not show a status label next
                // to a create-note button for the same row.
                const hasStatus = !!file && row.status && row.status !== "—";
                const accentCls = hasStatus
                    ? `mc-cal-accent-status-${row.status}`
                    : "mc-cal-accent-status-scheduled";

                const rowEl = list.createDiv({
                    cls: `mc-cal-event ${accentCls}`,
                });
                if (file) rowEl.addClass("has-note");
                if (attention || issue) rowEl.addClass("needs-attention");
                rowEl.createDiv({ cls: "mc-cal-event-bar" });

                const rowBody = rowEl.createDiv({ cls: "mc-cal-event-body" });
                rowBody.createDiv({
                    cls: "mc-cal-event-title",
                    text: row.title,
                });
                const meta = rowBody.createDiv({ cls: "mc-cal-event-meta" });
                meta.createSpan({ text: timeStr(row.start) });

                // The status pill lives with the action buttons (not the
                // meta line) — it's the row's trailing "state + what you can
                // do about it" cluster, all in one place.
                const actions = rowEl.createDiv({
                    cls: "mc-cal-event-actions",
                });
                if (hasStatus) {
                    actions.createSpan({
                        cls: `mc-status-pill mc-status-pill-${row.status}`,
                        text: statusLabels[row.status] ?? row.status,
                    });
                }
                // "Enriched" is the one status whose pill alone doesn't
                // explain why the row is still flagged (every other reason —
                // Recorded needs transcribing, Transcribed needs enriching —
                // is obvious from the pill itself) — so a truncated
                // transcript gets its own small warning icon, or a
                // legitimately-done "Enriched" row would show a live action
                // button with no visible reason why.
                if (attention?.missing.includes("truncated")) {
                    const warn = actions.createSpan({
                        cls: "mc-truncated-warning",
                        attr: { "aria-label": d.transcriptTruncatedTooltip },
                    });
                    setIcon(warn, "alert-triangle");
                }

                if (file) {
                    rowEl.addEventListener("click", () =>
                        this.openFileInTab(file)
                    );
                    // Attention rows get a default next-action button —
                    // enrich (which transcribes first if needed) is the same
                    // call whether the note is merely recorded or already
                    // transcribed, so one button covers both — plus a
                    // dropdown for the individual steps. Alongside the row's
                    // normal click-to-open; everything else about the row
                    // (accent, meta, click target) is identical to a plain
                    // past-note row.
                    if (attention) {
                        const attnMeeting = this.agendaMeetingFromNote(file);
                        // "enriched" reaches here only via a truncated
                        // transcript (computeAttention's other enriched-note
                        // paths don't flag attention) — the transcript
                        // already exists, so this re-enriches, not transcribes.
                        const primaryLabel =
                            row.status === "transcribed" ||
                            row.status === "enriched"
                                ? acts.enrich
                                : ad.transcribeAndEnrich;
                        const primaryBtn = actions.createEl("button", {
                            cls: "mc-cal-event-btn",
                            attr: { "aria-label": primaryLabel },
                        });
                        setIcon(primaryBtn, "sparkles");
                        primaryBtn.addEventListener("click", (e) => {
                            e.stopPropagation();
                            void this.enqueueEnrich(file);
                        });

                        const moreBtn = actions.createEl("button", {
                            cls: "mc-cal-event-btn",
                            attr: { "aria-label": ad.moreActions },
                        });
                        setIcon(moreBtn, "chevron-down");
                        moreBtn.addEventListener("click", (e) => {
                            e.stopPropagation();
                            const menu = new Menu();
                            if (attnMeeting.recording) {
                                menu.addItem((item) =>
                                    item
                                        .setTitle(acts.transcribe)
                                        .setIcon("captions")
                                        .onClick(() =>
                                            void this.transcribeRecording(
                                                attnMeeting
                                            )
                                        )
                                );
                            }
                            menu.addItem((item) =>
                                item
                                    .setTitle(acts.enrich)
                                    .setIcon("sparkles")
                                    .onClick(() => void this.enqueueEnrich(file))
                            );
                            menu.showAtMouseEvent(e);
                        });
                    }
                    // A folder-vs-tag identity issue is independent of the
                    // pipeline attention above — a row can have neither, one,
                    // or both — so this is a sibling block, not nested inside
                    // it. "missing"/"outlier" get a one-click fix (wrench);
                    // "ambiguous" has no single identity to safely apply, so
                    // it's report-only, matching the manual fix command's own
                    // refusal to guess.
                    if (issue) {
                        if (issue.reason.kind === "ambiguous") {
                            const labels = this.formatAmbiguousLabels(
                                issue.reason.oneOnOnes,
                                issue.reason.recurring
                            );
                            const detail = id.detailAmbiguous(labels.join(", "));
                            const helpBtn = actions.createEl("button", {
                                cls: "mc-cal-event-btn",
                                attr: { "aria-label": detail },
                            });
                            setIcon(helpBtn, "help-circle");
                            helpBtn.addEventListener("click", (e) => {
                                e.stopPropagation();
                                new Notice(detail);
                            });
                        } else {
                            const identity =
                                issue.reason.kind === "missing"
                                    ? issue.reason.identity
                                    : issue.reason.expected;
                            const label =
                                identity.kind === "one-on-one"
                                    ? n.metadataFixLabelOneOnOne(identity.name)
                                    : n.metadataFixLabelRecurring(identity.title);
                            const fixTooltip =
                                issue.reason.kind === "missing"
                                    ? id.fixTooltipTag(label)
                                    : id.fixTooltipRetag(label);
                            const fixBtn = actions.createEl("button", {
                                cls: "mc-cal-event-btn",
                                attr: { "aria-label": fixTooltip },
                            });
                            setIcon(fixBtn, "wrench");
                            fixBtn.addEventListener("click", (e) => {
                                e.stopPropagation();
                                this.confirmMetadataFix([file], identity, () =>
                                    void this.renderPastMeetings(
                                        el,
                                        view.page,
                                        true
                                    )
                                );
                            });
                        }
                    }
                } else if (meeting) {
                    const createNote = (): void => {
                        void this.createNoteOnly(meeting).then(() =>
                            this.renderPastMeetings(el, view.page)
                        );
                    };
                    rowEl.addEventListener("click", createNote);
                    const create = actions.createEl("button", {
                        cls: "mc-cal-event-btn",
                        attr: { "aria-label": d.createNote },
                    });
                    setIcon(create, "file-plus");
                    create.addEventListener("click", (e) => {
                        e.stopPropagation();
                        createNote();
                    });
                }
            }
        }

        this.renderDashToolbar(el, {
            countText: d.pastCount(view.total),
            pageSize,
            view,
            onPageSize: (n): void => {
                this.settings.dashboardPastPageSize = n;
                void this.saveSettings();
                // A different page size shifts every boundary; back to page 1.
                void this.renderPastMeetings(el, 1);
            },
            onGoTo: (p): void => void this.renderPastMeetings(el, p),
            onRefresh: (): void =>
                void this.renderPastMeetings(el, view.page, true),
        });

        restoreScroll();
    }

    /**
     * Shared bottom toolbar for the dashboard's paginated sections: a count on
     * the left, and on the right the per-page dropdown, prev/next + "page x of
     * y" (only when there's more than one page), and a circular refresh icon.
     * Callbacks re-render the owning section.
     */
    private renderDashToolbar(
        parent: HTMLElement,
        opts: {
            countText: string;
            pageSize: number;
            view: Page<unknown>;
            onPageSize: (size: number) => void;
            onGoTo: (page: number) => void;
            onRefresh: () => void;
        }
    ): void {
        const c = t().dashboard.controls;
        const bar = parent.createDiv({ cls: "mc-dash-toolbar" });
        const left = bar.createDiv({ cls: "mc-dash-toolbar-left" });
        left.createSpan({ cls: "mc-dash-count", text: opts.countText });

        const right = bar.createDiv({ cls: "mc-dash-toolbar-right" });

        const perPage = right.createDiv({ cls: "mc-dash-perpage" });
        perPage.createSpan({ text: c.perPage });
        const select = perPage.createEl("select", { cls: "dropdown" });
        for (const size of PAGE_SIZE_OPTIONS) {
            select.createEl("option", {
                text: String(size),
                value: String(size),
            });
        }
        select.value = String(opts.pageSize);
        select.onchange = (): void =>
            opts.onPageSize(normalizePageSize(Number(select.value)));

        if (opts.view.pageCount > 1) {
            const nav = right.createDiv({ cls: "mc-pagination" });
            const prev = nav.createEl("button", { cls: "mc-icon-btn" });
            setIcon(prev, "chevron-left");
            prev.setAttribute("aria-label", c.prev);
            prev.disabled = opts.view.page <= 1;
            prev.onclick = (): void => opts.onGoTo(opts.view.page - 1);
            nav.createSpan({
                cls: "mc-pagination-status",
                text: c.pageOf(opts.view.page, opts.view.pageCount),
            });
            const next = nav.createEl("button", { cls: "mc-icon-btn" });
            setIcon(next, "chevron-right");
            next.setAttribute("aria-label", c.next);
            next.disabled = opts.view.page >= opts.view.pageCount;
            next.onclick = (): void => opts.onGoTo(opts.view.page + 1);
        }

        const refresh = right.createEl("button", { cls: "mc-icon-btn" });
        setIcon(refresh, "refresh-cw");
        refresh.setAttribute("aria-label", c.refresh);
        refresh.onclick = (): void => opts.onRefresh();
    }

    /** Per-action-items-block Component owning the current render's task markdown. */
    private actionRenderers: WeakMap<HTMLElement, Component> = new WeakMap();

    /** Live action-item render Components, so `onunload` can tear them all down. */
    private liveActionRenderers: Set<Component> = new Set();

    /**
     * Monotonic render id per dashboard block element. Async renders (calendar
     * fetch, vault scan) capture the id at start and bail before mutating the
     * DOM if a newer render superseded them — so fast paging/Refresh can't let
     * a slow earlier pass overwrite the latest UI.
     */
    private renderSeq: WeakMap<HTMLElement, number> = new WeakMap();

    /** Bumps and returns this element's render id. */
    private nextRenderSeq(el: HTMLElement): number {
        const seq = (this.renderSeq.get(el) ?? 0) + 1;
        this.renderSeq.set(el, seq);
        return seq;
    }

    /** Live dashboard block elements → their in-place re-render closure. */
    private dashboardBlocks: Map<HTMLElement, () => void> = new Map();
    private dashboardRefreshTimer: number | null = null;

    /** Registers a dashboard block for auto-refresh on the next change. */
    private trackDashboardBlock(el: HTMLElement, rerender: () => void): void {
        this.dashboardBlocks.set(el, rerender);
    }

    /**
     * Open "Notes with issues" section elements — refreshed only by
     * {@link refreshNoteIssuesBlocks}, deliberately NOT by
     * `scheduleDashboardRefresh`'s broad "anything changed" debounce (that
     * fires on every dashboard tick — a checked task, another section's page
     * turn — and this section's scan is a full vault walk, too heavy to redo
     * that often).
     */
    private noteIssuesBlocks: Set<HTMLElement> = new Set();

    /** Registers a "Notes with issues" section for the narrower refresh below. */
    private trackNoteIssuesBlock(el: HTMLElement): void {
        this.noteIssuesBlocks.add(el);
    }

    /**
     * Forces a fresh scan and re-renders every open "Notes with issues"
     * section. Called only from the specific events that can actually change
     * its contents: a transcribe or enrich job finishing, or a metadata fix
     * applied from outside the section's own (self-refreshing) fix button.
     */
    private refreshNoteIssuesBlocks(): void {
        this.noteIssuesCache = null;
        this.noteIssueDatesCache = null;
        this.attentionRowsCache = null;
        for (const el of this.noteIssuesBlocks) {
            if (!el.isConnected) {
                this.noteIssuesBlocks.delete(el);
                continue;
            }
            void this.renderNoteIssues(el, true);
        }
    }

    /** The block's last-rendered (1-based) page, stashed on the element. */
    private blockPage(el: HTMLElement): number {
        const n = Number.parseInt(el.dataset.mcPage ?? "", 10);
        return Number.isFinite(n) && n > 0 ? n : 1;
    }

    /** Debounced re-render of every connected dashboard block after a change. */
    private scheduleDashboardRefresh(): void {
        if (this.dashboardRefreshTimer !== null) {
            window.clearTimeout(this.dashboardRefreshTimer);
        }
        this.dashboardRefreshTimer = window.setTimeout(() => {
            this.dashboardRefreshTimer = null;
            for (const [el, rerender] of this.dashboardBlocks) {
                if (!el.isConnected) {
                    this.dashboardBlocks.delete(el);
                    continue;
                }
                rerender();
            }
        }, 400);
    }

    /**
     * Short-lived cache of the (whole-vault, disk-read) action-items scan so
     * paging/page-size changes reuse it instead of re-reading every task note.
     * A tick or Refresh forces a fresh scan (`force`). Keyed by section mode.
     */
    private actionScanCache: Map<
        string,
        { at: number; groups: ActionNoteGroup[] }
    > = new Map();

    /** Runs (or reuses, within a short TTL) a section-scoped task scan. */
    private async scanActionGroups(
        mode: "actions" | "followups",
        force: boolean
    ): Promise<ActionNoteGroup[]> {
        const TTL_MS = 15_000;
        const cached = this.actionScanCache.get(mode);
        if (!force && cached && Date.now() - cached.at < TTL_MS) {
            return cached.groups;
        }
        const groups = sortActionNoteGroups(
            await this.scanOpenTaskNotes(mode)
        );
        this.actionScanCache.set(mode, {
            at: Date.now(),
            groups,
        });
        return groups;
    }

    /**
     * Renders the dashboard's "Open action items" section: notes with open
     * tasks under `## Action items`, grouped by note and ordered newest note
     * first, kept dense and paginated (by note). Each group shows a small
     * linked title + date and its open tasks; ticking a task marks it done in
     * the source note and re-renders. `page` is 1-based (by note).
     */
    private async renderActionItems(
        el: HTMLElement,
        page = 1,
        force = false
    ): Promise<void> {
        await this.renderTaskSection(el, {
            mode: "actions",
            strings: {
                ...t().dashboard.actions,
                ageDays: t().dashboard.groups.ageDays,
            },
            pageSizeKey: "dashboardActionsPageSize",
            page,
            force,
            horizonDays: 0,
        });
    }

    /**
     * Renders the dashboard's "Meeting follow-ups" section: open tasks under
     * `## Follow-ups`, horizon-filtered so the list stays bounded. "Show older"
     * reveals items past the horizon without permanently bloating the view.
     */
    private async renderFollowUps(
        el: HTMLElement,
        page = 1,
        force = false
    ): Promise<void> {
        await this.renderTaskSection(el, {
            mode: "followups",
            strings: {
                ...t().dashboard.followups,
                ageDays: t().dashboard.groups.ageDays,
            },
            pageSizeKey: "dashboardFollowupsPageSize",
            page,
            force,
            horizonDays: this.settings.followUpHorizonDays,
        });
    }

    /**
     * Cached result of the last identity-issue scan (folder-vs-tag
     * mismatches — flagged inline in "Past meetings" when recent, otherwise
     * shown in "Notes with issues"; see `renderPastMeetings` and
     * `renderNoteIssues`). Unlike those sections' own live data, this one is
     * deliberately *not* rescanned on every vault-change auto-refresh: it's a
     * low-priority sanity check, not something that needs to track every edit
     * live. It's computed once (the first time either section runs) and
     * otherwise only refreshed when a section's own Refresh button passes
     * `force`.
     */
    private noteIssuesCache: NoteIssue[] | null = null;
    /** Each issue's meeting date (by path), so `renderNoteIssues` can tell
     * whether it's already covered by "Past meetings"'s own recency window. */
    private noteIssueDatesCache: Map<string, Date | null> | null = null;

    private async scanNoteIssues(force = false): Promise<NoteIssue[]> {
        if (!force && this.noteIssuesCache) return this.noteIssuesCache;
        const excludeFolders = this.excludedFolderPatterns();
        const dates = new Map<string, Date | null>();
        const rows: NoteIdentityRow[] = scanMeetingNotes(
            this.app,
            excludeFolders
        ).map((entry) => {
            const fm = this.app.metadataCache.getFileCache(entry.file)
                ?.frontmatter as Record<string, unknown> | undefined;
            const titleRaw = fm?.["title"];
            const title =
                typeof titleRaw === "string" && titleRaw
                    ? titleRaw
                    : entry.file.basename;
            dates.set(
                entry.file.path,
                entry.stamp ? parseStampDate(entry.stamp) : null
            );
            return {
                path: entry.file.path,
                title,
                fileTitle: entry.file.basename,
                folder: folderOf(entry.file),
                looksLikeMeetingNote: this.looksLikeMeetingNote(entry.file),
                oneOnOneWith: entry.oneOnOneWith,
                oneOnOneEmail: entry.oneOnOneEmail,
                recurringEventId: entry.recurringEventId,
            };
        });
        const issues = findNoteIssues(rows, this.settings.oneOnOneSeparately);
        this.noteIssuesCache = issues;
        this.noteIssueDatesCache = dates;
        return issues;
    }

    /**
     * Cached result of the last "needs attention" pipeline scan (missing
     * transcript/summary, a broken date, or a truncated transcript) — an
     * independent re-derivation of the same `computeAttention` data
     * `renderPastMeetings` computes inline, used by `renderNoteIssues` to
     * catch a note that's aged out of that section's recency window but
     * still needs something done. Same low-priority, force-gated caching as
     * `noteIssuesCache`.
     */
    private attentionRowsCache: AttentionRow[] | null = null;

    private async scanAttentionRows(force = false): Promise<AttentionRow[]> {
        if (!force && this.attentionRowsCache) return this.attentionRowsCache;
        const roots = this.configuredMeetingRoots();
        const scanned = scanMeetingNotes(this.app, this.excludedFolderPatterns());
        const attentionInputs: AttentionInput[] = [];
        for (const entry of scanned) {
            const recLink = recordingLinkTarget(entry.recording);
            const hasRecording = recLink !== "";
            const pluginOwned = entry.eventId !== null;
            const inAttention =
                pluginOwned ||
                ((hasRecording || entry.hasMeetingUrl) &&
                    roots.some((root) => underFolder(entry.file.path, root)));
            if (!inAttention) continue;

            const fm = this.app.metadataCache.getFileCache(entry.file)
                ?.frontmatter as Record<string, unknown> | undefined;
            const titleRaw = fm?.["title"];
            const title =
                typeof titleRaw === "string" && titleRaw
                    ? titleRaw
                    : entry.file.basename;
            const start = entry.stamp ? parseStampDate(entry.stamp) : null;
            const recDest = hasRecording
                ? this.app.metadataCache.getFirstLinkpathDest(
                      recLink,
                      entry.file.path
                  )
                : null;
            const processing =
                this.taskQueue.has(this.enrichTaskId(entry.file.path)) ||
                (recDest instanceof TFile && this.taskQueue.has(recDest.path));
            attentionInputs.push({
                path: entry.file.path,
                title,
                start,
                status: entry.status,
                hasRecording,
                processing,
                transcriptTruncated: entry.transcriptTruncated,
            });
        }
        const rows = computeAttention(attentionInputs);
        this.attentionRowsCache = rows;
        return rows;
    }

    /**
     * Renders the dashboard's "Notes with issues" section — collapsed by
     * default, the header itself is the toggle. The catch-all for anything
     * "Past meetings" won't show because it's aged out of the short recency
     * window: a broken date, a still-missing transcript/summary, a
     * transcript that had to be truncated, or a folder/tag mismatch. Builds
     * its own header (title + count + refresh) rather than going through the
     * shared `renderSection` helper the other sections use, since this one
     * needs a dynamic count and a collapse state the others don't have.
     */
    private async renderNoteIssues(
        section: HTMLElement,
        force = false
    ): Promise<void> {
        const d = t().dashboard.issues;
        const ad = t().dashboard.attention;
        const n = t().notices;
        const acts = t().agenda.actions;
        const seq = this.nextRenderSeq(section);
        // Persisted on `section` (survives the .empty() below across
        // re-renders); the CSS class that actually hides the body has to
        // live on `head`, since that's the element carrying .mc-cal-earlier.
        const wasCollapsed = section.dataset.mcCollapsed !== "0";
        section.empty();
        section.dataset.mcCollapsed = wasCollapsed ? "1" : "0";

        const head = section.createDiv({ cls: "mc-cal-earlier mc-issues-head" });
        head.toggleClass("is-collapsed", wasCollapsed);
        const headRow = head.createDiv({ cls: "mc-cal-earlier-head" });
        const chevron = headRow.createSpan({ cls: "mc-cal-earlier-chevron" });
        setIcon(chevron, "chevron-down");
        headRow.createEl("h3", {
            cls: "mc-dash-section-title mc-issues-title",
            text: d.title,
        });
        const countEl = headRow.createSpan({ cls: "mc-cal-earlier-count" });
        const refresh = headRow.createEl("button", {
            cls: "mc-icon-btn",
            attr: { "aria-label": d.refresh },
        });
        setIcon(refresh, "refresh-cw");
        refresh.addEventListener("click", (e) => {
            e.stopPropagation();
            void this.renderNoteIssues(section, true);
        });
        headRow.addEventListener("click", () => {
            const collapsed = section.dataset.mcCollapsed !== "0";
            section.dataset.mcCollapsed = collapsed ? "0" : "1";
            head.toggleClass("is-collapsed", !collapsed);
        });

        const body = head.createDiv({ cls: "mc-cal-earlier-body" });
        body.createEl("p", { text: d.loading, cls: "mc-actions-loading" });

        const [issues, attentionRows] = await Promise.all([
            this.scanNoteIssues(force),
            this.scanAttentionRows(force),
        ]);
        if (this.renderSeq.get(section) !== seq) return;

        // Anything within "Past meetings"'s own recency window is already
        // shown (and actionable) there — only the aged-out tail belongs here,
        // so the two lists partition by recency instead of overlapping.
        const cutoff = Date.now() - PAST_WINDOW_DAYS * 24 * 60 * 60 * 1000;
        const outOfWindow = (start: Date | null): boolean =>
            start === null || start.getTime() < cutoff;

        const dates = this.noteIssueDatesCache;
        type Entry =
            | { kind: "identity"; start: Date | null; issue: NoteIssue }
            | { kind: "attention"; start: Date | null; row: AttentionRow };
        const entries: Entry[] = [
            ...issues
                .filter((issue) => outOfWindow(dates?.get(issue.path) ?? null))
                .map(
                    (issue): Entry => ({
                        kind: "identity",
                        start: dates?.get(issue.path) ?? null,
                        issue,
                    })
                ),
            ...attentionRows
                .filter((row) => outOfWindow(row.start))
                .map((row): Entry => ({ kind: "attention", start: row.start, row })),
        ];
        entries.sort((a, b) => {
            const at = a.start?.getTime() ?? Number.POSITIVE_INFINITY;
            const bt = b.start?.getTime() ?? Number.POSITIVE_INFINITY;
            return bt - at;
        });

        countEl.setText(String(entries.length));
        body.empty();

        if (entries.length === 0) {
            body.createEl("p", { text: d.empty, cls: "mc-actions-empty" });
            return;
        }

        const list = body.createDiv({ cls: "mc-actions-list" });
        for (const entry of entries) {
            const path = entry.kind === "identity" ? entry.issue.path : entry.row.path;
            const entryTitle =
                entry.kind === "identity" ? entry.issue.title : entry.row.title;
            const file = this.app.vault.getAbstractFileByPath(path);
            const note = list.createDiv({ cls: "mc-action-note mc-issue-note" });
            note.createDiv({ cls: "mc-action-note-bar" });
            const noteBody = note.createDiv({ cls: "mc-action-note-body" });
            // Title + pill + fix button on one line, the suggestion text
            // below on its own — same two-line shape as the action-items
            // rows, so the suggestion has room to read in full instead of
            // being squeezed and ellipsized next to the title.
            const header = noteBody.createDiv({ cls: "mc-action-note-header" });
            const titleEl = header.createEl("a", {
                cls: "mc-action-note-title internal-link",
                text: entryTitle,
            });
            titleEl.onclick = (e): void => {
                e.preventDefault();
                if (file instanceof TFile) this.openFileInTab(file);
            };

            if (entry.kind === "attention") {
                const row = entry.row;
                const reason = row.missing[0];
                const pillText =
                    reason === "date"
                        ? d.reasonDate
                        : reason === "transcript"
                          ? d.reasonTranscript
                          : reason === "summary"
                            ? d.reasonSummary
                            : d.reasonTruncated;
                const detailText =
                    reason === "date"
                        ? d.detailDate
                        : reason === "transcript"
                          ? d.detailTranscript
                          : reason === "summary"
                            ? d.detailSummary
                            : d.detailTruncated;
                header.createSpan({
                    cls: "mc-status-pill mc-issue-pill",
                    text: pillText,
                });
                if (file instanceof TFile) {
                    const primaryLabel =
                        row.status === "transcribed" || row.status === "enriched"
                            ? acts.enrich
                            : ad.transcribeAndEnrich;
                    const primaryBtn = header.createEl("button", {
                        cls: "mc-cal-event-btn",
                        attr: { "aria-label": primaryLabel, title: primaryLabel },
                    });
                    setIcon(primaryBtn, "sparkles");
                    primaryBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        void this.enqueueEnrich(file);
                    });
                }
                noteBody.createDiv({ cls: "mc-issue-detail", text: detailText });
                continue;
            }

            const issue = entry.issue;
            let pillText: string;
            let detailText: string;
            // Only "missing"/"outlier" have one specific identity to offer —
            // an "ambiguous" folder disagrees with itself, so there's
            // nothing safe to auto-apply; the detail text is the full
            // action there (matches reportAmbiguousMetadata's Notice, which
            // likewise only reports and never guesses).
            let fixIdentity: InferredIdentity | null = null;
            let fixTooltip = "";
            if (issue.reason.kind === "missing") {
                const label =
                    issue.reason.identity.kind === "one-on-one"
                        ? n.metadataFixLabelOneOnOne(issue.reason.identity.name)
                        : n.metadataFixLabelRecurring(issue.reason.identity.title);
                pillText = d.reasonMissing;
                detailText = d.detailMissing(label);
                fixIdentity = issue.reason.identity;
                fixTooltip = d.fixTooltipTag(label);
            } else if (issue.reason.kind === "outlier") {
                const actual =
                    issue.reason.actual.kind === "one-on-one"
                        ? n.metadataFixLabelOneOnOne(issue.reason.actual.name)
                        : n.metadataFixLabelRecurring(issue.reason.actual.title);
                const expected =
                    issue.reason.expected.kind === "one-on-one"
                        ? n.metadataFixLabelOneOnOne(issue.reason.expected.name)
                        : n.metadataFixLabelRecurring(issue.reason.expected.title);
                pillText = d.reasonOutlier;
                detailText = d.detailOutlier(actual, expected);
                fixIdentity = issue.reason.expected;
                fixTooltip = d.fixTooltipRetag(expected);
            } else {
                const labels = this.formatAmbiguousLabels(
                    issue.reason.oneOnOnes,
                    issue.reason.recurring
                );
                pillText = d.reasonAmbiguous;
                detailText = d.detailAmbiguous(labels.join(", "));
            }
            header.createSpan({ cls: "mc-status-pill mc-issue-pill", text: pillText });
            if (fixIdentity) {
                const identity = fixIdentity;
                const fixBtn = header.createEl("button", {
                    cls: "mc-cal-event-btn",
                    attr: { "aria-label": fixTooltip, title: fixTooltip },
                });
                setIcon(fixBtn, "wrench");
                fixBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (file instanceof TFile) {
                        this.confirmMetadataFix([file], identity, () =>
                            void this.renderNoteIssues(section, true)
                        );
                    }
                });
            }
            noteBody.createDiv({ cls: "mc-issue-detail", text: detailText });
        }
    }

    /**
     * Shared renderer for the action-items and follow-ups dashboard sections —
     * same table format for both (age-on-the-right included). `strings` is the
     * i18n block (`actions` or `followups`); horizon filtering only applies
     * when `horizonDays > 0`.
     */
    private async renderTaskSection(
        el: HTMLElement,
        opts: {
            mode: "actions" | "followups";
            strings: {
                count: (n: number) => string;
                empty: string;
                emptyRecent?: string;
                loading: string;
                taskMoved: string;
                taskError: (msg: string) => string;
                showOlder?: (n: number) => string;
                hideOlder?: string;
                ageDays: (n: number) => string;
            };
            pageSizeKey: "dashboardActionsPageSize" | "dashboardFollowupsPageSize";
            page: number;
            force: boolean;
            horizonDays: number;
        }
    ): Promise<void> {
        const a = opts.strings;
        const seq = this.nextRenderSeq(el);
        const restoreScroll = this.preserveScroll(el);
        if (el.childElementCount === 0) {
            el.createEl("p", { text: a.loading, cls: "mc-actions-loading" });
        }

        const allGroups = await this.scanActionGroups(opts.mode, opts.force);
        if (this.renderSeq.get(el) !== seq) return;

        const today = new Date();
        const split = splitByHorizon(allGroups, opts.horizonDays, today);
        const showOlder = el.dataset.mcShowOlder === "1";
        const groups = showOlder
            ? sortActionNoteGroups(
                  mergeGroupsByKey([...split.recent, ...split.older])
              )
            : split.recent;
        const olderCount = countTasks(split.older);

        const pageSize = normalizePageSize(this.settings[opts.pageSizeKey]);
        const view = paginate(groups, pageSize, opts.page);
        el.dataset.mcPage = String(view.page);

        const prevRenderer = this.actionRenderers.get(el);
        if (prevRenderer) {
            prevRenderer.unload();
            this.liveActionRenderers.delete(prevRenderer);
        }
        const renderer = new Component();
        renderer.load();
        this.actionRenderers.set(el, renderer);
        this.liveActionRenderers.add(renderer);

        el.empty();

        if (view.total === 0 && olderCount === 0) {
            el.createEl("p", { text: a.empty, cls: "mc-actions-empty" });
        } else if (view.total === 0 && olderCount > 0 && !showOlder) {
            el.createEl("p", {
                text: a.emptyRecent ?? a.empty,
                cls: "mc-actions-empty",
            });
        } else {
            const list = el.createDiv({ cls: "mc-actions-list" });
            for (const group of view.rows) {
                this.renderActionNote(
                    list,
                    group,
                    el,
                    view.page,
                    renderer,
                    opts,
                    today
                );
            }
        }

        if (olderCount > 0 && a.showOlder && a.hideOlder) {
            const olderBar = el.createDiv({ cls: "mc-actions-older" });
            const btn = olderBar.createEl("button", {
                cls: "mc-actions-older-btn",
                text: showOlder ? a.hideOlder : a.showOlder(olderCount),
            });
            btn.onclick = (): void => {
                el.dataset.mcShowOlder = showOlder ? "0" : "1";
                void this.renderTaskSection(el, { ...opts, page: 1, force: false });
            };
        }

        this.renderDashToolbar(el, {
            countText: a.count(countTasks(groups)),
            pageSize,
            view,
            onPageSize: (n): void => {
                this.settings[opts.pageSizeKey] = n;
                void this.saveSettings();
                void this.renderTaskSection(el, { ...opts, page: 1, force: false });
            },
            onGoTo: (p): void =>
                void this.renderTaskSection(el, { ...opts, page: p, force: false }),
            onRefresh: (): void =>
                void this.renderTaskSection(el, {
                    ...opts,
                    page: view.page,
                    force: true,
                }),
        });

        restoreScroll();
    }

    /** Renders one note's group of open tasks in the action-items list. */
    private renderActionNote(
        parent: HTMLElement,
        group: ActionNoteGroup,
        sectionEl: HTMLElement,
        page: number,
        renderer: Component,
        opts: {
            mode: "actions" | "followups";
            strings: {
                count: (n: number) => string;
                empty: string;
                emptyRecent?: string;
                loading: string;
                taskMoved: string;
                taskError: (msg: string) => string;
                showOlder?: (n: number) => string;
                hideOlder?: string;
                ageDays: (n: number) => string;
            };
            pageSizeKey: "dashboardActionsPageSize" | "dashboardFollowupsPageSize";
            page: number;
            force: boolean;
            horizonDays: number;
        },
        today: Date
    ): void {
        const file = this.app.vault.getAbstractFileByPath(group.notePath);
        // Coloured by the group's category (1:1/recurring/ad-hoc) — the same
        // classification the agenda itself uses for meeting type — rather
        // than pipeline status: every note reaching this list has already
        // been enriched (that's what creates the "## Action items"/
        // "## Follow-ups" section in the first place), so a status colour
        // would be identical on every row.
        const accentCls = accentClass(
            group.category === "ad-hoc" ? "meeting" : group.category
        );
        const note = parent.createDiv({ cls: `mc-action-note ${accentCls}` });
        note.createDiv({ cls: "mc-action-note-bar" });
        const body = note.createDiv({ cls: "mc-action-note-body" });
        const header = body.createDiv({ cls: "mc-action-note-header" });
        const title = header.createEl("a", {
            cls: "mc-action-note-title internal-link",
            text: group.title,
        });
        title.onclick = (e): void => {
            e.preventDefault();
            if (file instanceof TFile) this.openFileInTab(file);
        };
        header.createSpan({
            cls: `mc-category-pill mc-category-pill-${group.category}`,
            text: t().dashboard.groups.category[group.category],
        });

        const ul = body.createEl("ul", { cls: "mc-action-tasks" });
        for (const task of group.tasks) {
            const li = ul.createEl("li", {
                cls: task.done
                    ? "mc-action-task mc-action-task-done"
                    : "mc-action-task",
            });
            const cb = li.createEl("input", {
                cls: "mc-action-task-check",
                type: "checkbox",
            });
            if (task.done) {
                cb.checked = true;
                cb.disabled = true;
            } else {
                cb.onclick = (): void => {
                    cb.disabled = true;
                    void (async (): Promise<void> => {
                        try {
                            await this.completeTask(
                                task.path,
                                task,
                                opts.strings.taskMoved
                            );
                        } catch (e) {
                            cb.disabled = false;
                            cb.checked = false;
                            new Notice(
                                opts.strings.taskError(
                                    e instanceof Error ? e.message : String(e)
                                )
                            );
                            return;
                        }
                        await this.renderTaskSection(sectionEl, {
                            ...opts,
                            page,
                            force: true,
                        });
                    })();
                };
            }
            // A group can aggregate tasks from several notes (every occurrence
            // of a recurring series, or every one-on-one instance) — the
            // header link above only opens the group's *most recent* note, so
            // this task's own line needs its own link to reach whichever note
            // it actually lives in.
            const text = li.createSpan({
                cls: "mc-action-task-text mc-action-task-link",
                attr: { role: "button", tabindex: "0" },
            });
            void MarkdownRenderer.render(
                this.app,
                task.text,
                text,
                task.path,
                renderer
            );
            const openTaskNote = (): void => {
                const taskFile = this.app.vault.getAbstractFileByPath(task.path);
                if (taskFile instanceof TFile) {
                    this.openFileInTab(taskFile, task.line);
                }
            };
            // Don't hijack activation of a genuine link inside the task's own
            // markdown (e.g. a `[[wikilink]]`) — only the plain text around
            // it should jump to the source line.
            const targetsOwnLink = (e: Event): boolean =>
                e.target instanceof HTMLElement && e.target.closest("a") !== null;
            text.addEventListener("click", (e) => {
                if (targetsOwnLink(e)) return;
                openTaskNote();
            });
            text.addEventListener("keydown", (e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                if (targetsOwnLink(e)) return;
                e.preventDefault();
                openTaskNote();
            });
            const age = taskAgeDays(task, today);
            if (age !== null && age > 0) {
                li.createSpan({
                    cls: "mc-action-task-age",
                    text: opts.strings.ageDays(age),
                });
            }
        }
    }

    /**
     * Scans every note in the vault for open (`- [ ]`) tasks under
     * `## Action items`/`## Follow-ups`, returning one group per *category* —
     * a 1:1's tasks (when {@link SystemRecordingSettings.oneOnOneSeparately}
     * is on) group by partner, a recurring series' tasks group by
     * `recurring_event_id`, and anything else (an ad-hoc/one-off meeting)
     * groups by its own note path — rather than one group per note. That way
     * a person's 1:1 or a recurring series reads as one section no matter
     * which instance's note the tasks were written into, or whether that
     * instance got renamed; the note's own title only matters for the ad-hoc
     * case. Kept whole-vault on purpose: action items live in meeting notes
     * wherever they came from (including Granola-synced notes, which carry no
     * `event_id`).
     *
     * `mode: "actions"` also picks up every open task *outside* both
     * recognized headings (via {@link tasksOutsideHeadings}) — a note that
     * doesn't use this structure at all (e.g. a Granola import's own
     * "### Next Steps") would otherwise have its tasks silently dropped from
     * the dashboard entirely; degrading them into Action items beats losing
     * them. `mode: "followups"` stays strict — only genuine `## Follow-ups`.
     *
     * The metadata cache only *pre-filters* to files that might have an open
     * task — cheap, and avoids reading files with none — but the tasks
     * themselves are re-derived from a fresh disk read. That way a Refresh
     * reflects the current vault rather than a stale cache: a file the index
     * still lists but that has since moved/vanished (e.g. an external reorg
     * Obsidian hasn't fully re-indexed) fails the read and is dropped, instead
     * of lingering with tasks pointing at a folder that no longer exists. The
     * pre-filter itself fails open on an unindexed file rather than assuming
     * it has no tasks — see the comment at its one call site.
     */
    private async scanOpenTaskNotes(
        mode: "actions" | "followups"
    ): Promise<ActionNoteGroup[]> {
        const today = this.todayStamp();
        const groupLabels = t().dashboard.groups;
        const byKey = new Map<string, ActionNoteGroup>();
        // Tracks each group's most recently modified source note, separate
        // from the public shape above, so the header link/title can "follow"
        // whichever note was touched last.
        const mtimeByKey = new Map<string, number>();
        const excludeFolders = this.excludedFolderPatterns();

        for (const file of this.app.vault.getMarkdownFiles()) {
            if (isPathExcluded(file.path, excludeFolders)) continue;
            const cache = this.app.metadataCache.getFileCache(file);
            // A missing cache entry means "not indexed yet", not "no tasks" —
            // right after this plugin's own writes (ticking a task,
            // enrichment appending new ones) Obsidian's cache can still be
            // catching up when the debounced refresh fires. Treating that as
            // "definitely no tasks" was dropping the file for one scan pass,
            // then picking it up again once the cache caught up — the tasks
            // flickering in and out the user was seeing. Fail open (scan it)
            // whenever the cache can't yet rule it out; the real filter is
            // the fresh disk read below either way.
            const mayHaveTasks =
                !cache ||
                (cache.listItems ?? []).some((it) => it.task !== undefined);
            if (!mayHaveTasks) continue;

            let content: string;
            try {
                content = await this.app.vault.read(file);
            } catch {
                continue;
            }
            // The unsectioned-task fallback is gated to notes that already
            // look like meeting notes (including a Granola-style import,
            // which is what it exists for) — without this, any open
            // checkbox anywhere in any markdown file in the vault (a daily
            // note, a project tracker, an unrelated checklist) would surface
            // in the dashboard, since a random note has no "## Action items"
            // heading to scope the strict parse below to.
            const rawTasks =
                mode === "actions"
                    ? [
                          ...parseNoteTasks(content, today, ACTION_ITEMS_HEADING),
                          ...(this.looksLikeMeetingNote(file)
                              ? tasksOutsideHeadings(content, today, [
                                    ACTION_ITEMS_HEADING,
                                    FOLLOW_UPS_HEADING,
                                ])
                              : []),
                      ]
                    : parseNoteTasks(content, today, FOLLOW_UPS_HEADING);
            if (rawTasks.length === 0) continue;

            const fm = cache?.frontmatter as
                | Record<string, unknown>
                | undefined;
            const str = (k: string): string => {
                const v = fm?.[k];
                return typeof v === "string" ? v.trim() : "";
            };
            const titleRaw = fm?.["title"];
            const title =
                typeof titleRaw === "string" && titleRaw
                    ? titleRaw
                    : file.basename;
            const date = this.resolveNoteDate(file, fm);
            const oneOnOneWith = str("one_on_one_with");
            const recurringId = str("recurring_event_id");

            let key: string;
            let category: ActionGroupCategory;
            let groupTitle: string;
            if (this.settings.oneOnOneSeparately && oneOnOneWith) {
                category = "one-on-one";
                key = `11:${str("one_on_one_email").toLowerCase() || oneOnOneWith.toLowerCase()}`;
                groupTitle = groupLabels.oneOnOne(oneOnOneWith);
            } else if (recurringId) {
                category = "recurring";
                // Normalized: a series' recurring_event_id changes when
                // Google splits its lineage ("edit this and following
                // events"), which would otherwise fragment one series'
                // tasks into several same-titled "recurring" groups.
                key = `series:${seriesKey(recurringId)}`;
                groupTitle = title;
            } else {
                category = "ad-hoc";
                key = `note:${file.path}`;
                groupTitle = title;
            }

            const tasks: GroupedTask[] = rawTasks.map((task) => ({
                ...task,
                path: file.path,
                noteDate: date,
            }));
            const mtime = file.stat?.mtime ?? 0;
            const existing = byKey.get(key);
            if (!existing) {
                byKey.set(key, {
                    key,
                    title: groupTitle,
                    notePath: file.path,
                    date,
                    category,
                    tasks,
                });
                mtimeByKey.set(key, mtime);
            } else {
                existing.tasks.push(...tasks);
                // The most recently modified note "wins" as the header's
                // click target and displayed title, so a renamed instance
                // (or a 1:1 partner's display name drifting slightly) tracks
                // the group's current state rather than its oldest one.
                if (mtime > (mtimeByKey.get(key) ?? 0)) {
                    existing.notePath = file.path;
                    existing.title = groupTitle;
                    mtimeByKey.set(key, mtime);
                }
                if (
                    date &&
                    (!existing.date || date.getTime() > existing.date.getTime())
                ) {
                    existing.date = date;
                }
            }
        }
        return [...byKey.values()];
    }

    /** Local `YYYY-MM-DD` for today (the `✅` completion date we write/match). */
    private todayStamp(): string {
        const now = new Date();
        const pad = (n: number): string => String(n).padStart(2, "0");
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
            now.getDate()
        )}`;
    }

    /**
     * Best-effort "when did this note happen" for ordering the action-items
     * list: a `start`/`date`/`created` frontmatter stamp, else a leading
     * `YYYY-MM-DD` in the filename (Granola's convention), else the file mtime.
     */
    private resolveNoteDate(
        file: TFile,
        fm: Record<string, unknown> | undefined
    ): Date | null {
        const fromFm = (k: string): Date | null => {
            const v = fm?.[k];
            if (typeof v !== "string" || !v) return null;
            const d = parseStampDate(v);
            return Number.isNaN(d.getTime()) ? null : d;
        };
        const stamped = fromFm("start") ?? fromFm("date") ?? fromFm("created");
        if (stamped) return stamped;
        const m = file.basename.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) {
            const d = parseStampDate(m[1]!);
            if (!Number.isNaN(d.getTime())) return d;
        }
        const mtime = file.stat?.mtime;
        return typeof mtime === "number" ? new Date(mtime) : null;
    }

    /**
     * Marks a scanned task done in its source note. The captured line index is
     * used when it still holds the task; otherwise the original line text is
     * located afresh (the note may have changed since the scan). The first
     * `[ ]` checkbox on that line becomes `[x]` and a `✅ YYYY-MM-DD` completion
     * date (today) is appended — Obsidian-Tasks compatible, and what the
     * dashboard reads to keep the item visible until that day is over.
     */
    private async completeTask(
        path: string,
        task: GroupedTask,
        movedNotice = t().dashboard.actions.taskMoved
    ): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;
        const lines = (await this.app.vault.read(file)).split("\n");
        let idx = task.line;
        if (lines[idx] !== task.raw) {
            idx = lines.findIndex((l) => l === task.raw);
        }
        if (idx < 0) {
            new Notice(movedNotice);
            return;
        }
        const checked = lines[idx]!.replace(/\[[^\]]\]/, "[x]");
        lines[idx] = this.appendCompletionDate(checked, this.todayStamp());
        await this.app.vault.modify(file, lines.join("\n"));
    }

    /**
     * Appends a `✅ YYYY-MM-DD` completion date to a task line, unless it
     * already has one. A trailing block reference (` ^id`) is kept at the end
     * of the line (Obsidian requires it there) with the date inserted before.
     */
    private appendCompletionDate(line: string, dateStr: string): string {
        if (/✅\s*\d{4}-\d{2}-\d{2}/.test(line)) return line;
        const mark = `✅ ${dateStr}`;
        const ref = line.match(/(\s+\^[A-Za-z0-9-]+)\s*$/);
        if (ref) {
            const head = line.slice(0, line.length - ref[0].length).trimEnd();
            return `${head} ${mark}${ref[0]}`;
        }
        return `${line.trimEnd()} ${mark}`;
    }

    /** Nearest scrollable ancestor of an element (the markdown view's scroller). */
    private scrollParent(el: HTMLElement): HTMLElement | null {
        let node: HTMLElement | null = el.parentElement;
        while (node) {
            const oy = getComputedStyle(node).overflowY;
            if (
                (oy === "auto" || oy === "scroll") &&
                node.scrollHeight > node.clientHeight
            ) {
                return node;
            }
            node = node.parentElement;
        }
        return null;
    }

    /**
     * Snapshots the section's scroll position and returns a fn that restores
     * it. Re-rendering a dashboard section empties and rebuilds its element,
     * which otherwise makes the view jump (usually to the top) on a task tick,
     * a page change, or Refresh; call the returned fn once the new content is
     * in place. The rAF re-apply covers async renders whose height settles a
     * frame later.
     */
    private preserveScroll(el: HTMLElement): () => void {
        const scroller = this.scrollParent(el);
        const top = scroller ? scroller.scrollTop : 0;
        return (): void => {
            if (!scroller) return;
            // Re-apply across the next few frames (and a macrotask): async
            // markdown rendering in the action list settles its height a frame
            // or two after the initial rebuild, and a single restore would be
            // undone by that late reflow — leaving the view jumped.
            const apply = (): void => {
                scroller.scrollTop = top;
            };
            apply();
            window.requestAnimationFrame(() => {
                apply();
                window.requestAnimationFrame(apply);
            });
            window.setTimeout(apply, 0);
        };
    }

    /** Opens a file in the active tab (used by dashboard row links/buttons). */
    private openFileInTab(file: TFile, line?: number): void {
        void this.app.workspace
            .getLeaf(false)
            .openFile(file, line !== undefined ? { eState: { line } } : undefined);
    }

    /** Builds an AgendaMeeting view-model from a meeting note's frontmatter. */
    private agendaMeetingFromNote(file: TFile): AgendaMeeting {
        const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ??
            {}) as Record<string, unknown>;
        const str = (k: string): string => {
            const v = fm[k];
            return typeof v === "string" ? v : "";
        };
        // Fall back to "now" for missing/invalid dates so time-based actions
        // (e.g. create-and-record path templates) don't produce "Invalid Date".
        // A bare `YYYY-MM-DD` stamp (see `parseStampDate`) is treated as local
        // midnight rather than `new Date`'s UTC midnight.
        const toDate = (v: unknown): Date => {
            const d = typeof v === "string" ? parseStampDate(v) : new Date(NaN);
            return isNaN(d.getTime()) ? new Date() : d;
        };

        let recording: TFile | null = null;
        const link = recordingLinkTarget(fm["recording"]);
        if (link) {
            const dest = this.app.metadataCache.getFirstLinkpathDest(
                link,
                file.path
            );
            if (dest instanceof TFile) recording = dest;
        }

        return {
            id: str("event_id"),
            title: str("title") || file.basename,
            start: toDate(fm["start"] ?? fm["date"]),
            end: toDate(fm["end"] ?? fm["start"] ?? fm["date"]),
            meetingUrl: str("meeting_url") || null,
            location: str("location"),
            htmlLink: "",
            attendees: Array.isArray(fm["attendees"])
                ? (fm["attendees"] as unknown[]).map((x) => String(x))
                : [],
            invitees: [],
            organizer: str("organizer") || null,
            // Frontmatter doesn't carry the organizer's email (only a display
            // label, if that) for this note-derived, non-calendar meeting.
            organizerEmail: null,
            organizerIsSelf: false,
            iCalUID: str("ical_uid") || null,
            recurringEventId: str("recurring_event_id") || null,
            oneOnOnePartner: str("one_on_one_with") || null,
            oneOnOnePartnerEmail: str("one_on_one_email") || null,
            note: file,
            recording,
            status: str("status") || null,
        };
    }

    /** Row handlers wired to the plugin, for menus shown outside the agenda view. */
    private noteRowHandlers(): RowHandlers {
        return {
            onOpenOrCreate: (m) => void this.openOrCreateNote(m),
            onCreateAndRecord: (m) => this.startRecordingForMeeting(m),
            onCreateNote: (m) => void this.createNoteOnly(m),
            onStop: () => this.stopRecording(),
            onOpenRecording: (m) => void this.openRecording(m),
            onTranscribe: (m, mode) => void this.transcribeRecording(m, mode),
            onImportTranscript: (m) => {
                if (m.note) void this.importTranscript(m.note);
            },
            onEnrich: (m) => {
                if (m.note) void this.enqueueEnrich(m.note);
            },
            onOpenLink: (m) => {
                if (m.meetingUrl) this.openMeetingLink(m.meetingUrl);
            },
            onCopyLink: (m) => {
                if (m.meetingUrl) void this.copyMeetingLink(m.meetingUrl);
            },
            onSkip: () => {},
            isRecordingThis: (m) => this.isRecordingMeeting(m),
            isStoppingThis: (m) => this.isStoppingMeeting(m),
        };
    }

    private async fetchAgendaMeetings(
        fromMs: number,
        toMs: number
    ): Promise<AgendaMeeting[]> {
        const events = await listEvents(
            this.oauth,
            this.settings.calendarId,
            new Date(fromMs),
            new Date(toMs),
            250,
            parseKeywords(this.settings.exclusionKeywords),
            this.settings.excludeWithoutMeetingLink
        );
        this.applyCachedExpandedAttendees(events);
        this.scheduleGroupAttendeeExpand(events);
        this.scheduleOtherContactsSync();
        const index = buildNoteIndex(
            this.app,
            scanMeetingNotes(this.app, this.excludedFolderPatterns())
        );
        return events
            .map((e) => toAgendaMeeting(e, index))
            .sort((a, b) => a.start.getTime() - b.start.getTime());
    }

    private async openOrCreateNote(m: AgendaMeeting): Promise<void> {
        if (m.note) {
            await this.app.workspace.getLeaf(false).openFile(m.note);
            return;
        }
        await this.createNoteOnly(m);
    }

    private async createNoteOnly(m: AgendaMeeting): Promise<void> {
        try {
            const attendees = await this.ensureAttendeesExpanded(m);
            const ref = await createMeetingNote(
                this.app,
                { ...agendaToMeetingInfo(m), attendees },
                this.noteConfig()
            );
            await this.app.workspace.getLeaf(false).openFile(ref.file);
            this.agendaEvents.emit("changed", undefined);
        } catch (e) {
            new Notice(
                t().notices.recordingError(
                    e instanceof Error ? e.message : String(e)
                )
            );
        }
    }

    private async openRecording(m: AgendaMeeting): Promise<void> {
        if (!m.recording) {
            new Notice(t().agenda.notices.noRecording);
            return;
        }
        await this.app.workspace.getLeaf(false).openFile(m.recording);
    }

    /**
     * Transcribes the meeting's recording with the built-in engine.
     *
     * `mode` selects the pass: "auto" respects the speaker-separation setting
     * (used by the auto-transcribe pipeline), while "diarized" / "mixed" let the
     * user force separation on or off from the menus regardless of the setting.
     */
    private async transcribeRecording(
        m: AgendaMeeting,
        mode: TranscribeMode = "auto"
    ): Promise<void> {
        if (!m.recording) {
            new Notice(t().agenda.notices.noRecording);
            return;
        }
        // A manual transcribe supersedes any auto-wait still pending for this
        // take — covers the multi-take rebuild path below, which doesn't go
        // through launchTranscriber (so its own cancellation wouldn't fire).
        this.cancelPendingAutoTranscribe(m.recording.path);
        // A manual re-transcribe REPLACES the transcript. With several takes,
        // transcribing only the latest and replacing would drop the earlier
        // ones' text, so rebuild the whole transcript from every take in one
        // atomic write (see rebuildTranscriptFromTakes). A single take falls
        // through to the plain replace path. Route on the number of linked takes
        // (not resolved files) so a missing audio file can't silently downgrade
        // a multi-take note to a single-take replace that wipes earlier text —
        // the rebuild detects the missing file and aborts instead.
        const linkCount = m.note ? this.recordingLinkCount(m.note) : 0;
        if (m.note && linkCount > 1) {
            await this.rebuildTranscriptFromTakes(m.note, linkCount, mode);
            return;
        }
        await this.launchTranscriber(m.recording, mode);
    }

    /** How many recordings a note's `recording` frontmatter links (array-aware). */
    private recordingLinkCount(note: TFile): number {
        const fm = this.app.metadataCache.getFileCache(note)?.frontmatter as
            | Record<string, unknown>
            | undefined;
        return recordingLinkTargets(fm?.["recording"]).length;
    }

    /** Resolves a note's linked recording(s) to TFiles, in chronological order. */
    private resolveRecordingTakes(note: TFile): TFile[] {
        const fm = this.app.metadataCache.getFileCache(note)?.frontmatter as
            | Record<string, unknown>
            | undefined;
        const out: TFile[] = [];
        for (const link of recordingLinkTargets(fm?.["recording"])) {
            const dest = this.app.metadataCache.getFirstLinkpathDest(
                link,
                note.path
            );
            if (dest instanceof TFile) out.push(dest);
        }
        return out;
    }

    /**
     * True when me-vs-them speaker separation should run: the user enabled it
     * and the current endpoint + model has been probed and confirmed to return
     * timestamps. Gates both the split at record time and the diarized pass at
     * transcribe time.
     *
     * The local Whisper engine always emits segment timestamps, so it bypasses
     * the remote timestamp probe entirely and honors the user's toggle directly
     * — the probe only describes the remote endpoint's behavior, which is moot
     * on-device. For the remote backend the probe gate still applies, so a
     * doomed diarized pass never runs against an endpoint that ignores it.
     */
    /** Effective STT base URL: falls back to enrichment endpoint when empty. */
    private effectiveSttBaseUrl(): string {
        return this.settings.sttApiBaseUrl.trim() || this.settings.apiBaseUrl;
    }

    /** Effective STT API key: falls back to enrichment key when empty. */
    private effectiveSttApiKey(): string {
        return this.settings.sttApiKey.trim() || this.settings.apiKey;
    }

    /** Effective STT fallback base URL: falls back to enrichment fallback when empty. */
    private effectiveSttFallbackBaseUrl(): string {
        return this.settings.sttFallbackApiBaseUrl.trim() || this.settings.fallbackApiBaseUrl;
    }

    /** Effective STT fallback API key: falls back to enrichment fallback key when empty. */
    private effectiveSttFallbackApiKey(): string {
        return this.settings.sttFallbackApiKey.trim() || this.settings.fallbackApiKey;
    }

    private shouldSeparateSpeakers(): boolean {
        if (this.settings.transcriptionBackend === "local") {
            return this.settings.diarizationEnabled;
        }
        return canSeparateSpeakers(
            this.settings,
            probeKey(this.effectiveSttBaseUrl(), this.settings.sttModel)
        );
    }

    /** Absolute path where the given local model file lives (or would live). */
    localModelPath(spec: LocalModelSpec): string {
        return resolveModelPath(this, spec.fileName);
    }

    /**
     * True when the model file is present on disk at its expected size. A
     * partial/interrupted download (wrong size) reads as absent so the UI
     * offers to re-download rather than treating it as ready.
     */
    async localModelPresent(spec: LocalModelSpec): Promise<boolean> {
        try {
            const st = await fs.promises.stat(this.localModelPath(spec));
            return st.size === spec.sizeBytes;
        } catch {
            return false;
        }
    }

    /**
     * Ensures the model is downloaded and SHA-256-verified, streaming it to disk
     * on first use and reusing it thereafter. `onProgress` reports received /
     * total bytes for a download; it isn't called when the model is already
     * present.
     */
    ensureLocalModel(
        spec: LocalModelSpec,
        onProgress?: (received: number, total: number) => void,
        signal?: AbortSignal
    ): Promise<string> {
        return this.modelProvisioner.ensure(
            this.localModelPath(spec),
            spec.url,
            spec.sha256,
            spec.sizeBytes,
            {
                onDownloadStart: () => new Notice(t().notices.downloadingModel),
                // HF's CDN sometimes omits Content-Length after a redirect, so
                // the stream reports total=0; fall back to the registry's known
                // size so the UI can still show a real percentage.
                onProgress: onProgress
                    ? (received, total) =>
                          onProgress(received, total > 0 ? total : spec.sizeBytes)
                    : undefined,
                signal,
            }
        );
    }

    /** Deletes the model file if present (best-effort; a missing file is a no-op). */
    async deleteLocalModel(spec: LocalModelSpec): Promise<void> {
        try {
            await fs.promises.unlink(this.localModelPath(spec));
        } catch {
            // already gone / never downloaded — nothing to do
        }
    }

    /**
     * The engine family to send on the wire. The timestamp-intent Whisper
     * (`whisper-1-ts`) asks for `verbose_json`, which backends that don't emit
     * timestamps reject outright — so downgrade it to plain `whisper-1` unless
     * a fresh probe confirmed this endpoint + model actually returns segments.
     * Other families pass through unchanged.
     */
    private resolveEngineFamily(): SttApiType {
        const s = this.settings;
        if (s.sttApiType !== "whisper-1-ts") return s.sttApiType;
        const key = probeKey(this.effectiveSttBaseUrl(), s.sttModel);
        const timestampsConfirmed =
            s.sttTimestampsProbeKey === key && s.sttTimestampsSupported === true;
        return timestampsConfirmed ? "whisper-1-ts" : "whisper-1";
    }

    /** Maps plugin settings onto the vendored transcription engine's config. */
    private buildTranscribeConfig(
        which: "primary" | "fallback" = "primary"
    ): TranscribeConfig {
        const s = this.settings;
        if (which === "fallback") {
            const fb = fallbackEndpoint(s);
            // Determine effective STT fallback credentials: use STT-specific
            // fallback if set, otherwise fall through to the enrichment fallback.
            const effectiveFbUrl = this.effectiveSttFallbackBaseUrl();
            const effectiveFbKey = this.effectiveSttFallbackApiKey();
            if (!fb && !effectiveFbUrl) {
                // No fallback configured at all; degrade to primary.
                return this.buildTranscribeConfig("primary");
            }
            // Fallback STT is mixed-only: we never probed timestamps on that
            // gateway, so never advertise whisper-1-ts here.
            const baseFamily = (fb?.sttApiType ?? s.sttApiType);
            const family =
                baseFamily === "whisper-1-ts" ? "whisper-1" : baseFamily;
            const sttModel = (fb?.sttModel || s.sttModel).trim();
            return {
                baseUrl: effectiveFbUrl || (fb?.baseUrl ?? s.apiBaseUrl),
                apiKey: effectiveFbKey || (fb?.apiKey ?? ""),
                model: family as TranscriptionModel,
                modelOverride: sttModel,
                chatModel: (fb?.enrichModel ?? s.enrichModel).trim(),
                language: s.sttLanguage || "auto",
                postProcessingEnabled: s.postProcessingEnabled,
                dictionaryCorrectionEnabled: s.dictionaryCorrectionEnabled,
                userDictionaries: parseDictionary(s.dictionary),
                debugMode: s.debugLogging,
            };
        }
        return {
            baseUrl: this.effectiveSttBaseUrl(),
            apiKey: this.effectiveSttApiKey(),
            // The engine family selects routing/chunking/timestamps; sttModel is
            // the actual name sent on the wire (may be a gateway id). Whisper
            // downgrades to no-timestamps when the endpoint can't emit them.
            model: this.resolveEngineFamily() as TranscriptionModel,
            modelOverride: s.sttModel,
            chatModel: s.enrichModel,
            language: s.sttLanguage || "auto",
            postProcessingEnabled: s.postProcessingEnabled,
            dictionaryCorrectionEnabled: s.dictionaryCorrectionEnabled,
            userDictionaries: parseDictionary(s.dictionary),
            debugMode: s.debugLogging,
        };
    }

    /**
     * The transcription backend for this run, built from current settings —
     * the OpenAI-compatible engine, or the on-device Whisper backend when the
     * user selected "local" (issue #34). A fresh instance per call is fine: the
     * serial queue guarding the remote engine's process-global endpoint seam is
     * shared at module scope, and the local backend holds no shared state.
     *
     * Async because the local path provisions its assets (helper, framework,
     * model) on first use before it can transcribe.
     */
    private async buildBackend(): Promise<TranscriptionBackend> {
        if (this.settings.transcriptionBackend === "local") {
            return this.buildLocalBackend();
        }
        return new OpenAICompatibleBackend(this.app, this.buildTranscribeConfig());
    }

    /**
     * Ensures the recorder helper is present *and launchable*: the verified
     * `system-recorder` binary plus the `whisper.framework` dylib it links
     * unconditionally at process start (issue #34). The shipped helper links
     * whisper for EVERY subcommand — `start` and `list-devices`, not just
     * `transcribe` — so without the co-located dylib dyld refuses to launch it
     * and recording/device enumeration break too, regardless of the chosen
     * transcription backend. Treating the two as one runtime unit keeps every
     * spawn path (record, enumerate, transcribe) self-consistent. Returns the
     * binary path; each ensure is a no-op once the asset is present + verified.
     */
    private async ensureHelperRuntime(): Promise<string> {
        const binaryPath = await this.provisioner.ensure(
            resolveBinaryPath(this),
            this.manifest.version,
            () => new Notice(t().notices.downloadingHelper)
        );
        await this.ensureWhisperDylib();
        return binaryPath;
    }

    /**
     * Fetches the whisper.cpp dylib to `whisper.framework/Versions/Current/whisper`
     * next to the helper (where its `@rpath/.../Versions/Current/whisper` load
     * command resolves via SwiftPM's `@loader_path` rpath). It's byte-identical
     * across our releases (pinned XCFramework), so the fixed SHA/size + the
     * provisioner's size fast-path make this a one-time fetch reused thereafter.
     */
    private ensureWhisperDylib(): Promise<string> {
        return this.modelProvisioner.ensure(
            resolveWhisperDylibPath(this),
            whisperDylibUrl(this.manifest.version),
            EXPECTED_WHISPER_SHA256,
            WHISPER_DYLIB_SIZE,
            {
                label: "recorder component",
                onDownloadStart: () => new Notice(t().notices.downloadingRuntime),
            }
        );
    }

    /**
     * Ensures `fvad.wasm` sits next to `main.js` so the diarized path can run
     * local WebRTC VAD (the hallucination filter). BRAT/community installs only
     * ship main.js/manifest/styles, so the file is otherwise absent — unlike a
     * `deploy:local` build, which copies it in. Byte-identical across releases
     * (immutable npm artifact), so the fixed SHA/size + the provisioner's size
     * fast-path make it a one-time fetch reused thereafter.
     *
     * **Best-effort**: local VAD is optional (it degrades to the recorder's RMS
     * windows), so a failed fetch (offline, older release without the asset)
     * must not break transcription. The caller swallows the rejection; we only
     * log at debug. Never shows a download Notice — it's a silent background
     * top-up, not a user-facing prerequisite like the model/helper.
     */
    private ensureFvadWasm(): Promise<string> {
        return this.modelProvisioner.ensure(
            resolveFvadWasmPath(this),
            fvadWasmUrl(this.manifest.version),
            EXPECTED_FVAD_SHA256,
            FVAD_WASM_SIZE,
            { label: "voice-activity detector" }
        );
    }

    /**
     * Provision fvad.wasm without ever stalling or failing the caller. A failed
     * fetch is logged at debug (VAD degrades to the RMS windows); a *slow* fetch
     * is time-boxed — `requestUrl` can't be aborted mid-flight, so on the cap we
     * proceed with the RMS fallback and let the download finish in the
     * background (its rejection is swallowed) so the next run finds it. Resolves
     * (never rejects) once the asset is present or the cap elapses.
     */
    private async ensureFvadWasmBestEffort(): Promise<void> {
        const provision = this.ensureFvadWasm().then(
            () => undefined,
            (e: unknown) => {
                console.debug(
                    "[Meeting Copilot][vad] fvad.wasm unavailable; using RMS fallback",
                    e
                );
            }
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cap = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, FVAD_PROVISION_TIMEOUT_MS);
        });
        try {
            await Promise.race([provision, cap]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    /**
     * The on-device Whisper backend, provisioning everything it needs on first
     * use: the recorder helper runtime (binary + linked framework) and the
     * selected ggml model. Each ensure is a no-op once present, so steady-state
     * adds no download — only the first local transcription (or a model switch)
     * pays for it, behind its own progress notice.
     */
    private async buildLocalBackend(): Promise<TranscriptionBackend> {
        const binaryPath = await this.ensureHelperRuntime();
        const spec = localModelSpec(this.settings.localWhisperModel);
        const modelPath = await this.ensureLocalModel(spec);
        return new WhisperCppBackend(
            {
                binaryPath,
                modelPath,
                language: this.settings.sttLanguage || "auto",
            },
            whisperCppNodeDeps(this)
        );
    }

    /**
     * Whether a failed local transcription should retry against the remote
     * service: only when the user enabled the fallback, an endpoint is
     * configured, and the failure wasn't a user cancellation (which must
     * propagate as a cancel, not be masked by a fallback pass). The caller also
     * gates on the intended backend actually being local.
     */
    private canFallbackToRemote(error: unknown, signal: AbortSignal): boolean {
        return (
            this.settings.localFallbackToRemote &&
            !isDiarizationCancelled(error, signal) &&
            !!this.effectiveSttBaseUrl() &&
            !!this.effectiveSttApiKey()
        );
    }

    /**
     * Runs the speaker-separated pass. Returns the diarized transcript, or null
     * when separation doesn't apply (no sidecars on disk) or the endpoint
     * returned no segments this pass and we fell back to the mixed file. It only
     * invalidates the cached probe when the fallback was a genuine capability
     * miss (no timestamps); a transient error leaves the probe intact so speaker
     * separation isn't disabled for future meetings.
     *
     * Whether to run this at all (respect the setting, or force it) is decided
     * by the caller. When `forced` (the user explicitly asked for separation) a
     * recording with no separate tracks surfaces a notice before falling back.
     */
    private async tryDiarizedTranscribe(
        recording: TFile,
        forced: boolean,
        backend: TranscriptionBackend,
        onProgress?: (percent: number) => void,
        signal?: AbortSignal
    ): Promise<string | null> {
        // Discover the split sidecars by naming convention so separation works
        // for both the auto-transcribe after stop and a manual re-run on an old
        // recording. The helper writes them straight to disk, so check the
        // adapter (which bypasses the vault-index lag) before waiting on the
        // TFile: a recording with no sidecars must not stall the retry loop.
        const sidecars = sidecarPathsFor(recording.path);
        const meFile = await this.resolveExistingFile(sidecars.me);
        const themFile = await this.resolveExistingFile(sidecars.them);
        if (!meFile || !themFile) {
            if (forced) new Notice(t().notices.diarizationNoTracks);
            return null;
        }

        // Speech windows gate out Whisper's silence hallucinations without
        // touching the audio (so the two streams keep their shared clock).
        // Prefer local WebRTC VAD — a real speech/non-speech classifier — over
        // the recorder's crude RMS gate, but merge per stream: if VAD found no
        // speech on a stream, fall back to the recorder's speech.json for that
        // stream (and to no filtering when neither is available).
        //
        // Make sure fvad.wasm is present first (BRAT installs don't ship it);
        // best-effort and time-boxed — a failed OR slow fetch just means
        // computeSpeechWindows falls back to the RMS gate, so it must never
        // stall or break the transcription.
        await this.ensureFvadWasmBestEffort();
        const localWindows = await computeSpeechWindows(this.app, meFile, themFile);
        let rmsWindows: SpeechWindows | undefined;
        const speech = await this.resolveExistingFile(sidecars.speech);
        if (speech) {
            rmsWindows = parseSpeechWindows(await this.app.vault.read(speech));
        }
        const windows = preferWindows(localWindows, rmsWindows);
        // Per-stream pre-gate provenance (issue #67): the diarized pre-gate
        // truncates each upload to these windows, a stronger contract than the
        // merge's touch-filter, so it needs to know which detector produced them
        // (VAD = trust, small pad; RMS-only = big pad; VAD-heard-nothing = full
        // pass). The `windows` above still gate the merge unchanged.
        const sources = pregateSources(localWindows, rmsWindows);
        const result = await transcribeDiarized(
            meFile,
            themFile,
            backend,
            windows,
            signal,
            onProgress,
            sources
        );
        if (result.diarized) return result.text;

        // A transient failure this run (a flaky chunk, a network blip) must not
        // be misread as "this endpoint can't do timestamps": that would null the
        // probe and silently disable speaker separation for every future meeting
        // until the user manually re-checks (issue #61). Only a genuine
        // capability miss warrants invalidating the probe.
        if (!shouldInvalidateProbe(result)) {
            mcLog("transcribe", "diarized fallback", {
                reason: "error",
                recording: recording.path,
            });
            return null;
        }

        // The endpoint didn't return timestamps this pass (a misconfiguration
        // slipping past the probe). Invalidate the cached probe so we stop
        // paying for three passes every meeting, and tell the user how to
        // re-check. The mixed pass runs back in launchTranscriber.
        mcLog("transcribe", "diarized fallback", {
            reason: "capability",
            recording: recording.path,
        });
        this.settings.sttTimestampsSupported = null;
        await this.saveSettings();
        new Notice(t().notices.diarizationNoTimestamps);
        return null;
    }

    /**
     * Resolves a vault path to a TFile only when the file actually exists on
     * disk. Checks the vault adapter first (no index lag) so a sidecar that was
     * never written returns immediately, then reuses the retry helper so a
     * just-written file gets time to land in the vault index.
     */
    private async resolveExistingFile(
        vaultPath: string
    ): Promise<TFile | null> {
        if (!(await this.app.vault.adapter.exists(vaultPath))) return null;
        return this.resolveFileWithRetry(vaultPath);
    }

    /**
     * Enqueues an audio file for headless transcription (no modal, no separate
     * transcript file). Transcriptions run one at a time through the visible
     * {@link TaskQueue}, so a second request waits (and is shown as queued)
     * rather than fighting the first. When enrichment is due (auto-enrich, or
     * the caller asked), it's chained as a *dependent* enrich task on the same
     * queue — visible in the popover, independently cancellable, and run only
     * after the transcription succeeds (a cancelled/failed transcribe drops it).
     *
     * `mode` picks the pass: "auto" respects the speaker-separation setting,
     * "diarized" forces the separated pass (falling back to the joint track when
     * no separate tracks exist), and "mixed" always transcribes the joint track.
     */
    private async launchTranscriber(
        recording: TFile,
        mode: TranscribeMode = "auto",
        opts: { fresh?: boolean; enrichAfter?: boolean } = {}
    ): Promise<void> {
        // "fresh" = the auto-transcribe fired right after a stop (vs. a manual
        // re-transcribe). The fresh path appends its transcript to any existing
        // one (so a new take extends the meeting) and may auto-discard an empty
        // result as silence; a manual re-transcribe replaces. A multi-take
        // manual rebuild has its own path (rebuildTranscriptFromTakes).
        const fresh = opts?.fresh ?? false;
        // A transcribe of this recording from any trigger (manual, or this very
        // auto run once the wait resolved) supersedes a still-pending auto-wait
        // for the same take — cancel it so it can't fire a duplicate later.
        this.cancelPendingAutoTranscribe(recording.path);
        // The remote backend needs an endpoint; the local one provisions its own
        // model/helper, so it can transcribe with no endpoint configured.
        if (
            this.settings.transcriptionBackend !== "local" &&
            (!this.effectiveSttBaseUrl() || !this.effectiveSttApiKey())
        ) {
            new Notice(t().notices.transcribeNoEndpoint);
            return;
        }
        // Dedupe overlapping runs (double-click, or auto-transcribe racing a
        // manual trigger) — each would cost an API call and write.
        if (this.taskQueue.has(recording.path)) {
            new Notice(t().notices.transcribeInProgress);
            return;
        }
        const label = this.transcribeLabelFor(recording);
        // A run already occupies the single slot, so this one will wait; say so.
        if (this.taskQueue.snapshot().running) {
            new Notice(t().notices.transcribeQueued(label));
        }

        // A holder (not a closed-over `let`) so TypeScript keeps the value's type
        // after the await instead of narrowing it to the initializer.
        const enrichAfter: { value: { note: TFile; transcript: string } | null } = {
            value: null,
        };
        const transcribeDone = this.taskQueue.enqueue({
            id: recording.path,
            label,
            kind: "transcribe",
            run: async (signal) => {
                enrichAfter.value = await this.transcribeToNote(
                    recording,
                    label,
                    mode,
                    signal,
                    fresh
                );
            },
        });

        // Chain enrichment as a dependent queue task (issue #96): it shows in the
        // same popover, is independently cancellable, and runs only after the
        // transcription SUCCEEDS — a cancelled/failed transcribe drops it. Enrich
        // afterwards when auto-transcribe says so, or when the caller asked (the
        // user clicked Enrich on a not-yet-transcribed note).
        const shouldEnrich =
            this.settings.enableEnrichment &&
            (opts.enrichAfter || this.settings.enrichOnTranscribe);
        if (shouldEnrich) {
            const note = findMeetingNoteForAudio(this.app, recording);
            if (note) {
                void this.enqueueEnrichTask(note, {
                    dependsOn: recording.path,
                    // Pass the fresh transcript so enrichment works even when
                    // insertTranscript is off and the note has no transcript yet.
                    // Skip quietly if the run produced none (silence / no note).
                    resolveTranscript: () => enrichAfter.value?.transcript,
                    quiet: true,
                });
            }
        }

        try {
            await transcribeDone;
        } catch (e) {
            // Cancellation is expected; other failures were already surfaced with
            // their own notice/status inside transcribeToNote.
            if (!(e instanceof TaskCancelledError)) {
                mcLog("transcribe", "transcription failed", {
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }
    }

    /**
     * Transcribes one recording (take) to ready-to-insert text, without writing
     * to any note — the shared core of the single-take writer
     * ({@link transcribeToNote}) and the multi-take rebuild
     * ({@link rebuildTranscriptFromTakes}). Drives the shared progress bar and
     * classifies the outcome (see {@link TranscribeTakeResult}). User
     * cancellation throws {@link TaskCancelledError} so the queue
     * rejects; every other failure returns an "error"/"partial" result.
     */
    private async transcribeTakeToText(
        recording: TFile,
        label: string,
        mode: TranscribeMode,
        signal: AbortSignal
    ): Promise<TranscribeTakeResult> {
        // Single-owner progress: only the running job writes to the shared bar,
        // labelled with the meeting name (and any queued-behind count).
        const onProgress = (pct: number): void => {
            const snapshot = this.taskQueue.snapshot();
            if (snapshot.running?.id !== recording.path) {
                return;
            }
            const rounded = Math.round(pct);
            const changed = this.runningProgress?.pct !== rounded;
            this.runningProgress = { id: recording.path, pct: rounded };
            this.setActionStatus(
                this.transcribeStatusText(
                    label,
                    rounded,
                    this.taskQueue.waitingCount
                ),
                "busy"
            );
            // Progress ticks don't emit a queue transition, so an open popover
            // would freeze on a stale percent between tasks — refresh it here
            // (only when the rounded value actually moved, to avoid churn).
            if (changed && this.statusHovered) this.showQueuePopover(snapshot);
        };
        // New job: forget the previous run's percent until its first tick.
        this.runningProgress = null;
        this.setActionStatus(t().statusBar.transcribingNamed(label), "busy");
        const transcribeStart = Date.now();
        const sizeMb = (recording.stat?.size ?? 0) / (1024 * 1024);
        // console.warn so the timing line shows in Obsidian's console without
        // enabling Verbose logging (mirrors the vendored engine's own logger).
        console.warn(
            `[Meeting Copilot][transcribe] "${recording.name}" begin (mode=${mode}, size=${sizeMb.toFixed(1)}MB)`
        );
        try {
            // Decide whether to run speaker separation: "auto" defers to the
            // setting, "diarized" forces it on, "mixed" forces it off. A null
            // back from the diarized pass means it didn't apply or fell back, in
            // which case we transcribe the mixed wav (which always exists).
            const wantDiarized =
                mode === "diarized" ||
                (mode === "auto" && this.shouldSeparateSpeakers());
            // Whether the *intended* backend is local, sampled before building it
            // so a provisioning failure (model/helper download) can fall back too.
            const useLocal = this.settings.transcriptionBackend === "local";
            let diarized: boolean;
            let rawText: string;
            try {
                const backend = await this.buildBackend();
                const diarizedText = wantDiarized
                    ? await this.tryDiarizedTranscribe(
                          recording,
                          mode === "diarized",
                          backend,
                          onProgress,
                          signal
                      )
                    : null;
                diarized = diarizedText !== null;
                rawText =
                    diarizedText ??
                    (await transcribeAudio(recording, backend, signal, onProgress));
            } catch (e) {
                // On-device transcription can fail hard (model/helper missing, a
                // decode error, an OOM). When the user opted into "fall back to
                // remote" and an endpoint is configured, retry a plain mixed pass
                // against it — a degraded but working transcript beats none.
                // Diarization isn't retried remotely: its timestamp support isn't
                // probed on this path, and a mixed transcript is the safe floor.
                //
                // A separate *endpoint* fallback covers primary remote service
                // outages (and a primary-remote attempt that itself fails after
                // local→remote), always as mixed.
                if (isDiarizationCancelled(e, signal)) throw e;

                const runRemoteMixed = async (
                    which: "primary" | "fallback"
                ): Promise<string> => {
                    onProgress(0);
                    const remote = new OpenAICompatibleBackend(
                        this.app,
                        this.buildTranscribeConfig(which)
                    );
                    return transcribeAudio(
                        recording,
                        remote,
                        signal,
                        onProgress
                    );
                };

                const tryEndpointFallback = async (
                    fromError: unknown
                ): Promise<string | null> => {
                    if (
                        isDiarizationCancelled(fromError, signal) ||
                        signal.aborted ||
                        !isServiceFailure(fromError) ||
                        !isFallbackEndpointConfigured(this.settings)
                    ) {
                        return null;
                    }
                    mcLog("transcribe", "primary→fallback endpoint", {
                        recording: recording.name,
                        error:
                            fromError instanceof Error
                                ? fromError.message
                                : String(fromError),
                    });
                    new Notice(
                        wantDiarized
                            ? t().notices.endpointFallbackTranscribeNoDiarization
                            : t().notices.endpointFallbackTranscribe
                    );
                    return runRemoteMixed("fallback");
                };

                if (useLocal && this.canFallbackToRemote(e, signal)) {
                    mcLog("transcribe", "local→remote fallback", {
                        recording: recording.path,
                        error: e instanceof Error ? e.message : String(e),
                    });
                    new Notice(
                        wantDiarized
                            ? t().notices.localFallbackNoDiarization
                            : t().notices.localFallback
                    );
                    try {
                        diarized = false;
                        rawText = await runRemoteMixed("primary");
                    } catch (e2) {
                        if (isDiarizationCancelled(e2, signal)) throw e2;
                        const fbText = await tryEndpointFallback(e2);
                        if (fbText === null) throw e2;
                        diarized = false;
                        rawText = fbText;
                    }
                } else if (!useLocal) {
                    const fbText = await tryEndpointFallback(e);
                    if (fbText === null) throw e;
                    diarized = false;
                    rawText = fbText;
                } else {
                    throw e;
                }
            }
            const totalSecs = ((Date.now() - transcribeStart) / 1000).toFixed(1);
            console.warn(
                `[Meeting Copilot][transcribe] "${recording.name}" transcription finished in ${totalSecs}s (diarized=${diarized}${
                    wantDiarized && !diarized ? ", fell back to mixed" : ""
                })`
            );
            // The diarized path already filters silence hallucinations per
            // segment before merging. The mixed path has no segment seam, so a
            // silent recording can come back as nothing but a stock YouTube-outro
            // phrase; strip those whole lines so it's treated as empty rather
            // than written out as a bogus note/title.
            const text = diarized ? rawText : stripHallucinatedLines(rawText);

            const trimmed = text.trim();
            if (!trimmed) {
                // Log the outcome: an empty result after filtering is a common
                // reason a re-transcribe "does nothing" — the note is left
                // untouched on purpose (we never overwrite a transcript with
                // nothing). Surfacing it makes that visible in the log instead
                // of the run just going silent.
                mcLog("transcribe", "empty after filter", {
                    recording: recording.name,
                    diarized,
                    rawLen: rawText.length,
                    strippedLen: text.length,
                });
                return { kind: "empty" };
            }
            // A partial/failed run comes back as a marker-prefixed string
            // (not clean transcript text), so don't insert it as the transcript.
            if (isPartialTranscript(trimmed)) {
                return { kind: "partial" };
            }
            // Tell the reader (and the enrichment model) who "Me"/"Them" are,
            // so owner attribution of action items has something to go on.
            const finalText = diarized
                ? `${t().transcript.speakerBanner}\n\n${text}`
                : text;
            return { kind: "text", text: finalText };
        } catch (e) {
            // A user cancellation must propagate so the queue rejects (and the
            // caller skips enrichment); everything else is a recoverable failure
            // surfaced here.
            if (isDiarizationCancelled(e, signal)) {
                new Notice(t().notices.transcribeCancelled);
                this.setActionStatus(t().statusBar.transcribeCancelled, "error");
                // Re-throw as the queue's cancellation type so the caller's
                // guard treats it as an expected cancel (no "failed" log) —
                // matching the waiting-job path, which rejects with this error.
                throw new TaskCancelledError();
            }
            const msg = e instanceof Error ? e.message : String(e);
            // The engine throws the partial text (marker-prefixed) for a
            // partial/failed run rather than returning it, so classify it.
            if (isPartialTranscript(msg)) {
                return { kind: "partial" };
            }
            return { kind: "error", message: msg };
        }
    }

    /**
     * The single-take transcription pass run by the queue: transcribes one
     * recording and writes the result into its meeting note. Returns the note +
     * fresh transcript to enrich afterward, or null when there's nothing to
     * enrich (empty/partial/error result, or no owning note). A `fresh` take
     * (auto-transcribe right after a stop) APPENDS to any existing transcript so
     * a new take extends the meeting, and may auto-discard an empty result as
     * silence; a manual re-transcribe REPLACES. Throws only on cancellation, so
     * the queue rejects and the caller skips enrichment.
     */
    private async transcribeToNote(
        recording: TFile,
        label: string,
        mode: TranscribeMode,
        signal: AbortSignal,
        fresh = false
    ): Promise<{ note: TFile; transcript: string } | null> {
        const res = await this.transcribeTakeToText(recording, label, mode, signal);
        if (res.kind === "empty") {
            // A fresh recording with no speech is the "started before anyone
            // joined" throwaway — discard it (audio + link) so the meeting
            // re-offers record. Only on the fresh post-stop path: a manual
            // re-transcribe that comes back empty must never delete audio.
            // Safety net: if the recorder's own speech detection (split-mode
            // speech.json) found speech, an empty transcript is a transcription
            // miss, not silence — keep the audio rather than discard it.
            if (
                fresh &&
                this.settings.discardSilentRecordings &&
                !(await this.recordingHasSpeech(recording))
            ) {
                mcLog("recorder", "discard silent", {
                    recording: recording.path,
                    hasSpeech: false,
                    speechJson: "empty-or-missing",
                });
                await this.discardSilentRecording(recording);
            } else {
                if (res.kind === "empty") {
                    mcLog("recorder", "keep empty transcript", {
                        recording: recording.path,
                        fresh,
                        discardEnabled: this.settings.discardSilentRecordings,
                    });
                }
                new Notice(t().notices.transcribeEmpty);
            }
            if (!this.recorder.isRecording) this.clearActionStatus();
            return null;
        }
        if (res.kind === "partial") {
            new Notice(t().notices.transcribePartial);
            this.setActionStatus(t().statusBar.transcribeFailed, "error");
            return null;
        }
        if (res.kind === "error") {
            new Notice(t().notices.transcribeError(res.message));
            this.setActionStatus(t().statusBar.transcribeFailed, "error");
            return null;
        }
        const finalText = res.text;
        const result = await this.handleTranscriptionCompleted(
            {
                audioFile: recording,
                transcription: finalText,
                file: null,
            },
            fresh
        );
        console.warn(
            `[Meeting Copilot][transcribe] "${recording.name}" completed: note ${
                result.note
                    ? "found and updated"
                    : "NOT found (no note matched this recording)"
            }`
        );
        if (!result.note) {
            new Notice(t().notices.transcribeNoNote(recording.basename));
            return null;
        }
        // The .me/.them/.speech sidecars are left in place: a later manual
        // re-transcribe reuses them, and the retention sweep ages them out
        // on the same rule as the audio.
        return { note: result.note, transcript: result.transcript ?? finalText };
    }

    /**
     * Manual re-transcribe for a note that owns several takes: transcribes every
     * take to text (through the queue, one at a time), then does a SINGLE atomic
     * replace of the note's transcript with all takes joined chronologically and
     * enriches once. All-or-nothing: the note is written only when EVERY take
     * produced text, so a missing audio file, an empty/partial/failed take, or a
     * cancellation mid-run leaves the existing (complete) transcript intact
     * rather than replacing it with a shorter rebuild. `expectedTakes` is the
     * number of linked takes, so an unresolvable link is caught as a missing
     * file instead of silently dropped.
     */
    private async rebuildTranscriptFromTakes(
        note: TFile,
        expectedTakes: number,
        mode: TranscribeMode
    ): Promise<void> {
        if (!this.effectiveSttBaseUrl() || !this.effectiveSttApiKey()) {
            new Notice(t().notices.transcribeNoEndpoint);
            return;
        }
        const takes = this.resolveRecordingTakes(note);
        // A linked take whose audio can't be resolved means we can't reproduce
        // the full transcript — abort rather than replace it with a rebuild that
        // silently omits the missing take.
        if (takes.length !== expectedTakes) {
            new Notice(t().notices.retranscribeIncomplete);
            if (!this.recorder.isRecording) this.clearActionStatus();
            return;
        }
        // Bail if any take is already queued/running (a fresh auto-transcribe,
        // or a double trigger) — rebuilding while one is in flight would
        // interleave writes.
        if (takes.some((take) => this.taskQueue.has(take.path))) {
            new Notice(t().notices.transcribeInProgress);
            return;
        }
        const label = this.meetingNoteLabel(note);
        const segments: string[] = [];
        let allText = true;
        try {
            for (const take of takes) {
                if (this.taskQueue.snapshot().running) {
                    new Notice(t().notices.transcribeQueued(label));
                }
                const outcome: { value: TranscribeTakeResult | null } = {
                    value: null,
                };
                await this.taskQueue.enqueue({
                    id: take.path,
                    label,
                    kind: "transcribe",
                    run: async (signal) => {
                        outcome.value = await this.transcribeTakeToText(
                            take,
                            label,
                            mode,
                            signal
                        );
                    },
                });
                const res = outcome.value;
                if (res?.kind === "text") {
                    segments.push(res.text);
                    continue;
                }
                // Any non-text outcome (empty/partial/error) means we can't
                // produce the complete transcript this run — remember that and
                // surface why, but keep going so the user sees every take's
                // outcome before we decide not to overwrite.
                allText = false;
                if (res?.kind === "partial")
                    new Notice(t().notices.transcribePartial);
                else if (res?.kind === "error")
                    new Notice(t().notices.transcribeError(res.message));
                else new Notice(t().notices.transcribeEmpty);
            }
        } catch (e) {
            // Cancellation (or an unexpected queue failure) mid-rebuild: leave
            // the existing transcript untouched rather than write a partial one.
            if (!(e instanceof TaskCancelledError)) {
                mcLog("transcribe", "transcript rebuild failed", {
                    error: e instanceof Error ? e.message : String(e),
                });
            }
            return;
        }
        if (!allText || segments.length === 0) {
            // Some take didn't come back as clean text: don't overwrite the
            // existing (complete) transcript with a shorter rebuild.
            console.warn(
                "[Meeting Copilot][transcribe] rebuild incomplete; note left unchanged"
            );
            new Notice(t().notices.retranscribeIncomplete);
            if (!this.recorder.isRecording) this.clearActionStatus();
            return;
        }
        const combined = segments.join(TRANSCRIPT_SEGMENT_SEPARATOR);
        if (this.settings.insertTranscript) {
            await insertTranscript(this.app, note, combined, { append: false });
            new Notice(t().notices.transcriptAdded(note.basename));
            this.setActionStatus(t().statusBar.transcriptAdded, "success");
        } else if (!this.recorder.isRecording) {
            this.hideStatusBar();
        }
        this.agendaEvents.emit("changed", undefined);
        this.refreshNoteIssuesBlocks();
        if (this.settings.enableEnrichment && this.settings.enrichOnTranscribe) {
            // The rebuild already ran through the queue; enqueue enrichment as its
            // own visible/cancellable task with the freshly combined transcript.
            void this.enqueueEnrichTask(note, { transcriptOverride: combined, quiet: true });
        }
    }

    /** A friendly name for a recording in the queue UI: its meeting note's title, else the file basename. */
    private transcribeLabelFor(recording: TFile): string {
        const note = findMeetingNoteForAudio(this.app, recording);
        if (note) return this.meetingNoteLabel(note);
        return recording.basename;
    }

    /** A meeting note's display label for the queue UI: its `title` frontmatter, else its basename. */
    private meetingNoteLabel(note: TFile): string {
        const fm = this.app.metadataCache.getFileCache(note)?.frontmatter as
            | Record<string, unknown>
            | undefined;
        const title = fm?.["title"];
        if (typeof title === "string" && title.trim()) return title.trim();
        return note.basename;
    }

    /** The task-queue id for importing a transcript into a note; namespaced so it can't collide with a recording path or an enrich task. */
    private importTaskId(notePath: string): string {
        return `import:${notePath}`;
    }

    /**
     * Opens a native file picker and resolves to the chosen file (its content
     * is read via the standard File API, so this needs no Node `fs` access),
     * or `null` if the user dismissed the dialog without picking one.
     */
    private pickTranscriptFile(): Promise<File | null> {
        return new Promise((resolve) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".vtt,.txt,.srt,.md,text/plain,text/vtt";
            input.onchange = () => resolve(input.files?.[0] ?? null);
            // Fires when the dialog is dismissed with no selection — without
            // this the promise would never settle in that case.
            input.oncancel = () => resolve(null);
            input.click();
        });
    }

    /**
     * Cleans up an arbitrary transcript export into the plugin's own
     * "Speaker: text" per-line convention (the same shape `mergeDiarized`
     * produces for a local recording), so an imported transcript reads
     * identically to enrichment and to a human skimming the note.
     *
     * A Zoom `.vtt` export is detected and parsed deterministically — no LLM
     * call, so it's instant and can't hallucinate. Anything else (plain text,
     * SRT, a chat export, a non-standard VTT) goes through the configured
     * enrichment LLM instead, since a one-off parser can't cover every export
     * shape. Returns "" (with a Notice already shown) when cleanup can't
     * proceed, so the caller can bail without writing anything.
     */
    private async cleanImportedTranscript(
        raw: string,
        signal: AbortSignal
    ): Promise<string> {
        if (looksLikeZoomVtt(raw)) {
            const parsed = parseZoomTranscript(raw);
            if (parsed) return parsed.transcript;
            // Looked like a Zoom VTT header, but the cues didn't parse cleanly
            // enough to trust (see parseZoomTranscript's escape hatch) — fall
            // through to the LLM, which can still make sense of a
            // non-standard export.
        }
        // Cleanup is itself an LLM call on the same endpoint/model as
        // enrichment, so it respects the same master toggle: a user who
        // turned AI features off shouldn't have one fire anyway just because
        // they imported a non-Zoom file.
        if (!this.settings.enableEnrichment) {
            new Notice(t().notices.enrichDisabled);
            return "";
        }
        const { apiBaseUrl, apiKey, enrichModel } = this.settings;
        if (this.settings.enrichBackend === "api" && (!apiBaseUrl || !apiKey || !enrichModel)) {
            new Notice(t().notices.transcriptImportNoEndpoint);
            return "";
        }
        new Notice(t().notices.transcriptImportCleaning);
        // Same transcript token budget and timeout enrichment itself uses, so
        // a long import can't silently overrun the endpoint's context window
        // (the model would otherwise have to guess where to cut, which reads
        // as an unflagged truncation) or hang past what the user configured.
        const budgeted = truncateTranscriptForBudget(
            raw,
            this.settings.enrichMaxTranscriptTokens
        ).text;
        const timeoutMs = Math.min(
            600_000,
            Math.max(60_000, (this.settings.enrichTimeoutSeconds || 120) * 1000)
        );
        try {
            if (this.settings.enrichBackend !== "api") {
                const backend = this.settings.enrichBackend;
                return await cliChatComplete({
                    cli: backend,
                    cliPath: this.settings.enrichCliPaths[backend] || undefined,
                    model: this.settings.enrichCliModels[backend] || undefined,
                    system: TRANSCRIPT_CLEANUP_SYSTEM_PROMPT,
                    user: buildTranscriptCleanupPrompt(budgeted),
                    signal,
                    timeoutMs,
                });
            }
            return await chatComplete({
                baseUrl: apiBaseUrl,
                apiKey,
                model: enrichModel,
                system: TRANSCRIPT_CLEANUP_SYSTEM_PROMPT,
                user: buildTranscriptCleanupPrompt(budgeted),
                signal,
                timeoutMs,
            });
        } catch (e) {
            if (e instanceof ChatAbortError || e instanceof CLIAbortError) return "";
            new Notice(
                t().notices.transcriptImportError(
                    e instanceof Error ? e.message : String(e)
                )
            );
            return "";
        }
    }

    /**
     * "Import transcript" — lets a user who recorded locally but later got
     * hold of a more accurate transcript (e.g. the official Zoom transcript)
     * replace the note's transcript with a cleaned-up version of it, then
     * re-enriches from it. Runs as a "transcribe"-kind queue task (it *is*
     * producing a transcript, just from a file instead of audio) so it's
     * visible/cancellable like any other background job, and so cancelling
     * it (or "Cancel transcription") behaves exactly like cancelling a real
     * transcription.
     */
    private async importTranscript(note: TFile): Promise<void> {
        const id = this.importTaskId(note.path);
        if (this.taskQueue.has(id)) {
            new Notice(t().notices.transcriptImportInProgress);
            return;
        }
        const file = await this.pickTranscriptFile();
        if (!file) return;
        const raw = await file.text();
        if (!raw.trim()) {
            new Notice(t().notices.transcriptImportEmpty);
            return;
        }

        // Not awaited by design (mirrors enqueueEnrichTask): the caller is a
        // fire-and-forget menu handler (`void this.importTranscript(...)`),
        // so a cancellation rejecting this promise must be caught here or it
        // surfaces as an unhandled rejection in the renderer.
        this.taskQueue
            .enqueue({
                id,
                label: this.meetingNoteLabel(note),
                kind: "transcribe",
                run: async (signal) => {
                    const cleaned = await this.cleanImportedTranscript(
                        raw,
                        signal
                    );
                    if (signal.aborted || !cleaned.trim()) return;
                    // Mirrors the re-transcribe flow: `insertTranscript`
                    // writes the callout and stamps `transcript_saved`, which
                    // is what makes the note's audio eligible for retention
                    // pruning — so, same as re-transcribing, that only
                    // happens when the user actually wants transcripts
                    // written into notes. Enrichment still runs from the
                    // cleaned transcript either way.
                    let applied = false;
                    if (this.settings.insertTranscript) {
                        await insertTranscript(this.app, note, cleaned, {
                            append: false,
                        });
                        new Notice(t().notices.transcriptAdded(note.basename));
                        this.setActionStatus(
                            t().statusBar.transcriptAdded,
                            "success"
                        );
                        this.agendaEvents.emit("changed", undefined);
                        applied = true;
                    }
                    if (
                        this.settings.enableEnrichment &&
                        this.settings.enrichOnTranscribe
                    ) {
                        void this.enqueueEnrichTask(note, {
                            transcriptOverride: cleaned,
                            quiet: true,
                        });
                        applied = true;
                    }
                    // Both gates matching the re-transcribe flow's settings
                    // can leave nothing visibly happening for an explicit,
                    // deliberate user action — say so rather than going
                    // silent.
                    if (!applied) {
                        new Notice(t().notices.transcriptImportNotApplied);
                    }
                },
            })
            .catch((e) => {
                if (!(e instanceof TaskCancelledError)) {
                    mcLog("import", "queue fail", {
                        note: note.path,
                        error: e instanceof Error ? e.message : String(e),
                    });
                }
            });
    }

    /** Reflects the queue's running/waiting state in the status bar (single-owner). */
    private renderQueueStatus(snapshot: QueueSnapshot): void {
        // Keep the hover popover live as the queue changes (or drop it when the
        // queue drains). The recording timer drives its own refresh, so only do
        // this on the non-recording path below.
        if (this.statusHovered) {
            if (snapshot.running || snapshot.waiting.length > 0)
                this.showQueuePopover(snapshot);
            else this.hideQueuePopover();
        }
        // The live recording timer owns the bar; and an idle queue leaves any
        // just-set terminal status (added / failed / cancelled) to settle on its
        // own rather than clearing it here. A running *enrich* owns the bar via
        // its own setEnrichStatus, so only the transcribe line is driven here.
        if (
            this.recorder.isRecording ||
            snapshot.running?.kind !== "transcribe"
        )
            return;
        // Preserve the live percentage across queue-change repaints: progress
        // ticks are sparse, so without this the bar would sit on a percent-less
        // label between them whenever a job is queued behind the running one.
        const running = snapshot.running;
        const pct =
            this.runningProgress?.id === running.id
                ? this.runningProgress.pct
                : null;
        this.setActionStatus(
            this.transcribeStatusText(running.label, pct, snapshot.waiting.length),
            "busy"
        );
    }

    /**
     * The status-bar line for a running transcription: percent-led when known
     * (`12% Name`), a plain `Name…` before the first tick, with a ` (+n queued)`
     * suffix when jobs wait behind it. Single source of truth for both the
     * progress ticks and the queue-change repaints so they never disagree.
     */
    private transcribeStatusText(
        label: string,
        pct: number | null,
        waiting: number
    ): string {
        const base =
            pct === null
                ? t().statusBar.transcribingNamed(label)
                : t().statusBar.transcribingNamedProgress(label, pct);
        return waiting > 0 ? base + t().statusBar.queuedSuffix(waiting) : base;
    }

    /**
     * Enter/leave the status bar (or the popover): reveal or defer-tear-down the
     * queue popover. Leaving schedules the hide on a short grace so the pointer
     * can cross into the interactive popover without it vanishing (and back).
     */
    private setStatusHover(hovering: boolean): void {
        if (hovering) {
            this.cancelPopoverHide();
            this.statusHovered = true;
            const snapshot = this.taskQueue.snapshot();
            if (snapshot.running || snapshot.waiting.length > 0)
                this.showQueuePopover(snapshot);
            return;
        }
        this.schedulePopoverHide();
    }

    /** Cancels a pending popover teardown (pointer re-entered the bar/popover). */
    private cancelPopoverHide(): void {
        if (this.popoverHideTimer !== null) {
            window.clearTimeout(this.popoverHideTimer);
            this.popoverHideTimer = null;
        }
    }

    /** Hides the popover after a short grace, so the bar↔popover hand-off survives. */
    private schedulePopoverHide(): void {
        this.cancelPopoverHide();
        this.popoverHideTimer = window.setTimeout(() => {
            this.popoverHideTimer = null;
            this.statusHovered = false;
            this.hideQueuePopover();
        }, 200);
    }

    /**
     * Shows (or refreshes) the roll-up panel above the status bar listing the
     * running task plus the next few waiting behind it. Each row carries a cancel
     * (x) control and the running transcription's live percentage (issue #96);
     * the panel is interactive, so a short hide grace bridges the bar↔popover gap.
     */
    private showQueuePopover(snapshot: QueueSnapshot): void {
        if (
            !this.statusBarEl ||
            (!snapshot.running && snapshot.waiting.length === 0)
        )
            return;
        if (!this.queuePopoverEl) {
            this.queuePopoverEl = document.body.createDiv({
                cls: "mc-queue-popover",
            });
            // Keep the panel alive while the pointer is over it (it's clickable),
            // and defer teardown when the pointer leaves.
            this.queuePopoverEl.addEventListener("mouseenter", () =>
                this.setStatusHover(true)
            );
            this.queuePopoverEl.addEventListener("mouseleave", () =>
                this.schedulePopoverHide()
            );
        }
        const el = this.queuePopoverEl;
        el.empty();
        el.createDiv({
            cls: "mc-queue-popover-title",
            text: t().statusBar.queuePopoverTitle,
        });
        const list = el.createDiv({ cls: "mc-queue-popover-list" });
        // `running` is momentarily null between tasks; still show the queue then.
        if (snapshot.running) {
            const pct =
                snapshot.running.kind === "transcribe" &&
                this.runningProgress?.id === snapshot.running.id
                    ? this.runningProgress.pct
                    : null;
            this.renderPopoverRow(list, snapshot.running, true, pct);
        }
        const limit = SystemRecordingPlugin.QUEUE_POPOVER_LIMIT;
        for (const item of snapshot.waiting.slice(0, limit)) {
            this.renderPopoverRow(list, item, false, null);
        }
        const extra = snapshot.waiting.length - limit;
        if (extra > 0) {
            el.createDiv({
                cls: "mc-queue-popover-more",
                text: t().statusBar.queueMore(extra),
            });
        }

        // Anchor the panel just above the status bar item, then clamp its left
        // so it can't spill off the right edge (the status bar sits far right,
        // and a short label like "Recording" would otherwise push it offscreen).
        // Measured after the content is in the DOM so offsetWidth is real.
        const rect = this.statusBarEl.getBoundingClientRect();
        const maxLeft = window.innerWidth - el.offsetWidth - 8;
        const left = Math.min(Math.max(8, rect.left), Math.max(8, maxLeft));
        el.style.left = `${left}px`;
        el.style.bottom = `${window.innerHeight - rect.top + 6}px`;
        window.requestAnimationFrame(() => el.addClass("is-visible"));
    }

    /**
     * Renders one popover row: a kind icon (spinner while running), the verb +
     * meeting label, the running transcription's percentage when known, and a
     * cancel (x) control wired to {@link TaskQueue.cancel} for this item.
     */
    private renderPopoverRow(
        list: HTMLElement,
        item: QueueItem,
        running: boolean,
        pct: number | null
    ): void {
        const row = list.createDiv({
            cls: running
                ? "mc-queue-popover-item is-running"
                : "mc-queue-popover-item",
        });
        setIcon(
            row.createSpan({ cls: "mc-queue-popover-icon" }),
            running ? "loader-2" : this.queueKindIcon(item.kind)
        );
        // A transcript import runs as a "transcribe"-kind task (so cancelling
        // it, and "Cancel transcription", behave the same as for a real
        // transcription — see importTaskId/importTranscript), but it should
        // still read as "Importing" rather than "Transcribing" in the queue
        // UI; the id prefix is the only thing distinguishing the two.
        const verb =
            item.kind === "enrich"
                ? t().statusBar.queueKindEnrich
                : item.id.startsWith("import:")
                ? t().statusBar.queueKindImport
                : t().statusBar.queueKindTranscribe;
        row.createSpan({
            cls: "mc-queue-popover-label",
            text: `${verb} · ${item.label}`,
        });
        if (pct !== null) {
            row.createSpan({
                cls: "mc-queue-popover-pct",
                text: `${pct}%`,
            });
        }
        const cancel = row.createEl("button", {
            cls: "mc-queue-popover-cancel",
            attr: { "aria-label": t().statusBar.queueCancel, type: "button" },
        });
        setIcon(cancel, "x");
        cancel.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.taskQueue.cancel(item.id);
        });
    }

    /** The lucide icon for a queued task kind (waiting rows; running rows spin a loader). */
    private queueKindIcon(kind: TaskKind): string {
        return kind === "enrich" ? "sparkles" : "clock";
    }

    /** Removes the queue hover popover and cancels any pending teardown. */
    private hideQueuePopover(): void {
        this.cancelPopoverHide();
        this.queuePopoverEl?.remove();
        this.queuePopoverEl = null;
    }

    /**
     * Cancels every queued/running *transcription* (command-palette action).
     * Enrichment tasks are left alone — cancel those individually from the
     * popover's per-item x. Cancelling a running transcribe transitively drops
     * any enrichment chained behind it (the queue's dependency handling).
     */
    private cancelActiveTranscription(): void {
        const snapshot = this.taskQueue.snapshot();
        const transcribeIds = [snapshot.running, ...snapshot.waiting]
            .filter((item): item is QueueItem => item?.kind === "transcribe")
            .map((item) => item.id);
        if (transcribeIds.length === 0) {
            new Notice(t().notices.nothingTranscribing);
            return;
        }
        for (const id of transcribeIds) this.taskQueue.cancel(id);
    }

    /**
     * On startup, count meeting notes that finished recording but were never
     * transcribed (status `recorded` + an existing linked recording) and nudge
     * the user — a plugin reload mid-transcription otherwise silently drops the
     * queued work with nothing prompting recovery.
     */
    private notifyPendingTranscriptions(): void {
        let pending = 0;
        for (const entry of scanMeetingNotes(
            this.app,
            this.excludedFolderPatterns()
        )) {
            if (entry.status !== "recorded") continue;
            const link = recordingLinkTarget(entry.recording);
            if (!link) continue;
            const dest = this.app.metadataCache.getFirstLinkpathDest(
                link,
                entry.file.path
            );
            if (dest instanceof TFile) pending++;
        }
        if (pending > 0) {
            new Notice(t().notices.recordingsPending(pending), 10000);
        }
    }

    /**
     * Enumerate input (microphone) devices via the recorder helper, for the
     * settings picker. Ensures the helper binary is present first (downloading
     * it unless `allowDownload` is false); returns [] when it can't be made
     * available or on any enumeration failure. macOS-only in practice.
     */
    async listInputDevices(opts?: {
        allowDownload?: boolean;
    }): Promise<InputDevice[]> {
        if (!Platform.isMacOS) return [];
        const binaryPath = resolveBinaryPath(this);
        if (opts?.allowDownload === false) {
            // Best-effort: only list if the helper is already launchable on disk
            // (binary AND its linked dylib), never trigger a download just to
            // populate the dropdown on open. Spawning the binary without the
            // dylib would fail in dyld, so require both.
            if (!fs.existsSync(binaryPath) || !fs.existsSync(resolveWhisperDylibPath(this))) {
                return [];
            }
        } else {
            try {
                await this.ensureHelperRuntime();
            } catch (e) {
                new Notice(e instanceof Error ? e.message : String(e));
                return [];
            }
        }
        return listInputDevices(binaryPath);
    }

    /**
     * Resolve the configured microphone to a device UID to record from, or
     * undefined for the system default. When a specific device is chosen but
     * isn't currently present (e.g. a Bluetooth mic that's off/unpaired), warn
     * with an auto-dismissing notice and fall back to the default so the
     * recording still starts. A failed enumeration (empty) isn't treated as
     * "gone": the selection is passed through and the helper falls back + warns
     * if the device really is missing.
     */
    private async resolveInputDeviceUid(
        binaryPath: string
    ): Promise<string | undefined> {
        const uid = this.settings.micDeviceUid;
        if (!uid) return undefined;
        // Short timeout: this runs on the critical path to starting a recording,
        // so a wedged helper must not stall the meeting. Enumeration is a quick
        // local CoreAudio query in practice.
        const devices = await listInputDevices(binaryPath, 2000);
        if (devices.length === 0) return uid;
        if (devices.some((d) => d.uid === uid)) return uid;
        const label = this.settings.micDeviceLabel || uid;
        new Notice(t().notices.micUnavailable(label), 6000);
        return undefined;
    }

    private openMeetingLink(url: string): void {
        if (url.startsWith("https://")) window.open(url, "_blank");
    }

    private async copyMeetingLink(url: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(url);
            new Notice(t().agenda.notices.linkCopied);
        } catch (e) {
            // Clipboard can be unavailable (permissions / non-secure context);
            // fall back to opening the link rather than failing silently.
            console.warn("[Meeting Copilot] clipboard write failed", e);
            this.openMeetingLink(url);
        }
    }

    private openPluginSettings(): void {
        const setting = (
            this.app as unknown as {
                setting?: {
                    open: () => void;
                    openTabById: (id: string) => void;
                };
            }
        ).setting;
        if (setting) {
            setting.open();
            setting.openTabById(this.manifest.id);
        }
    }

    // MARK: - Status handling

    private handleStatus(status: RecorderStatus) {
        if (status.status === "stopped") {
            if (status.file) {
                this.clearDurationTimer();
                this.updateRibbonIcon(false);
                this.hideStatusBar();

                const fileName = path.basename(status.file);
                // Meeting recordings are linked into their own note; ad-hoc ones
                // go to the active note as before.
                void this.attachRecording(fileName);
                new Notice(t().notices.recordingSaved);
            } else {
                // Stopped without a reported file (e.g. a clean helper exit with
                // no terminal payload); reset so the UI doesn't stay stuck.
                // Skip while a prior attach is still in flight — its finally owns
                // teardown and releasing back-to-back waiters (see onError).
                if (!this.attaching) this.resetRecordingUi();
            }
        } else if (status.status === "error") {
            // Don't tear down mid-attach (would early-release a back-to-back
            // waiter and race shared state); attachRecording's finally handles it.
            if (!this.attaching) this.resetRecordingUi();
            this.notifyRecordingError(status.message ?? t().notices.unknownError);
        } else if (status.status === "warning") {
            // Non-fatal: a capture path hit trouble (usually a device-change
            // restart that didn't take). Recording continues, but tell the user
            // so a silent stream isn't discovered only at stop. Coalesce so a
            // flapping device can't spam identical Notices.
            const msg = status.message;
            const now = Date.now();
            if (
                msg &&
                (msg !== this.lastWarningMessage ||
                    now - this.lastWarningAt > 30_000)
            ) {
                this.lastWarningMessage = msg;
                this.lastWarningAt = now;
                new Notice(msg);
            }
        } else if (status.status === "recording") {
            // Live silence signal for checkSilenceAutoStop, read on the next
            // duration-timer tick. The helper heartbeats roughly every 0.5s,
            // well under the minutes-scale threshold this feeds.
            if (typeof status.silentSeconds === "number") {
                this.lastSilentSeconds = status.silentSeconds;
            }
        }
    }

    /**
     * Shows a recording error. A "screen capture not authorized" failure is
     * common after a rename/update (macOS ties the Screen Recording grant to the
     * helper's identity/path), so surface clear, actionable instructions for it.
     */
    private notifyRecordingError(message: string): void {
        if (/screen[\s-]?(capture|recording)/i.test(message)) {
            new Notice(t().notices.screenPermission, 15000);
            // Take the user straight to the pane they need to toggle instead of
            // making them hunt through System Settings.
            this.openScreenRecordingSettings();
        } else {
            new Notice(t().notices.recordingError(message));
        }
    }

    /** Whether we've already opened the Screen Recording pane this session, so a retry loop doesn't reopen System Settings repeatedly. */
    private screenSettingsOpened = false;

    /**
     * Opens macOS System Settings directly at Privacy & Security → Screen
     * Recording so the user can grant Obsidian access. Best-effort and
     * macOS-only; opened at most once per session. macOS can't be made to grant
     * the permission programmatically (and won't re-show the initial prompt once
     * the grant is stale after a rename), so surfacing the exact pane is the
     * most we can automate.
     */
    private openScreenRecordingSettings(): void {
        if (!Platform.isMacOS || this.screenSettingsOpened) return;
        this.screenSettingsOpened = true;
        execFile(
            "open",
            [
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            ],
            (err) => {
                if (err) console.warn("Failed to open Screen Recording settings", err);
            }
        );
    }

    // MARK: - UI helpers

    private startDurationTimer() {
        // Drop any leftover action-status spinner/styling before the timer owns the bar.
        this.clearActionStatus();
        if (this.statusBarEl) {
            this.statusBarEl.removeClass("system-recording-hidden");
            // Persistent structure: the timer text, plus a small badge that
            // appears only while background transcriptions are in flight. Kept
            // stable (updated in place) so the bar width doesn't jump.
            this.statusBarEl.empty();
            this.recTimeEl = this.statusBarEl.createSpan({ cls: "mc-rec-time" });
            this.recQueueEl = this.statusBarEl.createSpan({
                cls: "mc-rec-queue",
            });
        }
        this.lastDurationTickAt = Date.now();

        this.durationInterval = window.setInterval(() => {
            // A big real-time jump between 1 s ticks means the machine slept. If a
            // calendar recording's meeting is long over (its end + grace has
            // passed), the scheduler may have dropped the event while asleep, so
            // handle it here as a safety net rather than record indefinitely:
            // auto-stop when the user opted in, otherwise just offer to stop
            // (a recording never stops on its own without that opt-in).
            const now = Date.now();
            if (
                this.lastDurationTickAt !== null &&
                now - this.lastDurationTickAt > GRACE_MS &&
                this.currentRecordingEventEnd !== null &&
                now > this.currentRecordingEventEnd + GRACE_MS &&
                this.recorder.isRecording
            ) {
                this.lastDurationTickAt = now;
                const title =
                    this.currentMeetingNote?.basename ?? t().adhoc.defaultTitle;
                if (this.settings.calendarAutoStop) {
                    new Notice(t().event.autoStopped(title));
                    this.stopRecording({ notice: false });
                    return;
                }
                this.promptStopRecording(
                    t().event.ended(title),
                    t().event.stopRecordingPrompt
                );
                return;
            }
            this.lastDurationTickAt = now;

            if (!this.recordingStartTime || !this.statusBarEl) return;
            const elapsed = Math.floor(
                (now - this.recordingStartTime) / 1000
            );
            this.checkMaxRecordingLength(elapsed);
            if (!this.recorder.isRecording) return;
            this.checkSilenceAutoStop();
            if (!this.recorder.isRecording) return;
            const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
            const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
            const s = String(elapsed % 60).padStart(2, "0");
            this.recTimeEl?.setText(t().statusBar.recording(`${h}:${m}:${s}`));

            // The timer always stays put; a small badge just notes how many
            // transcriptions are in flight so switching text never resizes the
            // bar. Count waiting even during the brief gap where one job has
            // finished and the next hasn't started (running momentarily null),
            // so the badge doesn't flicker to empty between jobs.
            const snapshot = this.taskQueue.snapshot();
            const count =
                snapshot.waiting.length + (snapshot.running ? 1 : 0);
            this.recQueueEl?.setText(
                count > 0 ? t().statusBar.transcribingCount(count) : ""
            );
            if (this.statusHovered && count > 0) {
                this.showQueuePopover(snapshot);
            }
        }, 1000);

        this.registerInterval(this.durationInterval);
    }

    private clearDurationTimer() {
        if (this.durationInterval !== null) {
            window.clearInterval(this.durationInterval);
            this.durationInterval = null;
        }
        this.lastDurationTickAt = null;
    }

    /** Returns all recording UI/state to idle after a stop or failure. */
    private resetRecordingUi() {
        this.clearDurationTimer();
        this.updateRibbonIcon(false);
        this.currentRecordingPath = null;
        this.hideStatusBar();
        this.currentMeetingNotePath = null;
        this.currentMeetingNote = null;
        this.currentRecordingEventId = null;
        this.currentRecordingEventEnd = null;
        // Recording has ended, so any "meeting ended — stop recording?" prompt or
        // max-length/silence warning is moot; drop them.
        this.dismissStopPrompt();
        this.dismissMaxRecordingWarning();
        this.dismissSilenceWarning();
        this.agendaEvents.emit("changed", undefined);
        // A stop that ends without going through attachRecording (no file, or an
        // error) must still release any back-to-back waiter.
        this.resolveStopWaiters();
    }

    /** Clears any action-status timeout, styling, and DOM (shared teardown). */
    private clearActionStatus() {
        if (this.statusTimeout !== null) {
            window.clearTimeout(this.statusTimeout);
            this.statusTimeout = null;
        }
        if (this.statusBarEl) {
            this.statusBarEl.removeClasses([
                "mc-status-busy",
                "mc-status-success",
                "mc-status-error",
            ]);
            this.statusBarEl.empty();
        }
        // The recording spans live inside the bar we just emptied.
        this.recTimeEl = null;
        this.recQueueEl = null;
    }

    private hideStatusBar() {
        this.clearActionStatus();
        // Hiding the bar (display:none) may not fire mouseleave, so drop the
        // hover flag ourselves — otherwise a later tick could re-open the
        // popover without the pointer actually being over the (re-shown) bar.
        this.statusHovered = false;
        this.hideQueuePopover();
        if (this.statusBarEl) {
            this.statusBarEl.addClass("system-recording-hidden");
        }
    }

    /** True while a *transcription* task is the running one (it owns the status bar's progress line). */
    private get transcriptionRunning(): boolean {
        return this.taskQueue.snapshot().running?.kind === "transcribe";
    }

    /**
     * Enrichment/title status writes yield the status bar to a running
     * transcription task. The queue runs one task at a time, so an enrichment is
     * only ever the running task when no transcription is — this keeps the bar
     * single-owner: a transcription's progress wins; enrichment shows its own
     * state otherwise.
     */
    private setEnrichStatus(
        text: string,
        state: "busy" | "success" | "error"
    ): void {
        if (this.transcriptionRunning) return;
        this.setActionStatus(text, state);
    }

    /**
     * Shows a transient action state (enriching, transcribing, …) in the status
     * bar. `state` "busy" shows a spinner; "success"/"error" auto-clear after a
     * few seconds. Skipped while recording, whose duration display owns the bar.
     */
    private setActionStatus(
        text: string,
        state: "busy" | "success" | "error"
    ): void {
        const el = this.statusBarEl;
        if (!el) return;
        // Don't clobber the live recording timer.
        if (this.recorder.isRecording) return;

        this.clearActionStatus();
        el.removeClass("system-recording-hidden");
        el.addClass(`mc-status-${state}`);

        const icon = el.createSpan({ cls: "mc-status-icon" });
        setIcon(
            icon,
            state === "busy"
                ? "loader-2"
                : state === "success"
                ? "check"
                : "alert-triangle"
        );
        el.createSpan({ cls: "mc-status-text", text });

        // Success/error clear quickly; a busy state clears on a long safety
        // timeout so a spinner can never get stuck if a completion event is missed.
        const clearAfter =
            state === "busy" ? 15 * 60 * 1000 : state === "error" ? 6000 : 4000;
        this.statusTimeout = window.setTimeout(() => {
            this.statusTimeout = null;
            if (!this.recorder.isRecording) this.hideStatusBar();
        }, clearAfter);
    }

    private updateRibbonIcon(recording: boolean) {
        if (this.ribbonIconEl) {
            if (recording) {
                this.ribbonIconEl.addClass("is-recording");
            } else {
                this.ribbonIconEl.removeClass("is-recording");
            }
        }
    }

    /**
     * True when the recorder's speech-window sidecar (split mode's
     * `<base>.speech.json`) reports any speech. Absent sidecar (mixed mode) →
     * false: there's no independent evidence, so the empty transcript is taken at
     * face value. Guards silent-discard against transcription misses, so it errs
     * toward KEEPING the audio whenever the evidence is uncertain: a sidecar that
     * exists but is unreadable/unparsable returns true (don't discard). Reads the
     * sidecar straight off disk via the adapter (not the vault index) so a
     * just-written speech.json isn't missed to index lag — which would strip the
     * very safety net right when it matters most (immediately after a stop).
     */
    private async recordingHasSpeech(recording: TFile): Promise<boolean> {
        const speechPath = sidecarPathsFor(recording.path).speech;
        let raw: string;
        try {
            if (!(await this.app.vault.adapter.exists(speechPath))) return false;
            raw = await this.app.vault.adapter.read(speechPath);
        } catch {
            // Present but unreadable → don't treat as silence.
            return true;
        }
        const windows = parseSpeechWindows(raw);
        // Present but unparsable → err toward keeping the audio.
        if (!windows) return true;
        return windows.me.length > 0 || windows.them.length > 0;
    }

    /**
     * Moves a vault file to the trash if it exists; never throws. Resolves via
     * the adapter (+ retry) rather than the vault index so a just-written file
     * the index hasn't caught up to (the .me/.them/.speech sidecars right after a
     * stop) is still found and removed instead of orphaned. Returns true when the
     * path is gone afterward (absent to begin with, or trashed), false only when
     * the file exists but trashing failed — so callers can avoid unlinking a
     * recording whose audio is still on disk.
     */
    private async trashIfExists(vaultPath: string): Promise<boolean> {
        // Check the disk directly (bypassing the vault index) so a genuinely
        // absent path returns fast and a just-written file is still found.
        if (!(await this.app.vault.adapter.exists(vaultPath))) return true;
        const f = await this.resolveFileWithRetry(vaultPath);
        if (!f) {
            // On disk but never resolved to a TFile (index lag exhausted): we
            // can't trash it via the file manager, and claiming success would
            // orphan it — report failure so the caller keeps the link.
            console.warn(
                `[Meeting Copilot] could not resolve ${vaultPath} to trash it`
            );
            return false;
        }
        try {
            await this.app.fileManager.trashFile(f);
            return true;
        } catch (e) {
            console.warn(`[Meeting Copilot] failed to trash ${vaultPath}`, e);
            return false;
        }
    }

    /**
     * Discards a just-stopped recording that came back silent (no speech in its
     * transcript): trashes the audio + its split sidecars and removes the
     * recording's link from its owning meeting note, so the meeting immediately
     * re-offers "record". When that was the note's only recording and no
     * transcript was ever saved, the note falls back to "scheduled" so it
     * doesn't read as recorded. The owning note is resolved *before* trashing
     * (the link resolves only while the file still exists). Best-effort.
     */
    private async discardSilentRecording(recording: TFile): Promise<void> {
        const note = findMeetingNoteForAudio(this.app, recording);
        const prunedPath = recording.path;
        const sc = sidecarPathsFor(recording.path);
        // Trash the audio first; only unlink it from the note once it's actually
        // gone. Unlinking a still-present recording would orphan it — on disk but
        // owned by no note, so the retention sweep would never reclaim it.
        if (!(await this.trashIfExists(recording.path))) {
            console.warn(
                `[Meeting Copilot][recorder] could not discard silent recording "${recording.name}" (trash failed); left linked`
            );
            return;
        }
        await this.trashIfExists(sc.me);
        await this.trashIfExists(sc.them);
        await this.trashIfExists(sc.speech);
        if (note) {
            await this.app.fileManager.processFrontMatter(note, (fm) => {
                const f = fm as Record<string, unknown>;
                const next = dropRecordingLink(f.recording, prunedPath);
                const hasTranscript = f.transcript_saved === true;
                if (next === undefined) {
                    // No recordings left: back to "scheduled" unless an earlier
                    // transcript is still in the note (then it's "transcribed").
                    delete f.recording;
                    f.status = hasTranscript ? "transcribed" : "scheduled";
                } else {
                    // Other take(s) remain — `linkRecording` had regressed status
                    // to "recorded" for this now-discarded take; reflect whether
                    // the survivors are already transcribed.
                    f.recording = next;
                    f.status = hasTranscript ? "transcribed" : "recorded";
                }
            });
        }
        mcLog("recorder", "discarded silent recording", {
            recording: recording.name,
            note: note?.path ?? null,
        });
        new Notice(t().notices.silentDiscarded);
        this.agendaEvents.emit("changed", undefined);
    }

    /**
     * Inserts a finished transcription into its meeting note and refreshes the
     * agenda. Returns the owning note (when found) and the fresh transcript, so
     * the caller can enrich *after* the transcription queue slot is released
     * (enrichment no longer runs from inside this method — see launchTranscriber).
     */
    private async handleTranscriptionCompleted(
        payload: unknown,
        append = false
    ): Promise<{ note: TFile | null; transcript: string | null }> {
        let enrichTarget: TFile | null = null;
        let transcriptText: string | null = null;
        let inserted = false;
        try {
            const p = (payload ?? {}) as {
                audioFile?: unknown;
                transcription?: unknown;
                file?: unknown;
            };
            const audio = p.audioFile;
            const raw =
                typeof p.transcription === "string" ? p.transcription : null;
            const transcript = raw && raw.trim().length > 0 ? raw : null;
            if (audio instanceof TFile && transcript) {
                transcriptText = transcript;
                const note = findMeetingNoteForAudio(this.app, audio);
                console.warn(
                    `[Meeting Copilot][transcribe] note match for "${audio.name}": ${
                        note ? note.path : "none"
                    } (insertTranscript=${this.settings.insertTranscript})`
                );
                // Skip if the transcriber already wrote into the meeting note.
                const already =
                    p.file instanceof TFile &&
                    note !== null &&
                    p.file.path === note.path;
                if (note) {
                    // Record the note first so a failed insert still reports
                    // "note found" (not the misleading "no meeting note" notice).
                    enrichTarget = note;
                    if (this.settings.insertTranscript && !already) {
                        await insertTranscript(this.app, note, transcript, {
                            append,
                        });
                        new Notice(t().notices.transcriptAdded(note.basename));
                        inserted = true;
                        // Hand the caller the FULL callout (all takes) to enrich,
                        // not just this take — otherwise a second take's summary
                        // would ignore the first. On the replace path this equals
                        // the take just written; on append it's the combined
                        // chronological transcript.
                        const combined = extractTranscript(
                            await this.app.vault.read(note)
                        );
                        if (combined.trim().length > 0) transcriptText = combined;
                    }
                }
            }
        } catch (e) {
            console.warn("Meeting Copilot: failed to insert transcript", e);
        }
        this.agendaEvents.emit("changed", undefined);
        this.refreshNoteIssuesBlocks();

        // Resolve the "Transcribing…" spinner deterministically here, before
        // enrichment runs: success only if we actually inserted, otherwise
        // clear it (never touching the recording timer). Enrichment then manages
        // its own status when it proceeds, and if it bails early the transcription
        // status is already settled, so the spinner can't linger.
        if (inserted) {
            this.setActionStatus(t().statusBar.transcriptAdded, "success");
        } else if (!this.recorder.isRecording) {
            this.hideStatusBar();
        }
        return { note: enrichTarget, transcript: transcriptText };
    }

    /** Enriches the active markdown note, if it is one. */
    private async enrichActiveNote(): Promise<void> {
        const file = this.app.workspace.getActiveFile();
        if (!(file instanceof TFile) || file.extension !== "md") {
            new Notice(t().notices.notAMeetingNote);
            return;
        }
        await this.enqueueEnrich(file);
    }

    /** The task-queue id for enriching a note; namespaced so it can't collide with a recording path. */
    private enrichTaskId(notePath: string): string {
        return `enrich:${notePath}`;
    }

    /**
     * The single entry point for "enrich this note" (issue #96). Validates the
     * enrichment config, and — when the note has no transcript yet but owns a
     * recording — transcribes first via {@link launchTranscriber} (which chains
     * the enrichment as a dependent queue task). Otherwise it enqueues the
     * enrichment directly. "Enrich" thus means "produce the enrichment", pulling
     * transcription in automatically when needed; it only reports "nothing to
     * enrich" when there's neither transcript/notes nor a recording to work from.
     */
    private async enqueueEnrich(file: TFile): Promise<void> {
        if (!this.settings.enableEnrichment) {
            new Notice(t().notices.enrichDisabled);
            return;
        }
        if (this.settings.enrichBackend === "api") {
            const { apiBaseUrl, apiKey, enrichModel } = this.settings;
            if (!apiBaseUrl || !apiKey || !enrichModel) {
                new Notice(t().notices.enrichNotConfigured);
                return;
            }
        }
        // No transcript yet but a recording exists → transcribe first, then
        // enrich as a dependent task once it lands.
        const existing = extractTranscript(await this.app.vault.read(file));
        if (!existing.trim()) {
            const recording = this.agendaMeetingFromNote(file).recording;
            if (recording) {
                if (this.taskQueue.has(recording.path)) {
                    // That recording is already transcribing (auto-transcribe or
                    // a manual run): don't kick a second one — just chain the
                    // enrichment behind it so the user's click isn't dropped.
                    void this.enqueueEnrichTask(file, {
                        dependsOn: recording.path,
                    });
                } else {
                    // launchTranscriber enqueues the dependent enrichment itself.
                    await this.launchTranscriber(recording, "auto", {
                        enrichAfter: true,
                    });
                }
                return;
            }
        }
        // A transcript exists (or there's no recording, but there may still be
        // manual notes / action items worth enriching) — enqueue it. The worker
        // surfaces "nothing to enrich" if the note is truly empty.
        void this.enqueueEnrichTask(file, {});
    }

    /**
     * Enqueues an enrichment task on the shared queue: visible in the popover,
     * per-item cancellable, and (optionally) gated behind a transcription via
     * `dependsOn`. Deduped by the note's enrich id, so a double-trigger runs
     * once. `resolveTranscript` is read when the task starts (the pipeline uses
     * it to hand over the transcript the transcription just produced); `quiet`
     * suppresses the "nothing to enrich" notice for automatic runs.
     */
    private enqueueEnrichTask(
        note: TFile,
        opts: {
            dependsOn?: string;
            transcriptOverride?: string;
            resolveTranscript?: () => string | undefined;
            quiet?: boolean;
        }
    ): Promise<void> {
        const id = this.enrichTaskId(note.path);
        // A manual re-trigger while an enrich for this note is already queued or
        // running: say so (a dependent pipeline task never shows this).
        if (opts.dependsOn === undefined && this.taskQueue.has(id)) {
            new Notice(t().notices.enrichInProgress);
        }
        const promise = this.taskQueue.enqueue({
            id,
            label: this.meetingNoteLabel(note),
            kind: "enrich",
            dependsOn: opts.dependsOn,
            run: async (signal) => {
                const transcript =
                    opts.transcriptOverride ?? opts.resolveTranscript?.();
                await this.runEnrich(note, transcript, signal, opts.quiet ?? false);
            },
        });
        // Cancellation is expected/quiet; log only unexpected failures (runEnrich
        // surfaces its own error notice, so this is a last-resort net).
        promise.catch((e) => {
            if (!(e instanceof TaskCancelledError)) {
                mcLog("enrich", "queue fail", {
                    note: note.path,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        });
        return promise;
    }

    /**
     * Generates AI notes from the note's manual notes + transcript and inserts a
     * gray callout — the worker run by an enrichment queue task. Honors `signal`
     * (a cancel rejects promptly and skips the write) and, when `quiet`, stays
     * silent if there's nothing to enrich (an automatic pipeline run).
     */
    private async runEnrich(
        file: TFile,
        transcriptOverride: string | undefined,
        signal: AbortSignal,
        quiet: boolean
    ): Promise<void> {
        const { apiBaseUrl, apiKey, enrichModel } = this.settings;
        // Config can change between enqueue and run; re-check and bail quietly.
        if (!this.settings.enableEnrichment) return;
        if (this.settings.enrichBackend === "api" && (!apiBaseUrl || !apiKey || !enrichModel)) {
            return;
        }
        let enrichedOk = false;
        // Captured inside the try once frontmatter is read; used after a successful
        // enrich so we don't re-query a lagging metadataCache for the title gate.
        let eventIdForTitle: unknown;
        let alreadySuggestedForTitle: unknown;
        /** Title embedded in the enrich response (same LLM call); offered after write. */
        let embeddedTitle: string | null = null;
        let enrichStarted = Date.now();
        try {
            const content = await this.app.vault.read(file);
            // Gather manual notes wherever they were written (incl. above the
            // "## Notes" heading), not just the section body.
            const notes = normalizeManualNotes(content).notes;
            // The participant's own, hand-written action items. Feeding them to
            // the model lets it produce ONE unified list that honors/improves
            // each one, so the drop-and-replace merge below can't silently lose
            // an item the model would otherwise never have re-derived.
            const manualActionItems = extractManualActionItems(
                extractSection(content, ACTION_ITEMS_HEADING)
            ).map(stripTaskMeta);
            const manualFollowUps = extractManualActionItems(
                extractSection(content, FOLLOW_UPS_HEADING)
            ).map(stripTaskMeta);
            const transcript =
                transcriptOverride && transcriptOverride.trim().length > 0
                    ? transcriptOverride
                    : extractTranscript(content);
            // Hand-written action items / follow-ups are enrichment input too,
            // so a note that only has those lists (no notes/transcript) is
            // still worth enriching — the model can tidy/unify those items.
            if (
                !notes &&
                !transcript &&
                manualActionItems.length === 0 &&
                manualFollowUps.length === 0
            ) {
                if (!quiet) new Notice(t().notices.nothingToEnrich);
                return;
            }

            const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ??
                {}) as Record<string, unknown>;
            // Capture identity flags *before* we write — a post-write metadataCache
            // lookup can lag and skip the ad-hoc title offer (issue #110).
            eventIdForTitle = fm["event_id"];
            alreadySuggestedForTitle = fm["mc_title_suggested"];
            const wantTitle = shouldSuggestAdhocTitle({
                suggestAdhocTitle: this.settings.suggestAdhocTitle,
                eventId: eventIdForTitle,
                alreadySuggested: alreadySuggestedForTitle,
            });
            const attendeesVal = fm["attendees"];
            const titleVal = fm["title"];
            const dateVal = fm["date"];
            const ctx = {
                title: typeof titleVal === "string" ? titleVal : file.basename,
                date: typeof dateVal === "string" ? dateVal : "",
                attendees: Array.isArray(attendeesVal)
                    ? attendeesVal.map((x) => String(x)).join(", ")
                    : "",
                notes,
                actionItems: manualActionItems.map((i) => `- ${i}`).join("\n"),
                followUps: manualFollowUps.map((i) => `- ${i}`).join("\n"),
                transcript,
            };

            // fillPrompt() truncates the transcript internally when it exceeds
            // the budget; computed again here (cheap, pure) purely to know
            // *whether* that happened, so we can warn instead of silently
            // shipping a summary that may have skipped whole agenda topics.
            const transcriptTruncated = truncateTranscriptForBudget(
                transcript,
                this.settings.enrichMaxTranscriptTokens
            ).truncated;

            new Notice(t().notices.enriching);
            this.setEnrichStatus(t().statusBar.enriching, "busy");
            // Ask for an ad-hoc title in the *same* enrich call (trailer parsed
            // below) — no second LLM round-trip over the transcript.
            const userPrompt =
                fillPrompt(
                    effectiveEnrichPrompt(
                        this.settings.enrichPromptCustomize,
                        this.settings.enrichPrompt
                    ),
                    ctx,
                    {
                        maxTranscriptTokens:
                            this.settings.enrichMaxTranscriptTokens,
                    }
                ) + (wantTitle ? ADHOC_TITLE_PROMPT_SUFFIX : "");
            const timeoutMs = Math.min(
                600_000,
                Math.max(60_000, (this.settings.enrichTimeoutSeconds || 120) * 1000)
            );
            enrichStarted = Date.now();
            mcLog("enrich", "begin", {
                note: file.basename,
                model: enrichModel,
                promptChars: userPrompt.length,
                transcriptChars: (transcript ?? "").length,
                timeoutMs,
            });
            const runEnrichChat = async (
                baseUrl: string,
                key: string,
                model: string
            ): Promise<string> => {
                // Dispatch to the CLI backend; CLI backends don't use the endpoint
                // args but the signature is kept consistent for the fallback logic below.
                if (this.settings.enrichBackend !== "api") {
                    const backend = this.settings.enrichBackend;
                    const cliModel = this.settings.enrichCliModels[backend] || undefined;
                    return cliChatComplete({
                        cli: backend,
                        cliPath: this.settings.enrichCliPaths[backend] || undefined,
                        model: cliModel,
                        system: ENRICH_SYSTEM_PROMPT,
                        user: userPrompt,
                        signal,
                        timeoutMs,
                    });
                }
                let attempt = 0;
                for (;;) {
                    try {
                        return await chatComplete({
                            baseUrl,
                            apiKey: key,
                            model,
                            system: ENRICH_SYSTEM_PROMPT,
                            user: userPrompt,
                            signal,
                            timeoutMs,
                        });
                    } catch (e) {
                        if (
                            e instanceof EnrichTimeoutError &&
                            attempt === 0 &&
                            !signal.aborted
                        ) {
                            attempt = 1;
                            mcLog("enrich", "timeout retry", {
                                note: file.basename,
                                model,
                                timeoutMs,
                            });
                            continue;
                        }
                        throw e;
                    }
                }
            };
            let rawOutput: string;
            let usedModel = enrichModel;
            try {
                rawOutput = await runEnrichChat(
                    apiBaseUrl,
                    apiKey,
                    enrichModel
                );
            } catch (e) {
                // CLI backends don't support fallback endpoints; re-throw immediately
                if (this.settings.enrichBackend !== "api") {
                    throw e;
                }
                const fb = fallbackEndpoint(this.settings);
                if (
                    !fb ||
                    !isServiceFailure(e) ||
                    signal.aborted ||
                    this.isEnrichCancelled(e, signal)
                ) {
                    throw e;
                }
                mcLog("enrich", "primary→fallback endpoint", {
                    note: file.basename,
                    primaryModel: enrichModel,
                    fallbackModel: fb.enrichModel,
                    error: e instanceof Error ? e.message : String(e),
                });
                new Notice(t().notices.endpointFallbackEnrich);
                usedModel = fb.enrichModel;
                rawOutput = await runEnrichChat(
                    fb.baseUrl,
                    fb.apiKey,
                    fb.enrichModel
                );
            }
            // Only parse/strip a title trailer when we asked for one — calendar
            // enrichments must never feed RenameModal (scheduled titles stay).
            const extracted = wantTitle
                ? extractEmbeddedTitle(rawOutput)
                : { body: rawOutput, title: null };
            // Deterministic, never LLM-generated: the model can't reliably
            // self-report a mid-transcript truncation it may not even notice,
            // so this has to come from the plugin to be trustworthy.
            const output = transcriptTruncated
                ? `${t().transcript.truncatedWarning(this.settings.enrichMaxTranscriptTokens)}\n\n${extracted.body}`
                : extracted.body;
            if (wantTitle) {
                const cleaned = extracted.title
                    ? cleanSuggestedTitle(extracted.title)
                    : "";
                // sanitizeName maps blank → "Untitled"; don't offer that.
                if (cleaned && cleaned !== "Untitled") {
                    embeddedTitle = cleaned;
                } else {
                    mcLog("enrich", "title suggestion skipped", {
                        note: file.basename,
                        reason: "missing title trailer",
                    });
                }
            }
            // Atomic RMW against the live note so concurrent keystrokes during
            // the LLM call aren't clobbered (#19). Bail if cancelled after the
            // LLM returned so we don't write a discarded enrich.
            if (signal.aborted) throw new ChatAbortError();
            const vault = this.app.vault as typeof this.app.vault & {
                process?: (
                    f: TFile,
                    fn: (data: string) => string
                ) => Promise<string>;
            };
            const apply = (current: string) =>
                applyEnrichToContent(current, {
                    calloutBody: output,
                    actionItemsAsTasks: this.settings.actionItemsAsTasks,
                    todayStamp: this.todayStamp(),
                    extractActionItems,
                    extractFollowUps,
                });
            if (typeof vault.process === "function") {
                await vault.process(file, apply);
            } else {
                const current = await this.app.vault.read(file);
                await this.app.vault.modify(file, apply(current));
            }
            await this.app.fileManager.processFrontMatter(file, (f) => {
                const fm = f as Record<string, unknown>;
                fm.status = "enriched";
                // Always written (true or false) so a later re-enrich that no
                // longer truncates — e.g. after raising the token budget —
                // self-heals the flag instead of leaving a stale warning.
                fm.enrich_transcript_truncated = transcriptTruncated;
            });
            const elapsedMs = Date.now() - enrichStarted;
            mcLog("enrich", "ok", {
                note: file.basename,
                model: usedModel,
                elapsedMs,
                transcriptTruncated,
            });
            new Notice(t().notices.enrichDone(file.basename));
            this.setEnrichStatus(t().statusBar.enriched, "success");
            this.agendaEvents.emit("changed", undefined);
            this.refreshNoteIssuesBlocks();
            enrichedOk = true;
        } catch (e) {
            // A cancel (via signal) is expected: stay quiet and rethrow as the
            // queue's cancellation type so it rejects (and drops any dependents)
            // rather than logging a failure or writing a partial note.
            if (this.isEnrichCancelled(e, signal)) {
                if (!this.transcriptionRunning) this.clearActionStatus();
                throw new TaskCancelledError();
            }
            const elapsedMs = Date.now() - enrichStarted;
            if (e instanceof EnrichTimeoutError) {
                const secs = Math.round(e.timeoutMs / 1000);
                mcLog("enrich", "fail", {
                    note: file.basename,
                    outcome: "timeout",
                    timeoutMs: e.timeoutMs,
                    elapsedMs,
                });
                new Notice(t().notices.enrichTimeout(file.basename, secs));
            } else if (e instanceof CLINotFoundError) {
                mcLog("enrich", "fail", {
                    note: file.basename,
                    outcome: "cli-not-found",
                    error: e.message,
                    elapsedMs,
                });
                {
                    const backendOpts = t().settings.enrichBackend.options;
                    const backendKey = this.settings.enrichBackend as keyof typeof backendOpts;
                    new Notice(
                        t().notices.enrichCliNotFound(backendOpts[backendKey] ?? this.settings.enrichBackend)
                    );
                }
            } else {
                mcLog("enrich", "fail", {
                    note: file.basename,
                    outcome: "error",
                    error: e instanceof Error ? e.message : String(e),
                    elapsedMs,
                });
                new Notice(
                    t().notices.enrichError(
                        e instanceof Error ? e.message : String(e)
                    )
                );
            }
            this.setEnrichStatus(t().statusBar.enrichFailed, "error");
            // Reject the queue task (its own catch just logs) so a failed enrich
            // isn't recorded as a success — and skips the title-suggestion step.
            throw e;
        }

        // After the AI summary, offer the title that came back in the same enrich
        // response (once). Only ad-hoc notes request a trailer / reach here with
        // a title; scheduled meetings keep their calendar title.
        if (
            enrichedOk &&
            embeddedTitle &&
            shouldSuggestAdhocTitle({
                suggestAdhocTitle: this.settings.suggestAdhocTitle,
                eventId: eventIdForTitle,
                alreadySuggested: alreadySuggestedForTitle,
            })
        ) {
            await this.offerAdhocTitle(file, embeddedTitle);
        }
    }

    /** Whether an error from an enrichment LLM call is a user cancellation (queue abort). */
    private isEnrichCancelled(error: unknown, signal: AbortSignal): boolean {
        return signal.aborted || error instanceof ChatAbortError || error instanceof CLIAbortError;
    }

    /**
     * Offers to rename an ad-hoc note to a title already produced by enrich.
     * No LLM call — the title was embedded in the enrich response.
     */
    private async offerAdhocTitle(file: TFile, title: string): Promise<void> {
        if (this.titleSuggestingPaths.has(file.path)) {
            console.warn(
                "[Meeting Copilot] title suggestion skipped: already in flight",
                file.path
            );
            return;
        }
        this.titleSuggestingPaths.add(file.path);
        try {
            const prefix = this.datePrefixOf(file);
            const suggested = prefix ? `${prefix} ${title}` : title;
            // Flag only on Rename/Keep — Esc/click-away leaves room to re-offer
            // on a later enrich (issue #110).
            new RenameModal(this.app, {
                heading: t().adhoc.titleModal.heading,
                desc: t().adhoc.titleModal.desc,
                value: suggested,
                renameLabel: t().adhoc.titleModal.rename,
                keepLabel: t().adhoc.titleModal.keep,
                onRename: (value) => {
                    void this.renameMeetingNote(file, value, prefix);
                },
                onDecide: () => {
                    void this.app.fileManager.processFrontMatter(file, (f) => {
                        (f as Record<string, unknown>).mc_title_suggested = true;
                    });
                },
            }).open();
        } catch (e) {
            console.warn("[Meeting Copilot] title suggestion failed", e);
        } finally {
            this.titleSuggestingPaths.delete(file.path);
        }
    }

    /** The leading `YYYY-MM-DD [HHmm]` portion of a note's basename, or from frontmatter. */
    private datePrefixOf(file: TFile): string {
        const m = file.basename.match(/^(\d{4}-\d{2}-\d{2}(?:\s+\d{3,4})?)/);
        if (m?.[1]) return m[1];
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
            | Record<string, unknown>
            | undefined;
        // Prefer `start` (YYYY-MM-DDTHH:MM:SS) so we keep the time component.
        const start = fm?.["start"];
        if (typeof start === "string") {
            const sm = start.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
            if (sm) return `${sm[1]} ${sm[2]}${sm[3]}`;
        }
        const date = fm?.["date"];
        return typeof date === "string" ? date : "";
    }

    /**
     * Renames the note file and syncs the H1 + frontmatter title. The new name
     * is expected to already include the date prefix; `titlePrefix` is stripped
     * to derive the human title for the H1/frontmatter.
     */
    private async renameMeetingNote(
        file: TFile,
        newBasename: string,
        titlePrefix: string
    ): Promise<void> {
        try {
            const safeBase = sanitizeName(newBasename);
            const folder = folderOf(file);
            const pathFor = (base: string): string =>
                normalizePath(folder ? `${folder}/${base}.md` : `${base}.md`);
            // Avoid clobbering an existing note (try " 2", " 3", …).
            let target = pathFor(safeBase);
            for (
                let n = 2;
                target !== file.path &&
                this.app.vault.getAbstractFileByPath(target) &&
                n < 1000;
                n++
            ) {
                target = pathFor(`${safeBase} ${n}`);
            }
            const humanTitle =
                titlePrefix && safeBase.startsWith(titlePrefix)
                    ? safeBase.slice(titlePrefix.length).trim() || safeBase
                    : safeBase;

            if (target !== file.path) {
                await this.app.fileManager.renameFile(file, target);
            }
            const content = await this.app.vault.read(file);
            const updated = content.replace(/^#\s+.*$/m, `# ${humanTitle}`);
            if (updated !== content) await this.app.vault.modify(file, updated);
            await this.app.fileManager.processFrontMatter(file, (f) => {
                (f as Record<string, unknown>).title = humanTitle;
            });
            new Notice(t().adhoc.titleModal.renamed(humanTitle));
            this.agendaEvents.emit("changed", undefined);
        } catch (e) {
            new Notice(
                t().notices.recordingError(
                    e instanceof Error ? e.message : String(e)
                )
            );
        }
    }

    /**
     * Moves recordings older than `retentionDays` to the trash so they don't
     * grow forever. Only touches audio under the meetings/recordings folders,
     * and only when the owning meeting note actually contains the transcript —
     * so the audio is never the last copy of the content. Orphan/inline audio
     * and not-yet-transcribed notes are left untouched. `retentionDays: 0`
     * disables cleanup entirely.
     */
    private async cleanupOldRecordings(notify: boolean): Promise<number> {
        if (this.settings.retentionDays <= 0) {
            if (notify) new Notice(t().notices.retentionDisabled);
            return 0;
        }
        if (this.cleanupRunning) return 0;
        this.cleanupRunning = true;
        try {
            const files = this.app.vault.getFiles().map((f) => ({
                path: f.path,
                ext: f.extension,
                mtime: f.stat.mtime,
            }));
            // Scope retention to the configured roots plus the recordings
            // folder, and additionally the exact audio files linked from
            // plugin-owned notes (so a recording colocated with a series/1:1
            // folder that moved elsewhere is still covered). Exact paths, not
            // the notes' parent folders: sweeping a moved note's folder would
            // make every old audio file in that unrelated subtree eligible.
            // Deliberately unfiltered by "Excluded folders": a recording
            // linked from an excluded/archived note must still count as
            // owned here, or this destructive sweep would treat it as
            // orphaned and trash it. The exclusion setting is for what the
            // plugin *shows*, not a license to delete a file it can no
            // longer see.
            const ownedRecordings = new Set<string>();
            for (const entry of scanMeetingNotes(this.app)) {
                if (!entry.eventId) continue;
                // A meeting can link more than one recording; own them all so a
                // second take is swept on the same rule as the first.
                for (const link of recordingLinkTargets(entry.recording)) {
                    const dest = this.app.metadataCache.getFirstLinkpathDest(
                        link,
                        entry.file.path
                    );
                    if (dest instanceof TFile) ownedRecordings.add(dest.path);
                }
            }
            const folders = [...new Set(this.configuredMeetingRoots())].filter(
                (f) => f.length > 0
            );
            const expired = findExpiredRecordings(files, {
                folders,
                extraPaths: ownedRecordings,
                retentionDays: this.settings.retentionDays,
                now: Date.now(),
                protectedPaths: this.currentRecordingPath
                    ? new Set([this.currentRecordingPath])
                    : undefined,
            });

            let removed = 0;
            const trash = async (p: string): Promise<boolean> => {
                const f = this.app.vault.getAbstractFileByPath(p);
                if (!(f instanceof TFile)) return false;
                try {
                    await this.app.fileManager.trashFile(f);
                    return true;
                } catch (e) {
                    console.warn(`[Meeting Copilot] failed to trash ${p}`, e);
                    return false;
                }
            };
            // Pass 1: primary recordings. The split sidecars (`.me`/`.them`/
            // `.speech.json`) have no owning note of their own, so they never
            // pass the note gate on their own — prune them together with the
            // primary recording they belong to instead (otherwise they'd leak
            // forever once the primary is gone).
            for (const info of expired) {
                if (isSidecarPath(info.path)) continue;
                const file = this.app.vault.getAbstractFileByPath(info.path);
                if (!(file instanceof TFile)) continue;
                // Resolve the meeting note that owns THIS audio — colocated
                // (same folder + basename) or linked via `recording` frontmatter.
                const note = findMeetingNoteForAudio(this.app, file);
                // Only prune when the plugin has durably saved the transcript
                // into the owning note. Skip when there's no owning note
                // (orphan/inline-embedded ad-hoc recordings, or unrelated user
                // audio) or the transcript was never captured — deleting those
                // would destroy the only copy.
                if (!note || !this.noteHasSavedTranscript(note)) continue;
                // A note carrying more than one recording keeps `transcript_saved`
                // from an earlier take even while a newer take is still pending
                // transcription (status "recorded"). Pruning then could delete
                // the newer, not-yet-captured audio — so hold off on the whole
                // note until its latest take has been transcribed.
                if (this.noteHasPendingRecording(note)) continue;
                if (await trash(info.path)) {
                    removed++;
                    // Trash the split sidecars alongside the primary recording.
                    const sc = sidecarPathsFor(info.path);
                    await trash(sc.me);
                    await trash(sc.them);
                    await trash(sc.speech);
                    // Drop just this recording's now-dangling link (a meeting
                    // may have several); the transcript stays in the note. Only
                    // stamp `recording_pruned` once the last one is gone.
                    await this.app.fileManager.processFrontMatter(note, (fm) => {
                        const f = fm as Record<string, unknown>;
                        const next = dropRecordingLink(f.recording, info.path);
                        if (next === undefined) {
                            delete f.recording;
                            f.recording_pruned = new Date()
                                .toISOString()
                                .slice(0, 10);
                        } else {
                            f.recording = next;
                        }
                    });
                }
            }
            // Pass 2: sweep expired sidecars whose primary recording is already
            // gone (orphans — e.g. from an older build that pruned the primary
            // but left the sidecars). Sidecars still sitting next to a live
            // primary are left alone; pass 1 owns those.
            for (const info of expired) {
                const candidates = baseRecordingCandidatesOf(info.path);
                if (candidates.length === 0) continue;
                const primaryAlive = candidates.some(
                    (base) =>
                        this.app.vault.getAbstractFileByPath(base) instanceof
                        TFile
                );
                if (primaryAlive) continue;
                // A primary recording whose own basename happens to end in
                // `.me`/`.them` matches the sidecar naming, so it lands here
                // instead of pass 1's transcript-saved gate. Never sweep a
                // file a meeting note claims as its recording.
                const file = this.app.vault.getAbstractFileByPath(info.path);
                if (
                    file instanceof TFile &&
                    findMeetingNoteForAudio(this.app, file)
                ) {
                    continue;
                }
                if (await trash(info.path)) removed++;
            }

            if (removed > 0) {
                new Notice(t().notices.retentionCleaned(removed));
                this.agendaEvents.emit("changed", undefined);
            } else if (notify) {
                new Notice(t().notices.retentionNothing);
            }
            return removed;
        } finally {
            this.cleanupRunning = false;
        }
    }

    /**
     * True only when this plugin has durably written the transcript into the
     * note — the `transcript_saved` flag stamped by `insertTranscript`.
     * Retention keys on this managed flag rather than sniffing the body: a
     * customized note template can carry a `## Transcript`/callout placeholder
     * that looks like a real transcript, and trusting that would trash the only
     * copy of the audio (issue #46). With "Insert transcript" off the flag is
     * never set, so that note's audio is kept. Legacy notes transcribed before
     * this flag existed also lack it, so their audio is kept (safe) rather than
     * pruned. Reads frontmatter from the metadata cache; if it's unavailable we
     * treat the transcript as unsaved and keep the audio.
     */
    private noteHasSavedTranscript(note: TFile): boolean {
        const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;
        return fm?.transcript_saved === true;
    }

    /**
     * True when the note has a recording awaiting transcription — its `status`
     * is "recorded" (the state `linkRecording` stamps on every stop, cleared to
     * "transcribed" by `insertTranscript`). Used to hold retention off a
     * multi-take note whose newest take isn't captured yet, even though an
     * earlier take already set `transcript_saved`.
     */
    private noteHasPendingRecording(note: TFile): boolean {
        const fm = this.app.metadataCache.getFileCache(note)?.frontmatter;
        return fm?.status === "recorded";
    }

    /** Flips the vault-wide "hide AI notes" toggle and persists it. */
    private async toggleAiNotes(): Promise<void> {
        this.settings.hideAiNotes = !this.settings.hideAiNotes;
        document.body.toggleClass(HIDE_AI_CLASS, this.settings.hideAiNotes);
        await this.saveSettings();
        new Notice(
            this.settings.hideAiNotes
                ? t().notices.aiNotesHidden
                : t().notices.aiNotesShown
        );
    }

    private async attachRecording(fileName: string) {
        this.attaching = true;
        // Prefer the live TFile (survives a rename during recording); fall back
        // to the path captured at start.
        const noteRef = this.currentMeetingNote;
        const notePath = noteRef?.path ?? this.currentMeetingNotePath;
        // Captured before the block below nulls it: the recorder wrote the WAV
        // to wherever recording *started*, which is no longer the note's folder
        // if the note was moved mid-recording. Deriving the link from the
        // note's current path in that case would point at a path the file was
        // never written to, breaking auto-transcribe.
        const recordingPath = this.currentRecordingPath;
        this.currentMeetingNotePath = null;
        this.currentMeetingNote = null;
        this.currentRecordingEventId = null;
        this.currentRecordingEventEnd = null;
        this.currentRecordingPath = null;
        this.agendaEvents.emit("changed", undefined);
        try {
        if (notePath) {
            const file =
                noteRef ?? this.app.vault.getAbstractFileByPath(notePath);
            if (file instanceof TFile) {
                // Qualify the link with the folder the recording actually lives
                // in (see `recordingPath` above), so duplicate basenames
                // elsewhere can't resolve to the wrong file.
                const dirOf = (p: string): string => {
                    const slash = p.lastIndexOf("/");
                    return slash >= 0 ? p.slice(0, slash) : "";
                };
                const folder = dirOf(recordingPath ?? notePath);
                // Normalize so this key matches the recording's TFile.path (which
                // uniqueRecordingPath already normalized) — the pendingAutoTranscribe
                // lookup and the index poll both key on it.
                const link = normalizePath(
                    folder ? `${folder}/${fileName}` : fileName
                );
                try {
                    await linkRecording(this.app, file, link);
                } catch (e) {
                    new Notice(
                        t().notices.recordingError(
                            e instanceof Error ? e.message : String(e)
                        )
                    );
                } finally {
                    this.agendaEvents.emit("changed", undefined);
                }
                // Close the loop: hand the fresh recording to the transcriber.
                if (this.settings.autoTranscribe) {
                    // The helper writes the recording from a separate process, so
                    // Obsidian's index may not have registered it as a TFile yet.
                    // Wait for it to appear — event-driven with a generous cap, so
                    // a slow watcher (cloud-synced vault, App Nap while the app is
                    // backgrounded during the meeting) no longer silently drops
                    // the headline automation (issue #29). Cancellable so a manual
                    // transcribe of the same take supersedes it.
                    const ac = new AbortController();
                    // Supersede any stale wait for this path (implausible with
                    // unique names, but keeps the map single-writer per path).
                    this.cancelPendingAutoTranscribe(link);
                    this.pendingAutoTranscribe.set(link, ac);
                    void this.resolveIndexedRecording(link, ac.signal)
                        .then((audio) => {
                            this.pendingAutoTranscribe.delete(link);
                            // Superseded by a manual transcribe — do nothing (and
                            // don't cry "not indexed": that take is handled).
                            if (ac.signal.aborted) return;
                            if (!audio) {
                                console.warn(
                                    "[Meeting Copilot] auto-transcribe: recording not found in vault",
                                    link
                                );
                                new Notice(
                                    t().notices.autoTranscribeNotIndexed,
                                    10000
                                );
                                return;
                            }
                            return this.launchTranscriber(audio, "auto", {
                                fresh: true,
                            });
                        })
                        .catch((e) => {
                            this.pendingAutoTranscribe.delete(link);
                            console.warn(
                                "[Meeting Copilot] auto-transcribe failed",
                                e
                            );
                            if (!this.recorder.isRecording) this.hideStatusBar();
                        });
                }
                return;
            }
        }
        this.insertRecordingLink(fileName);
        } finally {
            // Release any back-to-back waiter now that the prior recording has
            // been fully linked/handled and shared state is clean.
            this.attaching = false;
            this.resolveStopWaiters();
        }
    }

    /**
     * Resolves a vault path to a TFile, retrying with a short backoff to give
     * Obsidian's file watcher time to index a file just written to disk by the
     * recorder helper (otherwise auto-transcribe would silently skip it).
     */
    private async resolveFileWithRetry(
        vaultPath: string,
        tries = 20,
        delayMs = 500
    ): Promise<TFile | null> {
        for (let i = 0; i < tries; i++) {
            const f = this.app.vault.getAbstractFileByPath(vaultPath);
            if (f instanceof TFile) return f;
            await new Promise((r) => setTimeout(r, delayMs));
        }
        const f = this.app.vault.getAbstractFileByPath(vaultPath);
        return f instanceof TFile ? f : null;
    }

    /**
     * Resolves a just-recorded audio path to a TFile, tolerant of arbitrary
     * index lag. Unlike {@link resolveFileWithRetry}'s fixed poll, this is
     * event-driven ({@link awaitIndexedFile}): it waits on the vault `create`
     * event for the path (with a poll backstop + hard cap), so a slow watcher
     * (cloud-synced vault, or App Nap throttling while the app is backgrounded
     * during a meeting) resolves whenever the index finally catches up. `signal`
     * lets a manual transcribe of the same take cancel the wait.
     */
    private resolveIndexedRecording(
        vaultPath: string,
        signal: AbortSignal
    ): Promise<TFile | null> {
        return awaitIndexedFile<TFile>(
            vaultPath,
            {
                getIndexed: (p) => {
                    const f = this.app.vault.getAbstractFileByPath(p);
                    if (f instanceof TFile) return f;
                    // Case-insensitive fallback: on a case-insensitive FS the
                    // recorder writes to the settings-cased path (e.g.
                    // "Meetings/…") but Obsidian may index the folder under a
                    // different case ("meetings/…"), so the exact, case-SENSITIVE
                    // lookup misses even though the file is indexed — and
                    // existsOnDisk (also case-insensitive) then keeps us waiting
                    // the full cap for a file that's already there. Mirror the
                    // manual path's tolerance (getFirstLinkpathDest is
                    // case-insensitive) so auto-transcribe resolves it too.
                    return findByPathCaseInsensitive(
                        this.app.vault.getFiles(),
                        p
                    );
                },
                existsOnDisk: (p) => this.app.vault.adapter.exists(p),
                onCreate: (cb) => {
                    // awaitIndexedFile always calls the returned unsubscribe on
                    // settle (resolve/cap/abort), and onunload aborts every
                    // pending wait, so the listener is removed on all paths
                    // without a separate registerEvent.
                    const ref = this.app.vault.on("create", (file) =>
                        cb(file.path)
                    );
                    return () => this.app.vault.offref(ref);
                },
                setTimeout: (fn, ms) => window.setTimeout(fn, ms),
                clearTimeout: (h) => window.clearTimeout(h),
            },
            { signal }
        );
    }

    /** Aborts and forgets any pending auto-transcribe wait for a recording path. */
    private cancelPendingAutoTranscribe(vaultPath: string): void {
        const ac = this.pendingAutoTranscribe.get(vaultPath);
        if (ac) {
            ac.abort();
            this.pendingAutoTranscribe.delete(vaultPath);
        }
    }

    /**
     * The folder a meeting note's recording should be written to: the configured
     * "Recordings" subfolder of the note's own folder, or the note's folder
     * itself when the subfolder is blank (colocated, pre-0.2 behavior).
     */
    private recordingFolderFor(noteFolder: string): string {
        const sub = this.settings.recordingSubfolder
            .trim()
            .replace(/^\/+|\/+$/g, "");
        if (!sub) return noteFolder;
        return normalizePath(noteFolder ? `${noteFolder}/${sub}` : sub);
    }

    /** The recording container for new recordings, from the compression toggle. */
    private recordingFormat(): RecordingFormat {
        return this.settings.compressedRecordings ? "m4a" : "wav";
    }

    /**
     * Returns a vault-relative recording path in the given format, appending
     * -2, -3… if the name is taken. The format is passed in (sampled once per
     * start) so the path extension can't diverge from the helper's --format
     * if the settings toggle flips mid-start. The stem must be free across
     * every recording format, not just the configured one: `foo.wav` and
     * `foo.m4a` would share the extension-less `foo.speech.json` sidecar, so
     * a new m4a next to a pre-toggle wav would overwrite the wav's speech
     * windows and retention of one would trash the other's sidecar.
     */
    private async uniqueRecordingPath(
        adapter: import("obsidian").DataAdapter,
        folder: string,
        basename: string,
        ext: RecordingFormat
    ): Promise<string> {
        // normalizePath drops the leading slash when folder is "" (vault root).
        // A stem is taken if its primary file OR any of its convention-based
        // sidecars already exist, in either format: on stop the split sidecars
        // are moved to `<stem>.me/.them.<fmt>` / `<stem>.speech.json` by naming
        // convention, so a pre-existing file at one of those paths (e.g. an
        // orphaned sidecar) would otherwise be silently overwritten.
        const stemTaken = async (stem: string): Promise<boolean> => {
            for (const fmt of RECORDING_FORMATS) {
                if (await adapter.exists(normalizePath(`${stem}.${fmt}`))) {
                    return true;
                }
                const sc = sidecarPathsFor(`${stem}.${fmt}`);
                for (const p of [sc.me, sc.them, sc.speech]) {
                    if (await adapter.exists(normalizePath(p))) return true;
                }
            }
            return false;
        };
        let stem = `${folder}/${basename}`;
        let n = 2;
        while (await stemTaken(stem)) {
            stem = `${folder}/${basename}-${n}`;
            n++;
        }
        return normalizePath(`${stem}.${ext}`);
    }

    private insertRecordingLink(fileName: string) {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
            const editor = view.editor;
            const cursor = editor.getCursor();
            editor.replaceRange(`![[${fileName}]]\n`, cursor);
        }
    }

    // MARK: - Helpers
}
