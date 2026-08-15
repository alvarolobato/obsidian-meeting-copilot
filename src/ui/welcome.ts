/**
 * Pure logic behind the welcome / onboarding screen, kept free of any
 * `obsidian` import so it can be unit-tested without the app. The rendering
 * lives in {@link ../ui/welcomeModal.ts}.
 */

/** The slice of settings that decides whether the welcome screen auto-opens. */
export interface WelcomeGateState {
	/** Plugin version that last showed the welcome screen; "" until it has. */
	welcomeShownVersion: string;
}

/**
 * True only on a genuinely fresh install — `data.json` absent (so the field
 * falls back to its "" default) or written by a build that predates it.
 *
 * Deliberately *not* a version comparison: this is a setup wizard, not a
 * changelog, so an upgrade must not re-open it. Storing the version rather
 * than a boolean keeps the door open for a "what's new" pass later without
 * another settings migration.
 */
export function shouldShowWelcome(state: WelcomeGateState): boolean {
	return !state.welcomeShownVersion;
}

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
 * endpoint from us. The API backend only needs a base URL — the key is
 * legitimately blank for local servers (Ollama, LM Studio), so requiring one
 * would show a permanent "todo" to users who are in fact fully set up.
 */
export function llmStepStatus(s: SetupSnapshot): SetupStepStatus {
	if (s.enrichBackend !== "api") return "done";
	return s.apiBaseUrl.trim() ? "done" : "todo";
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
