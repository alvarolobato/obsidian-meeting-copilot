/**
 * Pure logic behind the welcome / onboarding screen, kept free of any
 * `obsidian` import so it can be unit-tested without the app. The rendering
 * lives in {@link ../ui/welcomeModal.ts}.
 */

import type { EnrichCLI } from "../enrich/cliBridge";
import { apiEnrichConfigured } from "../enrich/endpointConfig";
import { formatBytes } from "../transcribe/localModels";

/** README section explaining what the plugin downloads, and from where. */
export const HELPER_DOWNLOADS_URL =
	"https://github.com/alvarolobato/obsidian-meeting-copilot#helper-downloads";

/**
 * The download-size span across the offered local models, for the welcome
 * screen's downloads note ("190–574 MB"). Derived from the registry rather
 * than written into the copy, so adding or swapping a model can't leave the
 * welcome screen quoting stale sizes. Shares the unit when both ends use it;
 * returns "" for an empty list.
 */
export function modelDownloadSizeRange(sizes: readonly number[]): string {
	if (sizes.length === 0) return "";
	const lo = formatBytes(Math.min(...sizes));
	const hi = formatBytes(Math.max(...sizes));
	if (lo === hi) return lo;
	const [loNum, loUnit] = lo.split(" ");
	const [hiNum, hiUnit] = hi.split(" ");
	return loUnit === hiUnit ? `${loNum}–${hiNum} ${hiUnit}` : `${lo}–${hi}`;
}

/** The slice of settings that decides whether the welcome screen auto-opens. */
export interface WelcomeGateState {
	/** Plugin version that last showed the welcome screen; "" until it has. */
	welcomeShownVersion: string;
}

/**
 * Marks a vault that was set up before the welcome screen existed, so upgrading
 * doesn't show it first-install onboarding. See {@link predatesWelcome}.
 */
export const PRE_WELCOME_VERSION = "pre-welcome";

/**
 * True when `data.json` was written by a build that predates the welcome
 * screen: the vault is already set up, not a fresh install. A fresh install
 * has no `data.json` at all, so `raw` is null.
 */
export function predatesWelcome(raw: Record<string, unknown> | null): boolean {
	return raw !== null && !("welcomeShownVersion" in raw);
}

/**
 * True only on a genuinely fresh install: no `data.json` yet, so the field
 * keeps its "" default. Vaults upgrading from a build without the field are
 * stamped {@link PRE_WELCOME_VERSION} when settings load.
 *
 * Deliberately *not* a version comparison: this is a setup wizard, not a
 * changelog, so an upgrade must not re-open it. Storing the version rather
 * than a boolean keeps the door open for a "what's new" pass later without
 * another settings migration.
 */
export function shouldShowWelcome(state: WelcomeGateState): boolean {
	return !state.welcomeShownVersion;
}

/** An enrichment backend: the shared API endpoint, or one of the local CLIs. */
export type EnrichBackendId = "api" | EnrichCLI;

/**
 * Backends offered by the welcome screen's picker, in display order. Shared
 * with the settings tab's dropdown through `t().settings.enrichBackend.options`
 * so the two surfaces can't drift apart.
 */
export const ENRICH_BACKEND_OPTIONS: readonly EnrichBackendId[] = [
	"api",
	"claude-cli",
	"codex-cli",
	"opencode-cli",
	"pi-cli",
];

/** Where a given setup step stands, driving the pill next to its heading. */
export type SetupStepStatus = "done" | "pending" | "todo";

/** The live plugin state the setup tab renders from. */
export interface SetupSnapshot {
	googleAuthenticated: boolean;
	/** True while the browser consent flow is open. */
	googleAuthenticating: boolean;
	/** "api" uses the shared endpoint below; any other value is a local CLI. */
	enrichBackend: string;
	apiBaseUrl: string;
	apiKey: string;
	/** Chat model for the shared endpoint; enrichment refuses to run without one. */
	enrichModel: string;
	transcriptionBackend: "remote" | "local";
	/** Transcription-specific endpoint; empty means "reuse `apiBaseUrl`". */
	sttBaseUrl: string;
}

export function googleStepStatus(s: SetupSnapshot): SetupStepStatus {
	if (s.googleAuthenticating) return "pending";
	return s.googleAuthenticated ? "done" : "todo";
}

/**
 * A CLI backend shells out to an already-authenticated tool, so it needs no
 * endpoint from us. The API backend is "ready" exactly when
 * {@link apiEnrichConfigured} says so — the same rule the enrichment gates
 * use, so the pill can't claim Ready while enrichment refuses to run.
 */
export function llmStepStatus(s: SetupSnapshot): SetupStepStatus {
	if (s.enrichBackend !== "api") return "done";
	return apiEnrichConfigured(s) ? "done" : "todo";
}

/**
 * Transcription is on-device by default and needs nothing configured. It only
 * becomes a setup step if the user has already switched to the remote engine
 * and no endpoint (dedicated or shared) can serve it.
 */
export function transcriptionNeedsSetup(s: SetupSnapshot): boolean {
	if (s.transcriptionBackend !== "remote") return false;
	return !s.sttBaseUrl.trim() && !s.apiBaseUrl.trim();
}

/** True when nothing on the setup tab is still outstanding. */
export function setupComplete(s: SetupSnapshot): boolean {
	return (
		googleStepStatus(s) === "done" &&
		llmStepStatus(s) === "done" &&
		!transcriptionNeedsSetup(s)
	);
}
