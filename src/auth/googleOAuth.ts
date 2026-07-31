import { Notice, Platform, requestUrl } from "obsidian";
import * as http from "http";
import * as nodeUrl from "url";
import { t } from "../i18n";

export interface OAuthCredentials {
	client_id: string;
	client_secret: string;
}

export interface StoredTokens {
	access_token: string;
	refresh_token: string;
	expires_at: number;
	scope: string;
}

/** Persistence is injected so all Google state can live inside the plugin's settings blob. */
export interface OAuthStorage {
	getCredentials(): OAuthCredentials | null;
	getTokens(): StoredTokens | null;
	setTokens(tokens: StoredTokens | null): Promise<void>;
}

/**
 * Thrown when the refresh token is permanently dead (`invalid_grant`: revoked,
 * expired 7-day "Testing" token, password change, …). Stored tokens are cleared
 * before this is thrown, so `isAuthenticated()` flips to false and callers can
 * surface a single "reconnect" prompt instead of looping on the raw error.
 */
export class AuthInvalidatedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthInvalidatedError";
	}
}

/**
 * Thrown when neither a bundled nor a user-provided OAuth client id/secret is
 * available (e.g. a community build compiled without bundled credentials, and
 * the user hasn't entered their own yet). Distinct from a generic `Error` so
 * callers can react by guiding the user to where credentials are entered,
 * rather than just showing an inert error message.
 */
export class CredentialsMissingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CredentialsMissingError";
	}
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
/**
 * Calendar events, Cloud Identity Groups (read-only), People directory
 * (read-only), and the user's own "Other contacts" (read-only). Groups
 * expands group invitees into people; the directory scope resolves display
 * names from the org directory when Calendar omits them — subject to the
 * Workspace admin's directory-sharing setting, which some domains disable
 * entirely for third-party apps. `contacts.other.readonly` is a second,
 * independent path to the same kind of data (display names) via the user's
 * own personal "Other contacts" (auto-populated from Gmail correspondence) —
 * that data is private to the user, not the org Directory, so it isn't
 * subject to that admin setting. Admin Directory scopes are intentionally
 * not requested.
 */
const SCOPE = [
	"https://www.googleapis.com/auth/calendar.readonly",
	"https://www.googleapis.com/auth/cloud-identity.groups.readonly",
	"https://www.googleapis.com/auth/directory.readonly",
	"https://www.googleapis.com/auth/contacts.other.readonly",
].join(" ");

/** Scope string for the personal "Other contacts" read (display names), used
 * by {@link GoogleOAuth.hasScope} to check whether a re-auth is still needed
 * (existing tokens predate this scope until the user reconnects). */
export const CONTACTS_OTHER_READONLY_SCOPE =
	"https://www.googleapis.com/auth/contacts.other.readonly";

export class GoogleOAuth {
	/** Shared in-flight refresh so concurrent callers (scheduler + agenda) don't double-refresh. */
	private refreshing: Promise<string> | null = null;

	/**
	 * @param storage token/credential persistence.
	 * @param onAuthExpired fired once when the refresh token is invalidated (after
	 *   tokens are cleared), so the host can stop polling and prompt to reconnect.
	 */
	constructor(
		private readonly storage: OAuthStorage,
		private readonly onAuthExpired?: () => void
	) {}

	isAuthenticated(): boolean {
		return this.storage.getTokens() !== null;
	}

	/** Whether a usable client id/secret pair (bundled or user-provided) is
	 * currently available — false for a community build with no bundled
	 * credentials until the user enters their own. */
	hasCredentials(): boolean {
		return this.storage.getCredentials() !== null;
	}

	/** Whether the currently-stored tokens were granted the given scope.
	 * Google echoes the actually-granted scope string on every token
	 * response, so a scope added after the user's last consent shows up as
	 * absent here until they reconnect — checking this avoids an API call
	 * that's certain to fail with "insufficient authentication scopes". */
	hasScope(scope: string): boolean {
		const granted = this.storage.getTokens()?.scope ?? "";
		return granted.split(/\s+/).includes(scope);
	}

	/** Returns a valid access token, refreshing if it expires within 60s. */
	async getAccessToken(): Promise<string> {
		const tokens = this.storage.getTokens();
		if (!tokens) throw new Error(t().oauth.notAuthenticated);
		if (Date.now() < tokens.expires_at - 60_000) {
			return tokens.access_token;
		}
		// Coalesce parallel refreshes into one network round-trip.
		if (!this.refreshing) {
			this.refreshing = this.refresh(tokens).finally(() => {
				this.refreshing = null;
			});
		}
		return this.refreshing;
	}

	private async refresh(tokens: StoredTokens): Promise<string> {
		const creds = this.storage.getCredentials();
		if (!creds) throw new Error(t().oauth.credentialsNotSet);
		const body = new URLSearchParams({
			client_id: creds.client_id,
			client_secret: creds.client_secret,
			refresh_token: tokens.refresh_token,
			grant_type: "refresh_token",
		}).toString();
		const res = await requestUrl({
			url: TOKEN_URL,
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
			throw: false,
		});
		if (res.status >= 400) {
			// A dead refresh token is unrecoverable: clear it so the app stops
			// retrying forever and can prompt the user to reconnect.
			const errorCode = (res.json as { error?: string } | undefined)?.error;
			if (
				res.status === 400 &&
				(errorCode === "invalid_grant" ||
					/invalid_grant/.test(res.text ?? ""))
			) {
				await this.storage.setTokens(null);
				this.onAuthExpired?.();
				throw new AuthInvalidatedError(t().oauth.sessionExpired);
			}
			throw new Error(`Token refresh failed: HTTP ${res.status} ${res.text}`);
		}
		const json = res.json as { access_token: string; expires_in: number; scope: string };
		const next: StoredTokens = {
			access_token: json.access_token,
			refresh_token: tokens.refresh_token,
			expires_at: Date.now() + json.expires_in * 1000,
			scope: json.scope ?? tokens.scope,
		};
		await this.storage.setTokens(next);
		return next.access_token;
	}

	/**
	 * Loopback + PKCE flow: opens the browser, captures the code locally,
	 * exchanges for tokens. Desktop only. `signal`, if given, lets a caller
	 * abandon an in-flight attempt (e.g. a "Cancel" button) — otherwise the
	 * only way out of a stalled/abandoned browser consent is the 5-minute
	 * timeout below.
	 */
	async authenticate(signal?: AbortSignal): Promise<void> {
		if (!Platform.isDesktop) {
			throw new Error(t().oauth.desktopOnly);
		}
		const creds = this.storage.getCredentials();
		if (!creds) {
			throw new CredentialsMissingError(t().oauth.setCredentialsFirst);
		}
		if (signal?.aborted) {
			throw new DOMException("Aborted", "AbortError");
		}

		const codeVerifier = randomString(32);
		const codeChallenge = await sha256Base64Url(codeVerifier);
		const state = randomString(16);

		const { port, codePromise, close } = await startLoopbackServer(state, signal);
		const redirectUri = `http://127.0.0.1:${port}/callback`;

		const authParams = new URLSearchParams({
			client_id: creds.client_id,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: SCOPE,
			access_type: "offline",
			prompt: "consent",
			state,
			code_challenge: codeChallenge,
			code_challenge_method: "S256",
		});
		new Notice(t().oauth.openingBrowser);
		window.open(`${AUTH_URL}?${authParams.toString()}`, "_blank");

		let code: string;
		try {
			code = await codePromise;
		} finally {
			close();
		}

		const body = new URLSearchParams({
			client_id: creds.client_id,
			client_secret: creds.client_secret,
			code,
			code_verifier: codeVerifier,
			grant_type: "authorization_code",
			redirect_uri: redirectUri,
		}).toString();
		const res = await requestUrl({
			url: TOKEN_URL,
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
			throw: false,
		});
		if (res.status >= 400) {
			throw new Error(`Token exchange failed: HTTP ${res.status} ${res.text}`);
		}
		const json = res.json as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
			scope: string;
		};
		if (!json.refresh_token) {
			throw new Error(t().oauth.noRefreshToken);
		}
		await this.storage.setTokens({
			access_token: json.access_token,
			refresh_token: json.refresh_token,
			expires_at: Date.now() + json.expires_in * 1000,
			scope: json.scope,
		});
		new Notice(t().oauth.authComplete);
	}
}

interface LoopbackResult {
	port: number;
	codePromise: Promise<string>;
	close: () => void;
}

function startLoopbackServer(
	expectedState: string,
	signal?: AbortSignal
): Promise<LoopbackResult> {
	return new Promise((resolve, reject) => {
		let resolveCode!: (code: string) => void;
		let rejectCode!: (err: Error) => void;
		const codePromise = new Promise<string>((rc, rj) => {
			resolveCode = rc;
			rejectCode = rj;
		});

		const server = http.createServer((req, res) => {
			try {
				const parsed = nodeUrl.parse(req.url ?? "", true);
				if (parsed.pathname !== "/callback") {
					res.writeHead(404);
					res.end();
					return;
				}
				const q = parsed.query;
				if (q.error) {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(t().oauth.htmlError(escapeHtml(String(q.error))));
					rejectCode(new Error(`OAuth error: ${String(q.error)}`));
					return;
				}
				if (q.state !== expectedState) {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(t().oauth.htmlStateMismatch);
					rejectCode(new Error("OAuth state mismatch"));
					return;
				}
				if (typeof q.code !== "string") {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(t().oauth.htmlCodeMissing);
					rejectCode(new Error("OAuth code missing"));
					return;
				}
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(t().oauth.htmlSuccess);
				resolveCode(q.code);
			} catch (e) {
				rejectCode(e as Error);
			}
		});

		server.on("error", (e) => reject(e));

		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (typeof addr === "string" || addr === null) {
				reject(new Error("Failed to determine loopback port"));
				return;
			}
			const timer = window.setTimeout(() => {
				rejectCode(new Error(t().oauth.timeout));
			}, 5 * 60 * 1000);
			const onAbort = () => {
				rejectCode(new DOMException("Aborted", "AbortError"));
			};
			signal?.addEventListener("abort", onAbort);
			const close = () => {
				window.clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				server.close();
			};
			resolve({ port: addr.port, codePromise, close });
		});
	});
}

function randomString(len: number): string {
	const arr = new Uint8Array(len);
	crypto.getRandomValues(arr);
	return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Base64Url(input: string): Promise<string> {
	const buf = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest("SHA-256", buf);
	return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
