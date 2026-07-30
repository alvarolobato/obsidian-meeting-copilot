import {
	App,
	DropdownComponent,
	Notice,
	PluginSettingTab,
	Setting,
} from "obsidian";
import type SystemRecordingPlugin from "./main";
import type { InputDevice } from "./recorder";
import type { StoredTokens } from "./auth/googleOAuth";
import {
	DEFAULT_NOTE_TEMPLATE,
	DEFAULT_TITLE_PATTERN,
} from "./notes/meetingNote";
import { DEFAULT_ENRICH_PROMPT } from "./enrich/prompt";
import { listModels } from "./enrich/models";
import {
	inferSttApiType,
	isTimestampCapableFamily,
	STT_MODELS,
	type SttApiType,
} from "./transcribe/sttModel";
import { probeKey, probeSttSupport } from "./transcribe/probe";
import {
	fetchModelCapabilities,
	type ModelCapability,
} from "./transcribe/capabilities";
import {
	DEFAULT_LOCAL_MODEL_ID,
	LOCAL_MODELS,
	formatBytes,
	localModelSpec,
} from "./transcribe/localModels";
import { t, type Messages } from "./i18n";
import { describeVersion } from "./buildInfo";
import { mcLog } from "./util/logLine";
import { ModelIdSuggest, type ModelOption } from "./ui/modelSuggest";

export interface SystemRecordingSettings {
	/** `{{placeholder}}` folder template for one-off meetings, e.g. "Meetings/{{year}}". */
	oneOffFolderTemplate: string;
	/** `{{placeholder}}` folder template for a new recurring series, e.g. "Meetings/{{series}}". */
	seriesFolderTemplate: string;
	/** When on, 1:1s get their own per-person folder instead of following the series/one-off rules. */
	oneOnOneSeparately: boolean;
	/** Parent folder for a 1:1's per-person subfolder. */
	oneOnOneFolder: string;
	/** Folder for unplanned (ad-hoc) meetings. */
	adhocFolder: string;
	/**
	 * Subfolder (relative to a note's own folder) where that note's recordings
	 * and their split sidecars are written, e.g. "Recordings" puts a note at
	 * `Meetings/x.md`'s audio under `Meetings/Recordings/`. Empty = colocate the
	 * audio beside the note (the pre-0.2 behavior).
	 */
	recordingSubfolder: string;
	/**
	 * Save recordings (and their split sidecars) as AAC `.m4a` instead of WAV.
	 * Same mono 24 kHz audio either way; this only picks the container/codec
	 * the helper encodes at stop.
	 */
	compressedRecordings: boolean;
	/**
	 * Stable UID of the input device (microphone) to record the "Me" channel
	 * from. Empty = the system default input. A UID that no longer resolves at
	 * record time falls back to the default with a notice.
	 */
	micDeviceUid: string;
	/**
	 * Friendly name of {@link micDeviceUid}, remembered so the "device
	 * unavailable" notice can name it even after the device is unplugged (the
	 * helper only ever sees the UID).
	 */
	micDeviceLabel: string;
	/** Opt-in to a custom note-title pattern; while off, the live default is used. */
	noteTitlePatternCustomize: boolean;
	noteTitlePattern: string;
	/** Opt-in to a custom note-body template; while off, the live default is used. */
	noteTemplateCustomize: boolean;
	noteTemplate: string;
	retentionDays: number;
	/**
	 * Cap on people expanded from a single Google Group invitee via Cloud
	 * Identity. Excess members are omitted from attendee labels / notes.
	 */
	groupExpandMaxMembers: number;
	insertTranscript: boolean;
	autoTranscribe: boolean;
	/** Auto-discard a just-stopped recording that had no speech (needs auto-transcribe). */
	discardSilentRecordings: boolean;
	actionItemsAsTasks: boolean;
	/**
	 * How many days of open meeting follow-ups the dashboard shows by default.
	 * Older items stay in their notes and can be revealed with "Show older".
	 * `0` disables the horizon (show all).
	 */
	followUpHorizonDays: number;
	googleClientId: string;
	googleClientSecret: string;
	googleTokens: StoredTokens | null;
	calendarAutoRecord: boolean;
	/**
	 * Automatically start recording at a calendar event's start, instead of only
	 * prompting. Opt-in; pairs with `calendarAutoStop`.
	 */
	calendarAutoStart: boolean;
	/** Automatically stop a calendar recording when the event ends (opt-in). */
	calendarAutoStop: boolean;
	/**
	 * How many minutes before an event's start to fire the "meeting is about to
	 * start" notification. 0 disables the pre-start notification (you're still
	 * prompted at the start itself).
	 */
	notifyBeforeStartMinutes: number;
	calendarId: string;
	exclusionKeywords: string;
	/**
	 * When on, drop calendar events that have no Meet/Zoom/Teams/Webex link
	 * (conference data, location, or description — same detection as auto-open).
	 */
	excludeWithoutMeetingLink: boolean;
	openMeetAutomatically: boolean;
	/**
	 * Whether the one-time "set macOS to Alerts so notifications persist" tip has
	 * been shown. Bookkeeping (not a user preference); set once the first meeting
	 * notification fires so we never nag again.
	 */
	notificationStyleHintShown: boolean;
	// Meeting detection (Tier 1, macOS).
	detectMeetings: boolean;
	detectZoom: boolean;
	detectGoogleMeet: boolean;
	detectionIntervalSeconds: number;
	agendaLookAheadDays: number;
	agendaLookBackDays: number;
	/** Where the "Coming up" agenda opens: a main-panel tab or the right sidebar. */
	agendaPlacement: "main" | "sidebar";
	/** How many upcoming meetings the dashboard shows per page (10/20/50/100). Set via the dashboard's own dropdown. */
	dashboardUpcomingPageSize: number;
	/** How many past meetings the dashboard shows per page (10/20/50/100). Set via the dashboard's own dropdown. */
	dashboardPastPageSize: number;
	/** How many notes-with-open-tasks the dashboard's action-items list shows per page (10/20/50/100). Set via the dashboard's own dropdown. */
	dashboardActionsPageSize: number;
	/** How many notes-with-open-follow-ups the dashboard's follow-ups list shows per page (10/20/50/100). Set via the dashboard's own dropdown. */
	dashboardFollowupsPageSize: number;
	// Shared OpenAI-compatible endpoint + credentials (transcription + enrichment).
	apiBaseUrl: string;
	apiKey: string;
	/**
	 * Optional fallback OpenAI-compatible endpoint used when the primary fails
	 * with a service-level error (network, timeout, 5xx/401/403/429). Empty URL
	 * disables fallback.
	 */
	fallbackApiBaseUrl: string;
	fallbackApiKey: string;
	/** Fallback STT wire model; empty inherits primary `sttModel`. */
	fallbackSttModel: string;
	/** Fallback enrich chat model; empty inherits primary `enrichModel`. */
	fallbackEnrichModel: string;
	// Transcription backend selection (issue #34).
	/** Where audio is transcribed: the remote OpenAI-compatible endpoint, or a local on-device Whisper model. */
	transcriptionBackend: "remote" | "local";
	/** Local ggml model id (see {@link LOCAL_MODELS}) used when `transcriptionBackend` is "local". */
	localWhisperModel: string;
	/** When local transcription fails, fall back to the remote endpoint if one is configured. */
	localFallbackToRemote: boolean;
	// Transcription (vendored engine).
	/** Model id sent to the endpoint (e.g. gpt-4o-transcribe, or a gateway name like llm-gateway/whisper). */
	sttModel: string;
	/** Engine family the model speaks — drives routing/chunking and word timestamps. */
	sttApiType: SttApiType;
	sttLanguage: string;
	postProcessingEnabled: boolean;
	dictionaryCorrectionEnabled: boolean;
	/** Custom dictionary, one `misheard => correct` rule per line. Applied for all transcription languages. */
	dictionary: string;
	/** Transcribe mic and system audio separately so each speaker's side can be told apart. Needs a timestamp-capable model. */
	diarizationEnabled: boolean;
	/** Whether the selected model can transcribe at all (from endpoint capabilities or a probe). null = not yet determined, or invalidated by a config change. */
	sttTranscriptionSupported: boolean | null;
	/** Whether the configured endpoint actually returns segment timestamps. null = never probed, or invalidated by a later config change. */
	sttTimestampsSupported: boolean | null;
	/** Verbose transcription logging (per-chunk timing, rate-limit waits, retries) to the developer console. Off by default. */
	debugLogging: boolean;
	/** The `${apiBaseUrl}::${sttModel}` the two flags above were determined against; a mismatch means they're stale. */
	sttTimestampsProbeKey: string;
	// Enrichment.
	enableEnrichment: boolean;
	enrichModel: string;
	/**
	 * Opt-in to a custom enrichment prompt. When off (the default), the plugin
	 * uses the live {@link DEFAULT_ENRICH_PROMPT} at runtime and `enrichPrompt`
	 * is ignored — so default improvements reach every non-customizing user with
	 * no persisted copy to migrate.
	 */
	enrichPromptCustomize: boolean;
	/** The user's custom enrichment prompt; only used when `enrichPromptCustomize` is on. */
	enrichPrompt: string;
	/**
	 * Soft cap on transcript tokens (~chars/4) spliced into the enrichment
	 * prompt. Over budget, the middle is truncated with a visible marker (#22).
	 * 0 disables truncation.
	 */
	enrichMaxTranscriptTokens: number;
	/**
	 * Per-request timeout for enrichment LLM calls (seconds). Default 120.
	 * Clamped to 60–600 in settings. One automatic retry on timeout (#128).
	 */
	enrichTimeoutSeconds: number;
	enrichOnTranscribe: boolean;
	hideAiNotes: boolean;
	/** After enriching an ad-hoc meeting, ask the LLM for a title and offer to rename. */
	suggestAdhocTitle: boolean;
}

export { STT_MODELS, inferSttApiType, type SttApiType };

/** Shared row count so every settings text area is the same (comfortable) height. */
const TEXTAREA_ROWS = 18;

/** Settings panes shown as horizontal tabs inside the plugin settings view. */
type SettingsTabId =
	| "general"
	| "calendar"
	| "detection"
	| "recording"
	| "transcription"
	| "enrichment";

const SETTINGS_TABS: readonly SettingsTabId[] = [
	"general",
	"calendar",
	"detection",
	"recording",
	"transcription",
	"enrichment",
] as const;

export const DEFAULT_SETTINGS: SystemRecordingSettings = {
	oneOffFolderTemplate: "Meetings/{{year}}",
	seriesFolderTemplate: "Meetings/{{series}}",
	oneOnOneSeparately: true,
	oneOnOneFolder: "Meetings/1-1s",
	adhocFolder: "Meetings/Ad-hoc",
	recordingSubfolder: "Recordings",
	compressedRecordings: true,
	micDeviceUid: "",
	micDeviceLabel: "",
	noteTitlePatternCustomize: false,
	noteTitlePattern: "",
	noteTemplateCustomize: false,
	noteTemplate: "",
	retentionDays: 15,
	groupExpandMaxMembers: 50,
	insertTranscript: true,
	autoTranscribe: true,
	discardSilentRecordings: true,
	actionItemsAsTasks: true,
	followUpHorizonDays: 45,
	googleClientId: "",
	googleClientSecret: "",
	googleTokens: null,
	calendarAutoRecord: true,
	calendarAutoStart: false,
	calendarAutoStop: false,
	notifyBeforeStartMinutes: 1,
	calendarId: "primary",
	exclusionKeywords: "",
	excludeWithoutMeetingLink: false,
	openMeetAutomatically: false,
	notificationStyleHintShown: false,
	detectMeetings: true,
	detectZoom: true,
	detectGoogleMeet: false,
	detectionIntervalSeconds: 10,
	agendaLookAheadDays: 7,
	agendaLookBackDays: 7,
	agendaPlacement: "main",
	dashboardUpcomingPageSize: 10,
	dashboardPastPageSize: 10,
	dashboardActionsPageSize: 10,
	dashboardFollowupsPageSize: 10,
	apiBaseUrl: "https://api.openai.com/v1",
	apiKey: "",
	fallbackApiBaseUrl: "",
	fallbackApiKey: "",
	fallbackSttModel: "",
	fallbackEnrichModel: "",
	transcriptionBackend: "local",
	localWhisperModel: DEFAULT_LOCAL_MODEL_ID,
	localFallbackToRemote: false,
	sttModel: "gpt-4o-transcribe",
	sttApiType: "gpt-4o-transcribe",
	sttLanguage: "auto",
	postProcessingEnabled: false,
	dictionaryCorrectionEnabled: false,
	dictionary: "",
	// On by default: diarization runs two full transcription passes (~2x the
	// time of the mixed path). Local WebRTC VAD gates each stream's silence and
	// cross-talk bleed is de-duped so the merge stays clean. Manual re-transcribe
	// can also force it on/off per run.
	diarizationEnabled: true,
	sttTranscriptionSupported: null,
	sttTimestampsSupported: null,
	sttTimestampsProbeKey: "",
	debugLogging: false,
	enableEnrichment: true,
	enrichModel: "gpt-4o",
	enrichPromptCustomize: false,
	enrichPrompt: "",
	enrichMaxTranscriptTokens: 12_000,
	enrichTimeoutSeconds: 120,
	enrichOnTranscribe: true,
	hideAiNotes: false,
	suggestAdhocTitle: true,
};

/** Folder-template keys that must be a non-empty string, or `DEFAULT_SETTINGS` wins instead. */
const FOLDER_TEMPLATE_KEYS = [
	"oneOffFolderTemplate",
	"seriesFolderTemplate",
	"oneOnOneFolder",
	"adhocFolder",
] as const;

/**
 * Drops any of the folder-template keys (or `oneOnOneSeparately`) that are
 * present but hold the wrong type, so a hand-edited or corrupted `data.json`
 * (e.g. `oneOffFolderTemplate: null`) can't pass a bad value through
 * `Object.assign` and crash every folder-resolution path that calls
 * `.replace` on it. Leaving the key out entirely lets `DEFAULT_SETTINGS` win.
 */
function sanitizeMigrated(
	result: Partial<SystemRecordingSettings>
): Partial<SystemRecordingSettings> {
	const out = { ...result } as Record<string, unknown>;
	for (const key of FOLDER_TEMPLATE_KEYS) {
		if (key in out && (typeof out[key] !== "string" || out[key] === "")) {
			delete out[key];
		}
	}
	if ("oneOnOneSeparately" in out && typeof out["oneOnOneSeparately"] !== "boolean") {
		delete out["oneOnOneSeparately"];
	}
	return out as Partial<SystemRecordingSettings>;
}

/**
 * Migrates settings loaded from disk. A vault that predates the folder
 * templates had a single `meetingsFolder` string; that string becomes the
 * root for both the one-off and (new) series templates so an existing note
 * layout doesn't move. Pure so it can run without a vault. `loaded` is
 * untyped since the legacy `meetingsFolder` key no longer exists on
 * `SystemRecordingSettings`, and since a hand-edited file may carry any type
 * at all for keys that `sanitizeMigrated` then validates.
 */
export function migrateSettings(
	loaded: Record<string, unknown> | null
): Partial<SystemRecordingSettings> {
	if (!loaded) return {};
	const migrated =
		loaded["oneOffFolderTemplate"] !== undefined
			? sanitizeMigrated(loaded as Partial<SystemRecordingSettings>)
			: (() => {
					const legacyFolder = loaded["meetingsFolder"];
					const base =
						typeof legacyFolder === "string" && legacyFolder
							? legacyFolder
							: "Meetings";
					return sanitizeMigrated({
						...(loaded as Partial<SystemRecordingSettings>),
						oneOffFolderTemplate: base,
						seriesFolderTemplate: `${base}/{{series}}`,
						// Nest ad-hoc notes under an "Ad-hoc" subfolder of the legacy
						// folder, matching the new default and the sibling `1-1s`
						// nesting, rather than dropping them loose alongside scheduled
						// meetings.
						adhocFolder: `${base}/Ad-hoc`,
						oneOnOneFolder: `${base}/1-1s`,
					});
				})();
	// Default-backed text settings (enrichment prompt, note title pattern, note
	// template) are no longer persisted as a full copy of their default — a copy
	// couldn't follow plugin updates (e.g. the prompt's new `{{actionItems}}`).
	// Each now has a "Customize" toggle (default off); while off the plugin reads
	// the live built-in default at runtime.
	//
	// Drop the persisted text ONLY for *legacy* vaults, detected by the absence
	// of the matching `*Customize` key: those predate the toggle, so their stored
	// value is an old default (or edit) we intentionally discard so it can't
	// resurface. New-format vaults (the key exists, on OR off) keep their text so
	// toggling off then back on doesn't lose a user's custom prompt across a
	// reload — the resolver already ignores it while the toggle is off.
	if (!("enrichPromptCustomize" in migrated)) delete migrated.enrichPrompt;
	if (!("noteTitlePatternCustomize" in migrated))
		delete migrated.noteTitlePattern;
	if (!("noteTemplateCustomize" in migrated)) delete migrated.noteTemplate;
	return migrated;
}

export class SystemRecordingSettingTab extends PluginSettingTab {
    plugin: SystemRecordingPlugin;
    /** Which settings pane is currently shown; preserved across `display()` re-renders. */
    private activeTab: SettingsTabId = "general";
    /** Model ids fetched from the primary endpoint (populated by "Load models"). */
    private models: string[] = [];
    /** Model ids from the fallback endpoint (when configured + loaded). */
    private fallbackModels: string[] = [];
    /** Per-model capabilities from the primary endpoint (LiteLLM), or null when unavailable. */
    private capabilities: Map<string, ModelCapability> | null = null;
    /** Capabilities from the fallback endpoint, or null. */
    private fallbackCapabilities: Map<string, ModelCapability> | null = null;
    /** Last Load-models result for the primary URL (session only). */
    private primaryEndpointStatus: "idle" | "ok" | "error" = "idle";
    /** Last Load-models result for the fallback URL (session only). */
    private fallbackEndpointStatus: "idle" | "ok" | "error" = "idle";
    /** The `${baseUrl}::${model}` key currently being auto-assessed, so the badges can show "checking…". */
    private probingKey: string | null = null;
    /** Endpoint+model keys already auto-assessed this session, so re-renders don't re-fire the probe (even after an "unknown" result). */
    private probedKeys = new Set<string>();
    /** Description elements for the two STT support badges, updated in place so selecting a model doesn't re-render (and scroll-jump) the whole tab. */
    private sttTranscriptionBadgeEl: HTMLElement | null = null;
    private sttTimestampBadgeEl: HTMLElement | null = null;
    /** The engine-family dropdown, so a model change can update its value in place. */
    private sttEngineDropdown: DropdownComponent | null = null;
    /** Host for remote vs local transcription rows — rebuilt in place on engine switch (no full-tab jump). */
    private transcriptionEngineBodyEl: HTMLElement | null = null;
    /** Engine remote/local dropdown — disabled in place while a local model downloads. */
    private transcriptionEngineDropdown: DropdownComponent | null = null;
    /** Host under the local→remote toggle for remote + fallback model pickers. */
    private localFallbackModelsEl: HTMLElement | null = null;
    /** Which fallback `<details>` were open before the last full `display()` (keyed by data-mc-details). */
    private openDetailsKeys = new Set<string>();
    /** Input devices last enumerated from the helper, for the Microphone picker. Empty until listed. */
    private inputDevices: InputDevice[] = [];
    /** True while a device enumeration is in flight, so the button can show progress and re-entry is blocked. */
    private listingDevices = false;
    /** True while a local model download is streaming, so the row shows progress and re-entry is blocked. */
    private downloadingModel = false;
    /** Aborts the in-flight model download (Cancel button / tab close). Null when idle. */
    private modelDownloadAbort: AbortController | null = null;
    /** Whole-percent progress of the in-flight local model download (0–100). */
    private downloadProgress = 0;
    /** The on-screen local-model download/status row, updated in place during a download. */
    private modelDownloadRow: Setting | null = null;

    constructor(app: App, plugin: SystemRecordingPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        const s = t();
        this.captureOpenDetails();
        const scrollTop = containerEl.scrollTop;
        containerEl.empty();
        containerEl.addClass("meeting-copilot-settings");

        // Version / build provenance. Release builds show just the version; a
        // local/custom build also shows commit·branch·date so it's obvious the
        // vault isn't running an official release.
        containerEl
            .createEl("div", { cls: "meeting-copilot-version" })
            .setText(
                `${this.plugin.manifest.name} v${describeVersion(
                    this.plugin.manifest.version,
                    s.settings.customBuild
                )}`
            );
        // Opening (or re-rendering) the tab is a fresh chance to auto-probe:
        // clear the per-session "already probed" guard so a verdict invalidated
        // at runtime (e.g. diarization found no timestamps) is re-checked here
        // instead of being stuck at "not checked yet" until a manual Recheck.
        // The guard still prevents repeated probes from rapid in-tab edits.
        this.probedKeys.clear();

        this.renderTabBar(containerEl);

        const pane = containerEl.createDiv({ cls: "mc-settings-tab-pane" });
        switch (this.activeTab) {
            case "general":
                this.renderGeneralTab(pane);
                break;
            case "calendar":
                this.renderCalendarTab(pane);
                break;
            case "detection":
                this.renderDetectionTab(pane);
                break;
            case "recording":
                this.renderRecordingSettings(pane);
                break;
            case "transcription":
                this.renderTranscriptionTab(pane);
                break;
            case "enrichment":
                this.renderEnrichmentTab(pane);
                break;
        }
        this.restoreOpenDetails();
        containerEl.scrollTop = scrollTop;
    }

    /** Remember which fallback `<details>` are open before a full re-render. */
    private captureOpenDetails(): void {
        this.openDetailsKeys.clear();
        this.containerEl
            .querySelectorAll<HTMLDetailsElement>("details[data-mc-details]")
            .forEach((el) => {
                const key = el.getAttribute("data-mc-details");
                if (key && el.open) this.openDetailsKeys.add(key);
            });
    }

    private restoreOpenDetails(): void {
        this.containerEl
            .querySelectorAll<HTMLDetailsElement>("details[data-mc-details]")
            .forEach((el) => {
                const key = el.getAttribute("data-mc-details");
                if (key && this.openDetailsKeys.has(key)) el.open = true;
            });
    }

    private renderTabBar(containerEl: HTMLElement): void {
        const s = t();
        const bar = containerEl.createDiv({ cls: "mc-settings-tab-bar" });
        for (const id of SETTINGS_TABS) {
            const btn = bar.createEl("button", {
                cls: "mc-settings-tab" + (this.activeTab === id ? " is-active" : ""),
                text: s.settings.tabs[id],
                attr: { type: "button" },
            });
            btn.addEventListener("click", () => {
                if (this.activeTab === id) return;
                this.activeTab = id;
                this.display();
            });
        }
    }

    /**
     * Setup essentials: Google credentials + login, shared AI endpoint, and the
     * transcription / enrichment model pickers.
     */
    private renderGeneralTab(containerEl: HTMLElement): void {
        const s = t();

        new Setting(containerEl).setName(s.settings.googleHeading).setHeading();

        new Setting(containerEl)
            .setName(s.settings.googleAuth.name)
            .setDesc(
                this.plugin.isCalendarAuthenticated()
                    ? s.settings.googleAuth.descAuthenticated
                    : s.settings.googleAuth.descUnauthenticated
            )
            .addButton((btn) =>
                btn
                    .setButtonText(
                        this.plugin.isCalendarAuthenticated()
                            ? s.settings.googleAuth.buttonReauthenticate
                            : s.settings.googleAuth.buttonAuthenticate
                    )
                    .setCta()
                    .onClick(async () => {
                        await this.plugin.authenticateCalendar();
                        this.display();
                    })
            );

        // Advanced: credential overrides — collapsed by default so the common
        // path (use bundled credentials) requires zero configuration.
        const advancedDetails = containerEl.createEl("details", {
            cls: "mc-advanced-credentials",
        });
        advancedDetails.createEl("summary", {
            text: s.settings.advancedCredentials.summary,
            cls: "mc-advanced-credentials-summary",
        });
        const advancedDesc = advancedDetails.createEl("p", {
            cls: "mc-advanced-credentials-desc",
        });
        advancedDesc.setText(s.settings.advancedCredentials.desc);

        new Setting(advancedDetails)
            .setName(s.settings.clientId.name)
            .setDesc(s.settings.clientId.desc)
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.googleClientId)
                    .onChange(async (value) => {
                        this.plugin.settings.googleClientId = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(advancedDetails)
            .setName(s.settings.clientSecret.name)
            .setDesc(s.settings.clientSecret.desc)
            .addText((text) => {
                text.inputEl.type = "password";
                text
                    .setValue(this.plugin.settings.googleClientSecret)
                    .onChange(async (value) => {
                        this.plugin.settings.googleClientSecret = value.trim();
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName(s.settings.notificationsHeading)
            .setHeading();

        new Setting(containerEl)
            .setName(s.settings.notificationStyle.name)
            .setDesc(s.settings.notificationStyle.desc)
            .addButton((btn) =>
                btn
                    .setButtonText(s.settings.notificationStyle.button)
                    .onClick(() => this.plugin.openMacNotificationSettings())
            );

        new Setting(containerEl).setName(s.settings.endpointHeading).setHeading();

        this.addEndpointUrlSetting(
            containerEl,
            s.settings.apiBaseUrl.name,
            s.settings.apiBaseUrl.desc,
            this.plugin.settings.apiBaseUrl,
            "https://api.openai.com/v1",
            this.primaryEndpointStatus,
            async (value) => {
                this.plugin.settings.apiBaseUrl = value.trim();
                await this.plugin.saveSettings();
                this.primaryEndpointStatus = "idle";
                // The stored verdict is keyed on the old base URL, so the
                // badges now read "not checked yet"; repaint them and let
                // a re-probe run on the next model change / tab reopen.
                this.probedKeys.clear();
                this.refreshSttBadges();
            }
        );

        new Setting(containerEl)
            .setName(s.settings.apiKey.name)
            .setDesc(s.settings.apiKey.desc)
            .addText((text) => {
                text.inputEl.type = "password";
                text
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.apiKey = value.trim();
                        // probeKey ignores the key, so a stored verdict would
                        // otherwise stay falsely "fresh" after a key change.
                        // Reset it so transcription/timestamp support is
                        // re-probed against the new credential.
                        this.plugin.settings.sttTimestampsProbeKey = "";
                        await this.plugin.saveSettings();
                        this.primaryEndpointStatus = "idle";
                        this.probedKeys.clear();
                        this.refreshSttBadges();
                    });
            });

        // Optional failover endpoint — collapsed so the common single-service
        // setup stays short. Model pickers live under each primary model below.
        const fallbackDetails = containerEl.createEl("details", {
            cls: "mc-fallback-endpoint",
            attr: { "data-mc-details": "endpoint" },
        });
        fallbackDetails.createEl("summary", {
            text: s.settings.fallbackEndpoint.summary,
            cls: "mc-fallback-endpoint-summary",
        });
        const fallbackDesc = fallbackDetails.createEl("p", {
            cls: "mc-fallback-endpoint-desc",
        });
        fallbackDesc.setText(s.settings.fallbackEndpoint.desc);

        this.addEndpointUrlSetting(
            fallbackDetails,
            s.settings.fallbackApiBaseUrl.name,
            s.settings.fallbackApiBaseUrl.desc,
            this.plugin.settings.fallbackApiBaseUrl,
            "https://api.example.com/v1",
            this.fallbackEndpointStatus,
            async (value) => {
                this.plugin.settings.fallbackApiBaseUrl = value.trim();
                await this.plugin.saveSettings();
                this.fallbackEndpointStatus = "idle";
            }
        );

        new Setting(fallbackDetails)
            .setName(s.settings.fallbackApiKey.name)
            .setDesc(s.settings.fallbackApiKey.desc)
            .addText((text) => {
                text.inputEl.type = "password";
                text
                    .setValue(this.plugin.settings.fallbackApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.fallbackApiKey = value.trim();
                        await this.plugin.saveSettings();
                        this.fallbackEndpointStatus = "idle";
                    });
            });

        // Endpoint actions: one button that verifies primary (+ fallback when
        // set) and loads model lists for both. Kept as the last row of the
        // endpoint section so the credentials sit above it.
        new Setting(containerEl)
            .setName(s.settings.endpointActions.name)
            .setDesc(s.settings.endpointActions.desc)
            .addButton((button) =>
                button
                    .setButtonText(s.settings.testConnection.button)
                    .setCta()
                    .onClick(async () => {
                        if (!this.plugin.settings.apiBaseUrl) {
                            new Notice(s.settings.testConnection.noBaseUrl);
                            return;
                        }
                        button.setButtonText(s.settings.testConnection.testing);
                        button.setDisabled(true);
                        try {
                            await this.loadEndpointModels();
                            this.display();
                        } catch (e) {
                            new Notice(
                                s.settings.testConnection.failure(
                                    e instanceof Error ? e.message : String(e)
                                )
                            );
                            button.setButtonText(
                                s.settings.testConnection.button
                            );
                            button.setDisabled(false);
                        }
                    })
            );

        new Setting(containerEl).setName(s.settings.modelsHeading).setHeading();

        // Engine selector: remote OpenAI-compatible endpoint vs. on-device Whisper.
        // Switching rebuilds only the engine body below so the tab doesn't jump.
        new Setting(containerEl)
            .setName(s.settings.transcriptionEngine.name)
            .setDesc(s.settings.transcriptionEngine.desc)
            .addDropdown((dd) => {
                this.transcriptionEngineDropdown = dd;
                dd.addOption("remote", s.settings.transcriptionEngine.remote);
                dd.addOption("local", s.settings.transcriptionEngine.local);
                dd
                    .setValue(this.plugin.settings.transcriptionBackend)
                    // Locked mid-download so the switch can't strand an in-flight
                    // model fetch on a torn-down row.
                    .setDisabled(this.downloadingModel)
                    .onChange(async (value) => {
                        this.plugin.settings.transcriptionBackend =
                            value === "local" ? "local" : "remote";
                        await this.plugin.saveSettings();
                        this.renderTranscriptionEngineBody();
                    });
            });

        this.transcriptionEngineBodyEl = containerEl.createDiv({
            cls: "mc-transcription-engine-body",
        });
        this.renderTranscriptionEngineBody();

        this.addModelPicker(
            new Setting(containerEl)
                .setName(s.settings.enrichModel.name)
                .setDesc(s.settings.enrichModel.desc),
            this.plugin.settings.enrichModel,
            async (value) => {
                this.plugin.settings.enrichModel = value;
                await this.plugin.saveSettings();
            }
        );
        this.addFallbackModelDetails(containerEl, {
            detailsKey: "fallback-enrich",
            desc: s.settings.fallbackModel.descEnrich,
            current: this.plugin.settings.fallbackEnrichModel,
            onChange: async (value) => {
                this.plugin.settings.fallbackEnrichModel = value;
                await this.plugin.saveSettings();
            },
        });
    }

    /** Rebuild remote vs local transcription rows without re-rendering the whole tab. */
    private renderTranscriptionEngineBody(): void {
        const el = this.transcriptionEngineBodyEl;
        if (!el) return;
        this.sttEngineDropdown = null;
        this.sttTranscriptionBadgeEl = null;
        this.sttTimestampBadgeEl = null;
        this.modelDownloadRow = null;
        this.localFallbackModelsEl = null;
        el.empty();
        if (this.plugin.settings.transcriptionBackend === "local") {
            this.renderLocalTranscription(el);
        } else {
            this.renderRemoteTranscription(el);
        }
    }

    /**
     * Fetch primary (+ optional fallback) `/models` lists and capabilities.
     * Both endpoints are probed in parallel so a down primary (e.g. 503) cannot
     * block or abort the fallback load — that is a primary use case. Throws
     * only when every attempted endpoint fails (or primary fails and no
     * fallback URL is set).
     */
    private async loadEndpointModels(): Promise<void> {
        const s = t();
        const { apiBaseUrl, apiKey } = this.plugin.settings;
        const fbUrl = this.plugin.settings.fallbackApiBaseUrl.trim();
        // Key is optional — many local/gateway servers ignore auth (same as
        // fetchModelIds omitting Authorization when the key is empty).
        const fbKey = this.plugin.settings.fallbackApiKey.trim();

        type LoadOk = {
            ok: true;
            models: string[];
            caps: Map<string, ModelCapability> | null;
        };
        type LoadErr = { ok: false; error: string };
        type LoadResult = LoadOk | LoadErr;

        const loadOne = async (
            baseUrl: string,
            key: string
        ): Promise<LoadResult> => {
            try {
                const models = await listModels(baseUrl, key);
                const caps = await fetchModelCapabilities(baseUrl, key);
                return { ok: true, models, caps };
            } catch (e) {
                return {
                    ok: false,
                    error: e instanceof Error ? e.message : String(e),
                };
            }
        };

        const [primary, fallback] = await Promise.all([
            loadOne(apiBaseUrl, apiKey),
            fbUrl
                ? loadOne(fbUrl, fbKey)
                : Promise.resolve<LoadResult | null>(null),
        ]);

        if (primary.ok) {
            this.models = primary.models;
            this.capabilities = primary.caps;
            this.primaryEndpointStatus = "ok";
        } else {
            this.models = [];
            this.capabilities = null;
            this.primaryEndpointStatus = "error";
        }

        let fallbackError: string | null = null;
        if (fallback === null) {
            this.fallbackModels = [];
            this.fallbackCapabilities = null;
            this.fallbackEndpointStatus = "idle";
        } else if (fallback.ok) {
            this.fallbackModels = fallback.models;
            this.fallbackCapabilities = fallback.caps;
            this.fallbackEndpointStatus = "ok";
        } else {
            this.fallbackModels = [];
            this.fallbackCapabilities = null;
            this.fallbackEndpointStatus = "error";
            fallbackError = fallback.error;
        }

        mcLog("settings", "load-models", {
            primaryOk: primary.ok,
            primaryModels: primary.ok ? primary.models.length : 0,
            primaryError: primary.ok ? undefined : primary.error,
            fallbackConfigured: Boolean(fbUrl),
            fallbackOk: fallback === null ? null : fallback.ok,
            fallbackModels: fallback?.ok ? fallback.models.length : 0,
            fallbackError: fallbackError ?? undefined,
        });

        if (!primary.ok && !fbUrl) {
            throw new Error(primary.error);
        }
        if (!primary.ok && fallbackError) {
            throw new Error(
                s.settings.testConnection.primaryFailedNoFallback(
                    primary.error,
                    fallbackError
                )
            );
        }
        if (!primary.ok) {
            new Notice(
                s.settings.testConnection.primaryFailedFallbackOk(
                    primary.error,
                    this.fallbackModels.length
                )
            );
            return;
        }
        if (fallbackError) {
            new Notice(
                s.settings.testConnection.fallbackFailed(fallbackError)
            );
            return;
        }
        if (fbUrl) {
            new Notice(
                this.models.length === 0 && this.fallbackModels.length === 0
                    ? s.settings.testConnection.empty
                    : s.settings.testConnection.successWithFallback(
                            this.models.length,
                            this.fallbackModels.length
                        )
            );
            return;
        }
        new Notice(
            this.models.length === 0
                ? s.settings.testConnection.empty
                : s.settings.testConnection.success(this.models.length)
        );
    }

    /**
     * API base URL row with an optional ✓/✗ next to the name after Load models.
     */
    private addEndpointUrlSetting(
        parent: HTMLElement,
        name: string,
        desc: string,
        value: string,
        placeholder: string,
        status: "idle" | "ok" | "error",
        onChange: (value: string) => Promise<void>
    ): void {
        const setting = new Setting(parent).setName(name).setDesc(desc);
        this.decorateEndpointStatus(setting, status);
        setting.addText((text) =>
            text
                .setPlaceholder(placeholder)
                .setValue(value)
                .onChange(async (v) => {
                    await onChange(v);
                })
        );
    }

    private decorateEndpointStatus(
        setting: Setting,
        status: "idle" | "ok" | "error"
    ): void {
        if (status === "idle") return;
        const s = t();
        setting.nameEl.createSpan({
            cls:
                "mc-endpoint-status" +
                (status === "ok" ? " is-ok" : " is-error"),
            text: status === "ok" ? "✓" : "✗",
            attr: {
                title:
                    status === "ok"
                        ? s.settings.endpointStatus.ok
                        : s.settings.endpointStatus.error,
            },
        });
    }

    private renderCalendarTab(containerEl: HTMLElement): void {
        const s = t();

        new Setting(containerEl)
            .setName(s.settings.calendarAutoRecord.name)
            .setDesc(s.settings.calendarAutoRecord.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.calendarAutoRecord)
                    .onChange(async (value) => {
                        this.plugin.settings.calendarAutoRecord = value;
                        await this.plugin.saveSettings();
                        void this.plugin.updateScheduler();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.notifyBeforeStart.name)
            .setDesc(s.settings.notifyBeforeStart.desc)
            .addText((text) => {
                text.inputEl.type = "number";
                text
                    .setValue(
                        String(this.plugin.settings.notifyBeforeStartMinutes)
                    )
                    .onChange(async (value) => {
                        const n = Number.parseInt(value, 10);
                        this.plugin.settings.notifyBeforeStartMinutes =
                            Number.isFinite(n) && n >= 0 ? Math.min(n, 60) : 1;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(containerEl)
            .setName(s.settings.calendarAutoStart.name)
            .setDesc(s.settings.calendarAutoStart.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.calendarAutoStart)
                    .onChange(async (value) => {
                        this.plugin.settings.calendarAutoStart = value;
                        await this.plugin.saveSettings();
                        void this.plugin.updateScheduler();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.calendarAutoStop.name)
            .setDesc(s.settings.calendarAutoStop.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.calendarAutoStop)
                    .onChange(async (value) => {
                        this.plugin.settings.calendarAutoStop = value;
                        await this.plugin.saveSettings();
                        void this.plugin.updateScheduler();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.targetCalendarId.name)
            .setDesc(s.settings.targetCalendarId.desc)
            .addText((text) => {
                text
                    .setValue(this.plugin.settings.calendarId)
                    .onChange(async (value) => {
                        this.plugin.settings.calendarId = value.trim() || "primary";
                        await this.plugin.saveSettings();
                    });
                // Re-poll immediately once the user finishes editing (avoids per-keystroke API calls).
                this.plugin.registerDomEvent(text.inputEl, "blur", () => {
                    this.plugin.refreshCalendarNow();
                });
            });

		new Setting(containerEl)
			.setName(s.settings.exclusionKeywords.name)
			.setDesc(s.settings.exclusionKeywords.desc)
			.addTextArea((ta) => {
				ta
					.setValue(this.plugin.settings.exclusionKeywords)
					.onChange(async (value) => {
						this.plugin.settings.exclusionKeywords = value;
						await this.plugin.saveSettings();
					});
				ta.inputEl.rows = TEXTAREA_ROWS;
				ta.inputEl.addClass("meeting-copilot-template-input");
				// Re-poll and refresh the agenda once editing ends so newly
				// excluded events drop out without waiting for the next poll.
				this.plugin.registerDomEvent(ta.inputEl, "blur", () => {
					this.plugin.refreshCalendarNow();
					this.plugin.refreshAgenda();
				});
			});

		new Setting(containerEl)
			.setName(s.settings.excludeWithoutMeetingLink.name)
			.setDesc(s.settings.excludeWithoutMeetingLink.desc)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.excludeWithoutMeetingLink)
					.onChange(async (value) => {
						this.plugin.settings.excludeWithoutMeetingLink = value;
						await this.plugin.saveSettings();
						this.plugin.refreshCalendarNow();
						this.plugin.refreshAgenda();
					})
			);

		new Setting(containerEl)
			.setName(s.settings.groupExpandMaxMembers.name)
			.setDesc(s.settings.groupExpandMaxMembers.desc)
			.addText((text) => {
				text.inputEl.type = "number";
				text
					.setValue(String(this.plugin.settings.groupExpandMaxMembers))
					.onChange(async (value) => {
						const n = Number.parseInt(value, 10);
						this.plugin.settings.groupExpandMaxMembers =
							Number.isFinite(n) && n >= 1 ? Math.min(n, 500) : 50;
						this.plugin.resetGroupAttendeeExpansion();
						await this.plugin.saveSettings();
						this.plugin.refreshAgenda();
					});
			});

		new Setting(containerEl)
			.setName(s.settings.agendaPlacement.name)
			.setDesc(s.settings.agendaPlacement.desc)
			.addDropdown((dd) =>
				dd
					.addOption("main", s.settings.agendaPlacement.main)
					.addOption("sidebar", s.settings.agendaPlacement.sidebar)
					.setValue(this.plugin.settings.agendaPlacement)
					.onChange(async (value) => {
						this.plugin.settings.agendaPlacement =
							value === "sidebar" ? "sidebar" : "main";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(s.settings.agendaLookAhead.name)
            .setDesc(s.settings.agendaLookAhead.desc)
            .addText((text) => {
                text.inputEl.type = "number";
                text
                    .setValue(String(this.plugin.settings.agendaLookAheadDays))
                    .onChange(async (value) => {
                        const n = Number.parseInt(value, 10);
                        this.plugin.settings.agendaLookAheadDays =
                            Number.isFinite(n) && n >= 1 ? Math.min(n, 180) : 7;
                        await this.plugin.saveSettings();
                        this.plugin.refreshAgenda();
                    });
            });

        new Setting(containerEl)
            .setName(s.settings.agendaLookBack.name)
            .setDesc(s.settings.agendaLookBack.desc)
            .addText((text) => {
                text.inputEl.type = "number";
                text
                    .setValue(String(this.plugin.settings.agendaLookBackDays))
                    .onChange(async (value) => {
                        const n = Number.parseInt(value, 10);
                        this.plugin.settings.agendaLookBackDays =
                            Number.isFinite(n) && n >= 0 ? Math.min(n, 30) : 7;
                        await this.plugin.saveSettings();
                        this.plugin.refreshAgenda();
                    });
            });

        new Setting(containerEl)
            .setName(s.settings.openMeet.name)
            .setDesc(s.settings.openMeet.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.openMeetAutomatically)
                    .onChange(async (value) => {
                        this.plugin.settings.openMeetAutomatically = value;
                        await this.plugin.saveSettings();
                    })
            );
    }

    private renderDetectionTab(containerEl: HTMLElement): void {
        const s = t();

        new Setting(containerEl)
            .setName(s.settings.detectMeetings.name)
            .setDesc(s.settings.detectMeetings.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.detectMeetings)
                    .onChange(async (value) => {
                        this.plugin.settings.detectMeetings = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateDetector();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.detectZoom.name)
            .setDesc(s.settings.detectZoom.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.detectZoom)
                    .onChange(async (value) => {
                        this.plugin.settings.detectZoom = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateDetector();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.detectGoogleMeet.name)
            .setDesc(s.settings.detectGoogleMeet.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.detectGoogleMeet)
                    .onChange(async (value) => {
                        this.plugin.settings.detectGoogleMeet = value;
                        await this.plugin.saveSettings();
                        this.plugin.updateDetector();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.detectionInterval.name)
            .setDesc(s.settings.detectionInterval.desc)
            .addText((text) => {
                text.inputEl.type = "number";
                text
                    .setValue(
                        String(this.plugin.settings.detectionIntervalSeconds)
                    )
                    .onChange(async (value) => {
                        const n = Number.parseInt(value, 10);
                        this.plugin.settings.detectionIntervalSeconds =
                            Number.isFinite(n) && n >= 3 ? Math.min(n, 120) : 10;
                        await this.plugin.saveSettings();
                        this.plugin.updateDetector();
                    });
            });
    }

    private renderTranscriptionTab(containerEl: HTMLElement): void {
        // Engine + model pickers live on General; this tab keeps speaker
        // separation, language, dictionary, and automation options.
        this.renderDiarizationLanguage(containerEl);
        if (this.plugin.settings.transcriptionBackend !== "local") {
            this.renderRemoteDictionary(containerEl);
        }
        this.renderTranscriptionAutomation(containerEl);
    }

    private renderEnrichmentTab(containerEl: HTMLElement): void {
        const s = t();

        new Setting(containerEl)
            .setName(s.settings.enableEnrichment.name)
            .setDesc(s.settings.enableEnrichment.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enableEnrichment)
                    .onChange(async (value) => {
                        this.plugin.settings.enableEnrichment = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.enrichOnTranscribe.name)
            .setDesc(s.settings.enrichOnTranscribe.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enrichOnTranscribe)
                    .onChange(async (value) => {
                        this.plugin.settings.enrichOnTranscribe = value;
                        await this.plugin.saveSettings();
                    })
            );

        this.addCustomizableText(
            containerEl,
            s.settings.enrichPrompt,
            s.settings.enrichPromptCustomize.name,
            DEFAULT_ENRICH_PROMPT,
            true,
            () => this.plugin.settings.enrichPromptCustomize,
            (v) => (this.plugin.settings.enrichPromptCustomize = v),
            () => this.plugin.settings.enrichPrompt,
            (v) => (this.plugin.settings.enrichPrompt = v)
        );

        new Setting(containerEl)
            .setName(s.settings.enrichMaxTranscriptTokens.name)
            .setDesc(s.settings.enrichMaxTranscriptTokens.desc)
            .addText((text) =>
                text
                    .setPlaceholder("12000")
                    .setValue(
                        String(this.plugin.settings.enrichMaxTranscriptTokens)
                    )
                    .onChange(async (value) => {
                        const n = Number.parseInt(value.trim(), 10);
                        this.plugin.settings.enrichMaxTranscriptTokens =
                            Number.isFinite(n) && n >= 0 ? n : 12_000;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.enrichTimeoutSeconds.name)
            .setDesc(s.settings.enrichTimeoutSeconds.desc)
            .addText((text) =>
                text
                    .setPlaceholder("120")
                    .setValue(
                        String(this.plugin.settings.enrichTimeoutSeconds)
                    )
                    .onChange(async (value) => {
                        const n = Number.parseInt(value.trim(), 10);
                        this.plugin.settings.enrichTimeoutSeconds =
                            Number.isFinite(n)
                                ? Math.min(600, Math.max(60, n))
                                : 120;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.actionItemsAsTasks.name)
            .setDesc(s.settings.actionItemsAsTasks.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.actionItemsAsTasks)
                    .onChange(async (value) => {
                        this.plugin.settings.actionItemsAsTasks = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.followUpHorizonDays.name)
            .setDesc(s.settings.followUpHorizonDays.desc)
            .addText((text) =>
                text
                    .setPlaceholder("45")
                    .setValue(String(this.plugin.settings.followUpHorizonDays))
                    .onChange(async (value) => {
                        const n = Number.parseInt(value.trim(), 10);
                        if (!Number.isFinite(n) || n < 0) return;
                        this.plugin.settings.followUpHorizonDays = n;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.suggestAdhocTitle.name)
            .setDesc(s.settings.suggestAdhocTitle.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.suggestAdhocTitle)
                    .onChange(async (value) => {
                        this.plugin.settings.suggestAdhocTitle = value;
                        await this.plugin.saveSettings();
                    })
            );
    }

    /**
     * The remote (OpenAI-compatible endpoint) transcription identity rows:
     * model picker, optional fallback model, support badges, and engine-family
     * override. Shown on the General tab as part of setup.
     */
    private renderRemoteTranscription(containerEl: HTMLElement): void {
        const s = t();
        // Model id sent on the wire (dropdown once models are loaded, else free
        // text). Use "Load models" in the AI endpoint section above to
        // populate the list.
        const sttModelSetting = new Setting(containerEl)
            .setName(s.settings.sttModel.name)
            .setDesc(s.settings.sttModel.desc);
        this.addModelPicker(
            sttModelSetting,
            this.plugin.settings.sttModel,
            async (value) => {
                this.plugin.settings.sttModel = value;
                // Keep the engine family in sync with the picked model.
                this.plugin.settings.sttApiType = inferSttApiType(value);
                await this.plugin.saveSettings();
                // Update in place instead of re-rendering the whole tab (which
                // would scroll-jump back to the top): sync the engine dropdown,
                // refresh the badges, and kick off an assessment of the new
                // model.
                this.sttEngineDropdown?.setValue(this.engineDropdownValue());
                this.refreshSttBadges();
                this.maybeAssessSttModel();
            },
            // When the endpoint reports capabilities (LiteLLM), only offer
            // models it says can transcribe. Without that info (plain OpenAI),
            // no filter — the probe below determines transcription support.
            this.capabilities
                ? (id) => this.capabilities?.get(id)?.transcription === true
                : undefined
        );
        this.addFallbackModelDetails(containerEl, {
            detailsKey: "fallback-stt",
            desc: s.settings.fallbackModel.descStt,
            current: this.plugin.settings.fallbackSttModel,
            onChange: async (value) => {
                this.plugin.settings.fallbackSttModel = value;
                await this.plugin.saveSettings();
            },
            filter: this.fallbackCapabilities
                ? (id) =>
                      this.fallbackCapabilities?.get(id)?.transcription === true
                : undefined,
        });

        // Transcription support, with timestamp support shown as a sub-detail
        // beneath it (it only matters for speaker separation). Both lines live
        // in this one setting's description and are refreshed in place.
        const supportSetting = new Setting(containerEl)
            .setName(s.settings.transcriptionBadge.name)
            .addButton((button) =>
                button
                    .setButtonText(s.settings.recheckSupport.button)
                    .setTooltip(s.settings.recheckSupport.tooltip)
                    .onClick(() => this.recheckSttSupport())
            );
        supportSetting.descEl.empty();
        this.sttTranscriptionBadgeEl = supportSetting.descEl.createDiv({
            text: this.transcriptionBadgeText(s),
        });
        this.sttTimestampBadgeEl = supportSetting.descEl.createDiv({
            text: this.timestampBadgeText(s),
            cls: "mc-support-detail",
        });
        // Assess transcription + timestamp support for the current model (fires
        // once per endpoint+model per session; no-op when the endpoint isn't
        // set or a fresh verdict is already stored). The "Recheck" button above
        // force-reruns it (and reports the outcome) when a probe came back
        // inconclusive.
        this.maybeAssessSttModel();

        // Engine family = request routing/chunking. It's auto-set from the model
        // above (see the picker's onChange), so this is an advanced override,
        // only needed when a gateway's opaque model name hides which engine it
        // really is. Word timestamps are handled automatically by the probe, so
        // there's no separate "Whisper (word timestamps)" choice: the Whisper
        // engine asks for timestamps and silently falls back when unsupported.
        new Setting(containerEl)
            .setName(s.settings.sttApiType.name)
            .setDesc(s.settings.sttApiType.desc)
            .addDropdown((dd) => {
                this.sttEngineDropdown = dd;
                dd.addOption("gpt-4o-transcribe", s.settings.sttApiType.gpt4o);
                dd.addOption(
                    "gpt-4o-mini-transcribe",
                    s.settings.sttApiType.gpt4oMini
                );
                dd.addOption("whisper-1-ts", s.settings.sttApiType.whisper);
                dd.setValue(this.engineDropdownValue()).onChange(
                    async (value) => {
                        this.plugin.settings.sttApiType = STT_MODELS.includes(
                            value as SttApiType
                        )
                            ? (value as SttApiType)
                            : "gpt-4o-transcribe";
                        await this.plugin.saveSettings();
                        // Update badges in place (no full re-render / scroll
                        // jump) and re-assess against the new engine family.
                        this.refreshSttBadges();
                        this.maybeAssessSttModel();
                    }
                );
            });
    }

    /**
     * Remote-only dictionary rows (custom + GPT-assisted correction), which the
     * vendored engine's pipeline applies. Hidden under the local engine, which
     * doesn't run them.
     */
    private renderRemoteDictionary(containerEl: HTMLElement): void {
        const s = t();
        new Setting(containerEl)
            .setName(s.settings.dictionaryCorrection.name)
            .setDesc(s.settings.dictionaryCorrection.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.dictionaryCorrectionEnabled)
                    .onChange(async (value) => {
                        this.plugin.settings.dictionaryCorrectionEnabled = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.dictionary.name)
            .setDesc(s.settings.dictionary.desc)
            .addTextArea((ta) => {
                ta
                    .setPlaceholder(s.settings.dictionary.placeholder)
                    .setValue(this.plugin.settings.dictionary)
                    .onChange(async (value) => {
                        this.plugin.settings.dictionary = value;
                        await this.plugin.saveSettings();
                    });
                ta.inputEl.rows = TEXTAREA_ROWS;
                ta.inputEl.addClass("meeting-copilot-template-input");
            });

        new Setting(containerEl)
            .setName(s.settings.postProcessing.name)
            .setDesc(s.settings.postProcessing.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.postProcessingEnabled)
                    .onChange(async (value) => {
                        this.plugin.settings.postProcessingEnabled = value;
                        await this.plugin.saveSettings();
                    })
            );
    }

    /**
     * The local (on-device Whisper) transcription rows: model picker, a
     * download/status row that streams the ggml file into the plugin's models
     * dir (verified by SHA-256), and the remote-fallback toggle. Runs entirely
     * on this Mac — no audio leaves the device (issue #34).
     */
    private renderLocalTranscription(containerEl: HTMLElement): void {
        const s = t();
        const spec = localModelSpec(this.plugin.settings.localWhisperModel);

        new Setting(containerEl)
            .setName(s.settings.localModel.name)
            .setDesc(s.settings.localModel.desc)
            .addDropdown((dd) => {
                dd.selectEl.addClass("meeting-copilot-model-dropdown");
                for (const m of Object.values(LOCAL_MODELS)) {
                    dd.addOption(
                        m.id,
                        `${s.settings.localModel.option(m.id)} (${formatBytes(m.sizeBytes)})`
                    );
                }
                dd
                    .setValue(spec.id)
                    // Locked mid-download so the in-flight fetch keeps matching
                    // the model the row is showing.
                    .setDisabled(this.downloadingModel)
                    .onChange(async (value) => {
                        this.plugin.settings.localWhisperModel = value;
                        await this.plugin.saveSettings();
                        // Rebuild only the engine body so the download row
                        // reflects the new model without scroll-jumping the tab.
                        this.renderTranscriptionEngineBody();
                    });
            });

        // Download / status row. The row is held on the instance so an in-flight
        // download's progress ticks (and the final repaint) always target the
        // *current* row — a re-render (engine/model change, tab reopen) rebuilds
        // it here and progress keeps flowing rather than freezing on a detached
        // node.
        this.modelDownloadRow = new Setting(containerEl).setName(
            s.settings.localModelDownload.name
        );
        void this.repaintModelDownloadRow();

        new Setting(containerEl)
            .setName(s.settings.localFallback.name)
            .setDesc(s.settings.localFallback.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.localFallbackToRemote)
                    .onChange(async (value) => {
                        this.plugin.settings.localFallbackToRemote = value;
                        await this.plugin.saveSettings();
                        this.renderLocalFallbackModels();
                    })
            );

        this.localFallbackModelsEl = containerEl.createDiv({
            cls: "mc-local-fallback-models",
        });
        this.renderLocalFallbackModels();
    }

    /**
     * Remote + fallback STT pickers shown under “Fall back to remote” when that
     * toggle is on (local engine). Updated in place so toggling doesn't jump.
     * Both pickers are always visible here — the toggle already opted into
     * failover, so a nested collapsible would be redundant.
     */
    private renderLocalFallbackModels(): void {
        const el = this.localFallbackModelsEl;
        if (!el) return;
        el.empty();
        if (!this.plugin.settings.localFallbackToRemote) return;
        const s = t();

        this.addModelPicker(
            new Setting(el)
                .setName(s.settings.remoteFallbackModel.name)
                .setDesc(s.settings.remoteFallbackModel.desc),
            this.plugin.settings.sttModel,
            async (value) => {
                this.plugin.settings.sttModel = value;
                this.plugin.settings.sttApiType = inferSttApiType(value);
                await this.plugin.saveSettings();
            },
            this.capabilities
                ? (id) => this.capabilities?.get(id)?.transcription === true
                : undefined
        );
        this.addModelPicker(
            new Setting(el)
                .setName(s.settings.fallbackModel.summary)
                .setDesc(s.settings.fallbackModel.descStt),
            this.plugin.settings.fallbackSttModel,
            async (value) => {
                this.plugin.settings.fallbackSttModel = value;
                await this.plugin.saveSettings();
            },
            this.fallbackCapabilities
                ? (id) =>
                      this.fallbackCapabilities?.get(id)?.transcription === true
                : undefined,
            this.fallbackModels,
            { label: s.settings.fallbackModel.usePrimary }
        );
    }

    /**
     * Repaints the local model download/status row from current state: the live
     * download percentage while a download runs, else a downloaded/missing line
     * with a Delete/Download action. Targets {@link modelDownloadRow}, which
     * {@link renderLocalTranscription} keeps pointed at the on-screen row.
     */
    private async repaintModelDownloadRow(): Promise<void> {
        const row = this.modelDownloadRow;
        if (!row) return;
        const s = t();
        const spec = localModelSpec(this.plugin.settings.localWhisperModel);
        row.controlEl.empty();
        if (this.downloadingModel) {
            row.setDesc(s.settings.localModelDownload.downloading(this.downloadProgress));
            // A Cancel button so a stalled download (fetch has no idle timeout)
            // doesn't lock the Transcription section until a plugin reload.
            row.addButton((b) =>
                b
                    .setButtonText(s.settings.localModelDownload.cancel)
                    .setWarning()
                    .onClick(() => this.modelDownloadAbort?.abort())
            );
            return;
        }
        const present = await this.plugin.localModelPresent(spec);
        row.setDesc(
            present
                ? s.settings.localModelDownload.present(formatBytes(spec.sizeBytes))
                : s.settings.localModelDownload.missing(formatBytes(spec.sizeBytes))
        );
        if (present) {
            row.addButton((b) =>
                b
                    .setButtonText(s.settings.localModelDownload.delete)
                    .setWarning()
                    .onClick(async () => {
                        await this.plugin.deleteLocalModel(spec);
                        await this.repaintModelDownloadRow();
                    })
            );
        } else {
            row.addButton((b) =>
                b
                    .setButtonText(s.settings.localModelDownload.download)
                    .setCta()
                    .onClick(() => void this.startModelDownload(spec))
            );
        }
    }

    /**
     * Streams the selected local model to disk, updating the download row's
     * percentage in place (throttled to whole-percent steps) and repainting to
     * the final state when done. Guards against re-entry while a download runs;
     * the engine + model dropdowns are disabled meanwhile so `spec` stays valid.
     */
    private async startModelDownload(
        spec: ReturnType<typeof localModelSpec>
    ): Promise<void> {
        if (this.downloadingModel) return;
        this.downloadingModel = true;
        this.downloadProgress = 0;
        const abort = new AbortController();
        this.modelDownloadAbort = abort;
        // Lock the engine switch and rebuild the body so the model dropdown
        // locks and the download row shows 0% — without scrolling the tab.
        this.transcriptionEngineDropdown?.setDisabled(true);
        this.renderTranscriptionEngineBody();
        try {
            await this.plugin.ensureLocalModel(
                spec,
                (received, total) => {
                    const pct = total > 0 ? Math.floor((received / total) * 100) : 0;
                    if (pct !== this.downloadProgress) {
                        this.downloadProgress = pct;
                        this.modelDownloadRow?.setDesc(
                            t().settings.localModelDownload.downloading(pct)
                        );
                    }
                },
                abort.signal
            );
            new Notice(t().settings.localModelDownload.done);
        } catch (e) {
            // A user-initiated cancel surfaces as an AbortError; show a quiet
            // "cancelled" notice rather than a download-failed error.
            if (e instanceof Error && e.name === "AbortError") {
                new Notice(t().settings.localModelDownload.cancelled);
            } else {
                new Notice(
                    t().settings.localModelDownload.failed(
                        e instanceof Error ? e.message : String(e)
                    )
                );
            }
        } finally {
            this.downloadingModel = false;
            this.modelDownloadAbort = null;
            this.transcriptionEngineDropdown?.setDisabled(false);
            this.renderTranscriptionEngineBody();
        }
    }

    /** Speaker-separation + language rows, shared by both engines. */
    private renderDiarizationLanguage(containerEl: HTMLElement): void {
        const s = t();
        const diarizationDesc =
            this.plugin.settings.transcriptionBackend === "local"
                ? s.settings.diarization.descLocal
                : s.settings.diarization.desc;
        new Setting(containerEl)
            .setName(s.settings.diarization.name)
            .setDesc(diarizationDesc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.diarizationEnabled)
                    .onChange(async (value) => {
                        this.plugin.settings.diarizationEnabled = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.sttLanguage.name)
            .setDesc(s.settings.sttLanguage.desc)
            .addText((text) =>
                text
                    .setPlaceholder(s.settings.sttLanguage.placeholder)
                    .setValue(this.plugin.settings.sttLanguage)
                    .onChange(async (value) => {
                        this.plugin.settings.sttLanguage =
                            value.trim() || "auto";
                        await this.plugin.saveSettings();
                    })
            );
    }

    /** Automation + logging rows, shared by both engines. */
    private renderTranscriptionAutomation(containerEl: HTMLElement): void {
        const s = t();
        new Setting(containerEl)
            .setName(s.settings.autoTranscribe.name)
            .setDesc(s.settings.autoTranscribe.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.autoTranscribe)
                    .onChange(async (value) => {
                        this.plugin.settings.autoTranscribe = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.insertTranscript.name)
            .setDesc(s.settings.insertTranscript.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.insertTranscript)
                    .onChange(async (value) => {
                        this.plugin.settings.insertTranscript = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.discardSilentRecordings.name)
            .setDesc(s.settings.discardSilentRecordings.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.discardSilentRecordings)
                    .onChange(async (value) => {
                        this.plugin.settings.discardSilentRecordings = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName(s.settings.debugLogging.name)
            .setDesc(s.settings.debugLogging.desc)
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.debugLogging)
                    .onChange(async (value) => {
                        this.plugin.settings.debugLogging = value;
                        await this.plugin.saveSettings();
                    })
            );
    }

    /** Recording & notes settings. */
    private renderRecordingSettings(containerEl: HTMLElement): void {
        const s = t();

		new Setting(containerEl)
			.setName(s.settings.compressedRecordings.name)
			.setDesc(s.settings.compressedRecordings.desc)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.compressedRecordings)
					.onChange(async (value) => {
						this.plugin.settings.compressedRecordings = value;
						await this.plugin.saveSettings();
					})
			);

		this.addMicrophoneSetting(containerEl);

		this.addFolderField(
			new Setting(containerEl)
				.setName(s.settings.oneOffFolderTemplate.name)
				.setDesc(s.settings.oneOffFolderTemplate.desc),
			this.plugin.settings.oneOffFolderTemplate,
			DEFAULT_SETTINGS.oneOffFolderTemplate,
			async (value) => {
				this.plugin.settings.oneOffFolderTemplate = value;
				await this.plugin.saveSettings();
			}
		);

		this.addFolderField(
			new Setting(containerEl)
				.setName(s.settings.seriesFolderTemplate.name)
				.setDesc(s.settings.seriesFolderTemplate.desc),
			this.plugin.settings.seriesFolderTemplate,
			DEFAULT_SETTINGS.seriesFolderTemplate,
			async (value) => {
				this.plugin.settings.seriesFolderTemplate = value;
				await this.plugin.saveSettings();
			}
		);

		this.addFolderField(
			new Setting(containerEl)
				.setName(s.settings.adhocFolder.name)
				.setDesc(s.settings.adhocFolder.desc),
			this.plugin.settings.adhocFolder,
			DEFAULT_SETTINGS.adhocFolder,
			async (value) => {
				this.plugin.settings.adhocFolder = value;
				await this.plugin.saveSettings();
			}
		);

		new Setting(containerEl)
			.setName(s.settings.oneOnOneSeparately.name)
			.setDesc(s.settings.oneOnOneSeparately.desc)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.oneOnOneSeparately)
					.onChange(async (value) => {
						this.plugin.settings.oneOnOneSeparately = value;
						await this.plugin.saveSettings();
					})
			);

		this.addFolderField(
			new Setting(containerEl)
				.setName(s.settings.oneOnOneFolder.name)
				.setDesc(s.settings.oneOnOneFolder.desc),
			this.plugin.settings.oneOnOneFolder,
			DEFAULT_SETTINGS.oneOnOneFolder,
			async (value) => {
				this.plugin.settings.oneOnOneFolder = value;
				await this.plugin.saveSettings();
			}
		);

		new Setting(containerEl)
			.setName(s.settings.recordingSubfolder.name)
			.setDesc(s.settings.recordingSubfolder.desc)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.recordingSubfolder)
					.setValue(this.plugin.settings.recordingSubfolder)
					.onChange(async (value) => {
						this.plugin.settings.recordingSubfolder = value;
						await this.plugin.saveSettings();
					})
			);

		this.addCustomizableText(
			containerEl,
			s.settings.noteTitlePattern,
			s.settings.noteTitlePatternCustomize.name,
			DEFAULT_TITLE_PATTERN,
			false,
			() => this.plugin.settings.noteTitlePatternCustomize,
			(v) => (this.plugin.settings.noteTitlePatternCustomize = v),
			() => this.plugin.settings.noteTitlePattern,
			(v) => (this.plugin.settings.noteTitlePattern = v.trim())
		);

		this.addCustomizableText(
			containerEl,
			s.settings.noteTemplate,
			s.settings.noteTemplateCustomize.name,
			DEFAULT_NOTE_TEMPLATE,
			true,
			() => this.plugin.settings.noteTemplateCustomize,
			(v) => (this.plugin.settings.noteTemplateCustomize = v),
			() => this.plugin.settings.noteTemplate,
			(v) => (this.plugin.settings.noteTemplate = v)
		);

		new Setting(containerEl)
			.setName(s.settings.retentionDays.name)
			.setDesc(s.settings.retentionDays.desc)
			.addText((text) => {
				text.inputEl.type = "number";
				text
					.setValue(String(this.plugin.settings.retentionDays))
					.onChange(async (value) => {
						const n = Number.parseInt(value, 10);
						this.plugin.settings.retentionDays =
							Number.isFinite(n) && n >= 0 ? n : 0;
						await this.plugin.saveSettings();
					});
			});
    }

    /**
     * Badge text for whether the selected model can transcribe. "checking…"
     * while the assessment is in flight, then supported/not supported once a
     * verdict is stored against the current endpoint + model (a since-changed
     * URL or model invalidates it, falling back to the not-checked text).
     */
    private transcriptionBadgeText(s: Messages): string {
        const { apiBaseUrl, sttModel, sttTranscriptionSupported, sttTimestampsProbeKey } =
            this.plugin.settings;
        const currentKey = probeKey(apiBaseUrl, sttModel);
        if (this.probingKey === currentKey) {
            return s.settings.transcriptionBadge.checking;
        }
        if (sttTranscriptionSupported === null || sttTimestampsProbeKey !== currentKey) {
            return s.settings.transcriptionBadge.unknown;
        }
        return sttTranscriptionSupported
            ? s.settings.transcriptionBadge.supported
            : s.settings.transcriptionBadge.notSupported;
    }

    /**
     * Badge text for the model's segment-timestamp support. Only the Whisper
     * timestamp family asks the backend for segments at all, so any other
     * family reads as "not applicable". Within that family: "checking…" while
     * the assessment is in flight, then detected/not detected once a verdict is
     * stored against the current endpoint + model.
     */
    private timestampBadgeText(s: Messages): string {
        const {
            apiBaseUrl,
            sttModel,
            sttApiType,
            sttTimestampsSupported,
            sttTimestampsProbeKey,
        } = this.plugin.settings;
        if (!isTimestampCapableFamily(sttApiType)) {
            return s.settings.timestampBadge.notApplicable;
        }
        const currentKey = probeKey(apiBaseUrl, sttModel);
        if (this.probingKey === currentKey) {
            return s.settings.timestampBadge.checking;
        }
        if (sttTimestampsSupported === null || sttTimestampsProbeKey !== currentKey) {
            return s.settings.timestampBadge.unknown;
        }
        return sttTimestampsSupported
            ? s.settings.timestampBadge.detected
            : s.settings.timestampBadge.notDetected;
    }

    /** The value the engine dropdown should show: the retired no-timestamps "whisper-1" maps onto the single Whisper option. */
    private engineDropdownValue(): SttApiType {
        return this.plugin.settings.sttApiType === "whisper-1"
            ? "whisper-1-ts"
            : this.plugin.settings.sttApiType;
    }

    /** Updates the two STT support badges in place (no full re-render, so scroll position is kept). No-op before the badges have been rendered. */
    private refreshSttBadges(): void {
        const s = t();
        this.sttTranscriptionBadgeEl?.setText(this.transcriptionBadgeText(s));
        this.sttTimestampBadgeEl?.setText(this.timestampBadgeText(s));
    }

    /** Force-reruns the assessment for the current model (used by the "Recheck" button), clearing the once-per-session guard and reporting the outcome. */
    private recheckSttSupport(): void {
        const { apiBaseUrl, sttModel } = this.plugin.settings;
        if (!apiBaseUrl || !sttModel) {
            new Notice(t().settings.testConnection.noBaseUrl);
            return;
        }
        this.probedKeys.delete(probeKey(apiBaseUrl, sttModel));
        this.maybeAssessSttModel(true);
    }

    /**
     * Fire-and-forget assessment of the current transcription model, triggered
     * on render (so it runs on open and after a model change) and by the
     * "Recheck" button. Transcription support comes from the endpoint's
     * declared capabilities when available (LiteLLM), otherwise from a probe of
     * `/audio/transcriptions`; timestamp support is probed only for the Whisper
     * family (the only one that asks for segments). It runs at most once per
     * endpoint+model key per session (unless {@link recheckSttSupport} clears
     * the guard) so re-renders — and an "unknown" result that leaves stored
     * verdicts untouched — can't spin it into a loop. Verdicts are persisted and
     * the badges refreshed in place. When `notify` is set (manual recheck), the
     * outcome — including *why* an inconclusive probe failed — is surfaced as a
     * Notice.
     */
    private maybeAssessSttModel(notify = false): void {
        const { apiBaseUrl, apiKey, sttModel, sttApiType } =
            this.plugin.settings;
        if (!apiBaseUrl || !sttModel) return;
        const key = probeKey(apiBaseUrl, sttModel);
        const wantsTimestamps = isTimestampCapableFamily(sttApiType);
        // A fresh, complete verdict is already stored for this exact pair.
        const haveTranscription =
            this.plugin.settings.sttTimestampsProbeKey === key &&
            this.plugin.settings.sttTranscriptionSupported !== null;
        const haveTimestamps =
            !wantsTimestamps ||
            (this.plugin.settings.sttTimestampsProbeKey === key &&
                this.plugin.settings.sttTimestampsSupported !== null);
        if (haveTranscription && haveTimestamps && !notify) return;
        if (this.probedKeys.has(key) && !notify) return;
        this.probedKeys.add(key);
        this.probingKey = key;
        this.refreshSttBadges();
        void (async () => {
            let detail = "";
            try {
                const declared = this.capabilities?.get(sttModel)?.transcription;
                let transcription: boolean | null = declared ?? null;
                let timestamps: boolean | null = null;
                // Skip the probe entirely if capabilities say this model can't
                // transcribe; otherwise probe (for the transcription verdict
                // when the endpoint didn't declare one, and/or for timestamps).
                if (declared === false) {
                    timestamps = false;
                } else if (declared === undefined || wantsTimestamps) {
                    const support = await probeSttSupport({
                        baseUrl: apiBaseUrl,
                        apiKey,
                        wireModel: sttModel,
                        withTimestamps: wantsTimestamps,
                    });
                    detail = support.detail;
                    let transcriptionVerdict = support.transcription;
                    let timestampVerdict = support.timestamps;
                    // A verbose_json request that was *definitively rejected*
                    // (a 4xx model-rejected status) is ambiguous: the model may
                    // transcribe fine but reject the timestamp params. Re-probe
                    // with plain json so we don't mislabel a good Whisper model
                    // as "can't transcribe" just because it won't emit segments.
                    // Only on a hard `unsupported` — an `unknown` verbose result
                    // (5xx/429/network) is transient, and reprobing then would
                    // wrongly persist "timestamps unsupported" off a flaky call.
                    if (
                        wantsTimestamps &&
                        transcriptionVerdict === "unsupported"
                    ) {
                        const plain = await probeSttSupport({
                            baseUrl: apiBaseUrl,
                            apiKey,
                            wireModel: sttModel,
                            withTimestamps: false,
                        });
                        detail = plain.detail;
                        transcriptionVerdict = plain.transcription;
                        // If plain transcription works, the earlier rejection
                        // was the timestamps; otherwise it's genuinely not a
                        // transcription model (leave timestamps inconclusive).
                        timestampVerdict =
                            plain.transcription === "supported"
                                ? "unsupported"
                                : "unknown";
                    }
                    if (declared === undefined) {
                        transcription =
                            transcriptionVerdict === "supported"
                                ? true
                                : transcriptionVerdict === "unsupported"
                                    ? false
                                    : null;
                    }
                    if (wantsTimestamps && timestampVerdict !== "unknown") {
                        timestamps = timestampVerdict === "supported";
                    }
                }
                let changed = false;
                if (transcription !== null) {
                    this.plugin.settings.sttTranscriptionSupported =
                        transcription;
                    changed = true;
                }
                if (timestamps !== null) {
                    this.plugin.settings.sttTimestampsSupported = timestamps;
                    changed = true;
                }
                if (changed) {
                    this.plugin.settings.sttTimestampsProbeKey = key;
                    await this.plugin.saveSettings();
                }
                if (notify) {
                    new Notice(
                        this.assessmentNotice(
                            transcription,
                            timestamps,
                            wantsTimestamps,
                            detail
                        )
                    );
                }
            } finally {
                if (this.probingKey === key) this.probingKey = null;
                this.refreshSttBadges();
            }
        })();
    }

    /**
     * Builds the Notice text for a manual recheck from *this run's* verdicts
     * (not the stored flags, which can still hold a previous model's result when
     * the current probe was inconclusive). An inconclusive transcription verdict
     * is reported with its HTTP status / error so the user can see why.
     */
    private assessmentNotice(
        transcription: boolean | null,
        timestamps: boolean | null,
        wantsTimestamps: boolean,
        detail: string
    ): string {
        const s = t().settings.recheckSupport;
        if (transcription === false) return s.notTranscription;
        if (transcription === null) return s.inconclusive(detail);
        if (!wantsTimestamps) return s.transcribes;
        if (timestamps === true) return s.timestampsYes;
        if (timestamps === false) return s.timestampsNo;
        // Transcription works but the timestamp verdict was inconclusive.
        return s.transcribes;
    }

    /**
     * Microphone (input device) picker with a refresh button. The device list
     * is enumerated from the recorder helper's `list-devices`; "System default"
     * is always offered, and a saved-but-currently-absent device stays visible
     * (labelled unavailable) so it doesn't silently reset. Repaints its own row
     * in place so refreshing doesn't scroll-jump the tab.
     */
    private addMicrophoneSetting(containerEl: HTMLElement): void {
        const s = t();
        const setting = new Setting(containerEl)
            .setName(s.settings.microphone.name)
            .setDesc(s.settings.microphone.desc);

        const paint = (): void => {
            setting.controlEl.empty();
            const current = this.plugin.settings.micDeviceUid;
            const options: Record<string, string> = {
                "": s.settings.microphone.systemDefault,
            };
            for (const d of this.inputDevices) options[d.uid] = d.name;
            // Keep a stored device that isn't in the current list visible and
            // selectable (marked unavailable) rather than snapping to default.
            if (current && !options[current]) {
                options[current] = s.settings.microphone.unavailableOption(
                    this.plugin.settings.micDeviceLabel || current
                );
            }
            setting.addDropdown((dd) => {
                dd.selectEl.addClass("meeting-copilot-model-dropdown");
                dd.addOptions(options)
                    .setValue(current)
                    .onChange(async (value) => {
                        this.plugin.settings.micDeviceUid = value;
                        const match = this.inputDevices.find(
                            (d) => d.uid === value
                        );
                        if (match) {
                            this.plugin.settings.micDeviceLabel = match.name;
                        } else if (!value) {
                            // Back to system default: no label to remember.
                            this.plugin.settings.micDeviceLabel = "";
                        }
                        // Else: re-selecting a saved-but-absent device — keep
                        // the remembered label so the record-time "unavailable"
                        // notice can still name it (a blank would show the UID).
                        await this.plugin.saveSettings();
                    });
            });
            setting.addExtraButton((btn) =>
                btn
                    .setIcon("refresh-cw")
                    .setTooltip(s.settings.microphone.refresh)
                    .setDisabled(this.listingDevices)
                    .onClick(() => void this.refreshInputDevices(paint))
            );
        };

        paint();
        // Best-effort populate on open, but never trigger a helper download for
        // it — the refresh button force-ensures the binary when the user asks.
        if (this.inputDevices.length === 0 && !this.listingDevices) {
            void this.refreshInputDevices(paint, { allowDownload: false });
        }
    }

    /**
     * Enumerate input devices from the helper and repaint the picker. `repaint`
     * is called at start (to disable the button / show it's working) and on
     * completion. A best-effort load ({ allowDownload: false }) that comes back
     * empty because the binary isn't present yet leaves any existing list
     * intact; an explicit refresh replaces it.
     */
    private async refreshInputDevices(
        repaint: () => void,
        opts?: { allowDownload?: boolean }
    ): Promise<void> {
        if (this.listingDevices) return;
        this.listingDevices = true;
        repaint();
        try {
            const devices = await this.plugin.listInputDevices(opts);
            const explicit = opts?.allowDownload !== false;
            if (devices.length > 0 || explicit) {
                this.inputDevices = devices;
            }
            // Refresh the remembered label for the current selection if we can
            // see it now (a device rename, or first successful enumeration).
            const current = this.plugin.settings.micDeviceUid;
            const match = this.inputDevices.find((d) => d.uid === current);
            if (match && match.name !== this.plugin.settings.micDeviceLabel) {
                this.plugin.settings.micDeviceLabel = match.name;
                await this.plugin.saveSettings();
            }
        } finally {
            this.listingDevices = false;
            repaint();
        }
    }

    /**
     * Text field for one of the folder/template settings (one-off, series,
     * ad-hoc, 1:1), which all share the same shape: a placeholder of the
     * default value, and an empty/blank edit reverting to that default rather
     * than being saved as "".
     */
    private addFolderField(
        setting: Setting,
        current: string,
        defaultValue: string,
        onChange: (value: string) => Promise<void>
    ): void {
        setting.addText((text) =>
            text
                .setPlaceholder(defaultValue)
                .setValue(current)
                .onChange(async (value) => {
                    await onChange(value.trim() || defaultValue);
                })
        );
    }

    /**
     * Model picker used by both transcription and enrichment. Filterable
     * combobox (Obsidian {@link ModelIdSuggest}) once models are loaded via
     * "Load models"; free-text otherwise so a model id can still be typed
     * offline. An optional `filter` narrows the offered options (e.g.
     * transcription-only for the STT picker); the current value is always kept
     * selectable even if it wouldn't pass the filter.
     *
     * Pass `modelList` to use the fallback endpoint's list. When `allowEmpty`
     * is set, the list includes a "Same as primary" option that stores "".
     */
    private addModelPicker(
        setting: Setting,
        current: string,
        onChange: (value: string) => Promise<void>,
        filter?: (modelId: string) => boolean,
        modelList?: string[],
        allowEmpty?: { label: string }
    ): void {
        const source = modelList ?? this.models;
        const offered = filter ? source.filter(filter) : source;
        const hasList =
            offered.length > 0 ||
            (Boolean(current) && source.length > 0) ||
            (Boolean(allowEmpty) && source.length > 0);

        const options: ModelOption[] = [];
        if (allowEmpty) {
            options.push({ value: "", label: allowEmpty.label });
        }
        for (const m of offered) {
            options.push({ value: m, label: m });
        }
        if (current && !options.some((o) => o.value === current)) {
            options.push({ value: current, label: current });
        }

        setting.addText((text) => {
            text.inputEl.addClass("meeting-copilot-model-combobox");
            text.setPlaceholder(
                allowEmpty?.label ??
                    (hasList
                        ? t().settings.modelCombobox.placeholder
                        : t().settings.modelCombobox.placeholderEmpty)
            );
            text.setValue(current);
            if (hasList) {
                // Persist on pick or blur only — not every keystroke while the
                // user is filtering, which would write partial model ids into
                // settings and break transcription/enrichment.
                text.inputEl.addEventListener("blur", () => {
                    void onChange(text.inputEl.value.trim());
                });
                new ModelIdSuggest(
                    this.app,
                    text.inputEl,
                    () => options,
                    (value) => {
                        text.setValue(value);
                        void onChange(value);
                    }
                );
            } else {
                text.onChange(async (value) => {
                    await onChange(value.trim());
                });
            }
        });
    }

    /**
     * Collapsible fallback-model picker nested under a primary model row.
     * Uses the fallback endpoint's loaded model list when available.
     */
    private addFallbackModelDetails(
        parent: HTMLElement,
        opts: {
            detailsKey: string;
            desc: string;
            current: string;
            onChange: (value: string) => Promise<void>;
            filter?: (modelId: string) => boolean;
        }
    ): void {
        const s = t();
        const details = parent.createEl("details", {
            cls: "mc-fallback-model",
            attr: { "data-mc-details": opts.detailsKey },
        });
        details.createEl("summary", {
            text: s.settings.fallbackModel.summary,
            cls: "mc-fallback-model-summary",
        });
        // Stacked Setting (desc above control) — avoids the empty name column
        // that left a huge gap next to the picker in the default two-column row.
        const setting = new Setting(details)
            .setDesc(opts.desc)
            .setClass("mc-fallback-model-row");
        this.addModelPicker(
            setting,
            opts.current,
            opts.onChange,
            opts.filter,
            this.fallbackModels,
            { label: s.settings.fallbackModel.usePrimary }
        );
    }

    /**
     * One settings row for a "built-in default vs. custom text" setting: the
     * name/description and a Customize toggle sit on the header line, with the
     * editor on its own full-width line below. The editor is always shown but
     * *disabled* while the toggle is off (the plugin then uses the live built-in
     * `defaultValue` at runtime). Toggling only flips the editor's disabled state
     * in place — no `this.display()` — so the tab never scrolls/jumps. Enabling
     * seeds the editor with the current default the first time (only when blank),
     * so the user edits from a working base.
     */
    private addCustomizableText(
        containerEl: HTMLElement,
        labels: { name: string; desc: string },
        customizeTooltip: string,
        defaultValue: string,
        multiline: boolean,
        isOn: () => boolean,
        setOn: (value: boolean) => void,
        getValue: () => string,
        setValue: (value: string) => void
    ): void {
        let editor!: HTMLTextAreaElement | HTMLInputElement;
        const setting = new Setting(containerEl)
            .setName(labels.name)
            .setDesc(labels.desc)
            .setClass("mc-customizable")
            .addToggle((toggle) =>
                toggle
                    .setTooltip(customizeTooltip)
                    .setValue(isOn())
                    .onChange(async (on) => {
                        setOn(on);
                        if (on && !getValue().trim()) {
                            setValue(defaultValue);
                            editor.value = defaultValue;
                        }
                        editor.disabled = !on;
                        await this.plugin.saveSettings();
                    })
            );
        editor = multiline
            ? setting.settingEl.createEl("textarea", {
                  cls: "meeting-copilot-template-input",
              })
            : setting.settingEl.createEl("input", {
                  cls: "meeting-copilot-template-input",
                  attr: { type: "text" },
              });
        if (editor instanceof HTMLTextAreaElement) editor.rows = TEXTAREA_ROWS;
        // Show the built-in default as a (greyed) placeholder so a disabled/empty
        // box previews what the plugin will actually use while Customize is off.
        editor.placeholder = defaultValue;
        editor.value = getValue();
        editor.disabled = !isOn();
        editor.addEventListener("input", () => {
            // Defensive: a disabled field can't fire `input`, but never persist
            // edits while Customize is off (the runtime ignores them anyway).
            if (!isOn()) return;
            setValue(editor.value);
            void this.plugin.saveSettings();
        });
    }
}
