# Google Calendar Auto-Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Calendar integration so that, at each non-excluded event's start time, the plugin opens any Google Meet link and shows a notification with a "録音開始" button; at the end time it shows a "録音停止" reminder.

**Architecture:** A polling + ticking scheduler caches upcoming events from the Google Calendar API and, on each ~30s tick, fires start/end callbacks when the wall clock crosses an event boundary (within a 2-minute grace window). Pure logic (filtering, Meet-link extraction, scheduling) lives in `obsidian`-free modules tested with vitest; OAuth and API I/O live in `obsidian`-importing modules verified by build. `main.ts` wires scheduler callbacks to the existing recording controls.

**Tech Stack:** TypeScript, Obsidian plugin API, Google Calendar API v3, OAuth 2.0 loopback + PKCE (ported from `obsidian-notion-dashboard`), vitest, esbuild.

**Conventions (match existing code):**
- Indentation is **tabs** (`.editorconfig`); new code uses tabs.
- Tested modules must **not** import `obsidian` (vitest runs in node env with no obsidian mock). Keep pure logic separate from I/O, mirroring `binary.ts` (pure) vs `binary-runtime.ts` (I/O).
- Dependency injection for testable units, mirroring `ProvisionerDeps`.
- Commit after each task.

**Persistence note (important):** The plugin persists state via `saveData(this.settings)`, which overwrites the entire plugin-data blob. To avoid clobbering OAuth tokens, **all** Google state lives **inside** `SystemRecordingSettings` (`googleClientId`, `googleClientSecret`, `googleTokens`). The ported `GoogleOAuth` therefore takes an injected storage object instead of reading/writing plugin data directly (deviation from the verbatim notion-dashboard port).

---

## File Structure

- Create: `src/calendar/eventFilter.ts` — `shouldRecord()`, `parseKeywords()` (pure)
- Create: `src/calendar/eventFilter.test.ts`
- Create: `src/calendar/meetLink.ts` — `extractMeetLink()` (pure)
- Create: `src/calendar/meetLink.test.ts`
- Create: `src/calendar/scheduler.ts` — `CalendarScheduler` (pure logic + injected timers/clock)
- Create: `src/calendar/scheduler.test.ts`
- Create: `src/auth/googleOAuth.ts` — OAuth class (I/O; ported, storage-injected, scope trimmed)
- Create: `src/calendar/googleCalendar.ts` — `listEvents()`, `listCalendars()` (I/O)
- Create: `src/ui/actionNotice.ts` — button-bearing `Notice` helper (I/O)
- Modify: `src/settings.ts` — add Google/calendar settings + UI
- Modify: `src/main.ts` — wire scheduler, commands, callbacks

---

## Task 1: Event filter (pure)

**Files:**
- Create: `src/calendar/eventFilter.ts`
- Test: `src/calendar/eventFilter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { shouldRecord, parseKeywords } from "./eventFilter";

describe("shouldRecord", () => {
	it("records a normal timed event when there are no keywords", () => {
		expect(shouldRecord({ summary: "Team sync", allDay: false }, [])).toBe(true);
	});

	it("never records all-day events", () => {
		expect(shouldRecord({ summary: "Holiday", allDay: true }, [])).toBe(false);
	});

	it("excludes when the title contains a keyword (case-insensitive)", () => {
		expect(shouldRecord({ summary: "1on1 with Alice", allDay: false }, ["1ON1"])).toBe(false);
	});

	it("records when no keyword matches the title", () => {
		expect(shouldRecord({ summary: "Design review", allDay: false }, ["lunch", "1on1"])).toBe(true);
	});

	it("ignores blank keywords", () => {
		expect(shouldRecord({ summary: "anything", allDay: false }, ["", "  "])).toBe(true);
	});
});

describe("parseKeywords", () => {
	it("splits on newlines and commas and trims, dropping blanks", () => {
		expect(parseKeywords("lunch, 1on1\n  break \n\n,休憩")).toEqual(["lunch", "1on1", "break", "休憩"]);
	});

	it("returns an empty array for empty input", () => {
		expect(parseKeywords("")).toEqual([]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/calendar/eventFilter.test.ts`
Expected: FAIL — cannot find module `./eventFilter`.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface FilterableEvent {
	summary: string;
	allDay: boolean;
}

/** Splits a free-text keyword box (newlines and/or commas) into trimmed, non-empty keywords. */
export function parseKeywords(raw: string): string[] {
	return raw
		.split(/[\n,]/)
		.map((k) => k.trim())
		.filter((k) => k.length > 0);
}

/**
 * Records every timed event whose title does NOT contain any exclusion keyword.
 * All-day events are never recorded.
 */
export function shouldRecord(event: FilterableEvent, exclusionKeywords: string[]): boolean {
	if (event.allDay) return false;
	const title = event.summary.toLowerCase();
	return !exclusionKeywords.some((k) => {
		const kw = k.trim().toLowerCase();
		return kw.length > 0 && title.includes(kw);
	});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/calendar/eventFilter.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/calendar/eventFilter.ts src/calendar/eventFilter.test.ts
git commit -m "feat: add calendar event filter (shouldRecord, parseKeywords)"
```

---

## Task 2: Meet link extraction (pure)

**Files:**
- Create: `src/calendar/meetLink.ts`
- Test: `src/calendar/meetLink.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { extractMeetLink } from "./meetLink";

describe("extractMeetLink", () => {
	it("prefers the top-level hangoutLink", () => {
		expect(extractMeetLink({ hangoutLink: "https://meet.google.com/abc-defg-hij" }))
			.toBe("https://meet.google.com/abc-defg-hij");
	});

	it("falls back to a video entry point in conferenceData", () => {
		expect(
			extractMeetLink({
				conferenceData: {
					entryPoints: [
						{ entryPointType: "phone", uri: "tel:+1-555" },
						{ entryPointType: "video", uri: "https://meet.google.com/xyz" },
					],
				},
			})
		).toBe("https://meet.google.com/xyz");
	});

	it("returns null when there is no conferencing info", () => {
		expect(extractMeetLink({})).toBeNull();
	});

	it("returns null when a video entry point has no uri", () => {
		expect(extractMeetLink({ conferenceData: { entryPoints: [{ entryPointType: "video" }] } })).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/calendar/meetLink.test.ts`
Expected: FAIL — cannot find module `./meetLink`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/calendar/meetLink.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/calendar/meetLink.ts src/calendar/meetLink.test.ts
git commit -m "feat: add Google Meet link extraction"
```

---

## Task 3: Calendar scheduler (poll + tick)

**Files:**
- Create: `src/calendar/scheduler.ts`
- Test: `src/calendar/scheduler.test.ts`

The scheduler stores events fetched by an injected `fetchEvents`, and on each `tick()` fires `onEventStart`/`onEventEnd` exactly once per event when the injected clock crosses the boundary within `GRACE_MS`. `start()/stop()` wire `window.setInterval`; tests drive `poll()`/`tick()` directly (no real timers).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { CalendarScheduler, GRACE_MS, ScheduledEvent, SchedulerDeps } from "./scheduler";

const T = 1_000_000_000_000; // fixed base epoch ms

function evt(over: Partial<ScheduledEvent> = {}): ScheduledEvent {
	return { id: "e1", summary: "Meeting", start: T, end: T + 3_600_000, meetLink: null, ...over };
}

function makeDeps(nowRef: { v: number }, events: ScheduledEvent[], over: Partial<SchedulerDeps> = {}): SchedulerDeps {
	return {
		now: () => nowRef.v,
		fetchEvents: async () => events,
		onEventStart: vi.fn(),
		onEventEnd: vi.fn(),
		...over,
	};
}

describe("CalendarScheduler", () => {
	it("fires onEventStart once when the clock crosses the start within grace", async () => {
		const now = { v: T - 1000 };
		const deps = makeDeps(now, [evt()]);
		const s = new CalendarScheduler(deps);
		await s.poll();

		s.tick(); // before start
		expect(deps.onEventStart).not.toHaveBeenCalled();

		now.v = T + 1000; // just after start
		s.tick();
		s.tick(); // second tick must not re-fire
		expect(deps.onEventStart).toHaveBeenCalledTimes(1);
		expect((deps.onEventStart as any).mock.calls[0][0].id).toBe("e1");
	});

	it("fires onEventEnd once when the clock crosses the end within grace", async () => {
		const now = { v: T };
		const deps = makeDeps(now, [evt()]);
		const s = new CalendarScheduler(deps);
		await s.poll();

		now.v = T + 3_600_000 + 1000; // just after end
		s.tick();
		s.tick();
		expect(deps.onEventEnd).toHaveBeenCalledTimes(1);
	});

	it("does not fire start when the boundary is older than the grace window", async () => {
		const now = { v: T + GRACE_MS + 5000 };
		const deps = makeDeps(now, [evt()]);
		const s = new CalendarScheduler(deps);
		await s.poll();
		s.tick();
		expect(deps.onEventStart).not.toHaveBeenCalled();
	});

	it("reports fetch errors via onError and keeps running", async () => {
		const now = { v: T };
		const onError = vi.fn();
		const deps = makeDeps(now, [], {
			fetchEvents: async () => {
				throw new Error("HTTP 401");
			},
			onError,
		});
		const s = new CalendarScheduler(deps);
		await s.poll();
		expect(onError).toHaveBeenCalledWith("HTTP 401");
	});

	it("prunes phase state for events no longer returned by a later poll", async () => {
		const now = { v: T + 1000 };
		let events = [evt()];
		const deps = makeDeps(now, [], { fetchEvents: async () => events });
		const s = new CalendarScheduler(deps);
		await s.poll();
		s.tick();
		expect(deps.onEventStart).toHaveBeenCalledTimes(1);

		// Same id returns again after being pruned; with a fresh phase it can fire again.
		events = [];
		await s.poll(); // prunes e1
		events = [evt()];
		await s.poll(); // e1 back
		now.v = T + 2000;
		s.tick();
		expect(deps.onEventStart).toHaveBeenCalledTimes(2);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/calendar/scheduler.test.ts`
Expected: FAIL — cannot find module `./scheduler`.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ScheduledEvent {
	id: string;
	summary: string;
	start: number; // epoch ms
	end: number; // epoch ms
	meetLink: string | null;
}

export interface SchedulerDeps {
	now: () => number;
	fetchEvents: (timeMinMs: number, timeMaxMs: number) => Promise<ScheduledEvent[]>;
	onEventStart: (event: ScheduledEvent) => void;
	onEventEnd: (event: ScheduledEvent) => void;
	onError?: (message: string) => void;
}

/** A boundary fires only if the clock is at/after it but within this window. */
export const GRACE_MS = 2 * 60 * 1000;
/** How far ahead each poll fetches events. */
export const POLL_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Default cadence for re-fetching the calendar. */
export const POLL_INTERVAL_MS = 5 * 60 * 1000;
/** Default cadence for checking event boundaries. */
export const TICK_INTERVAL_MS = 30 * 1000;

interface Phase {
	started: boolean;
	ended: boolean;
}

export class CalendarScheduler {
	private events: ScheduledEvent[] = [];
	private phase = new Map<string, Phase>();
	private pollTimer: number | null = null;
	private tickTimer: number | null = null;

	constructor(private readonly deps: SchedulerDeps) {}

	/** Fetch events into the cache and prune phase state for events no longer present. */
	async poll(): Promise<void> {
		const now = this.deps.now();
		try {
			this.events = await this.deps.fetchEvents(now - GRACE_MS, now + POLL_WINDOW_MS);
		} catch (e) {
			this.deps.onError?.(e instanceof Error ? e.message : String(e));
			return;
		}
		const ids = new Set(this.events.map((e) => e.id));
		for (const id of [...this.phase.keys()]) {
			if (!ids.has(id)) this.phase.delete(id);
		}
	}

	/** Fire start/end callbacks for any boundary crossed since the last tick. */
	tick(): void {
		const now = this.deps.now();
		for (const event of this.events) {
			const p = this.phase.get(event.id) ?? { started: false, ended: false };
			if (!p.started && now >= event.start && now - event.start < GRACE_MS) {
				p.started = true;
				this.deps.onEventStart(event);
			}
			if (!p.ended && now >= event.end && now - event.end < GRACE_MS) {
				p.ended = true;
				this.deps.onEventEnd(event);
			}
			this.phase.set(event.id, p);
		}
	}

	start(pollIntervalMs = POLL_INTERVAL_MS, tickIntervalMs = TICK_INTERVAL_MS): void {
		if (this.pollTimer !== null) return;
		void this.poll();
		this.pollTimer = window.setInterval(() => void this.poll(), pollIntervalMs);
		this.tickTimer = window.setInterval(() => this.tick(), tickIntervalMs);
	}

	stop(): void {
		if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
		if (this.tickTimer !== null) window.clearInterval(this.tickTimer);
		this.pollTimer = null;
		this.tickTimer = null;
	}

	get isRunning(): boolean {
		return this.pollTimer !== null;
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/calendar/scheduler.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: PASS (existing binary tests + new calendar tests).

- [ ] **Step 6: Commit**

```bash
git add src/calendar/scheduler.ts src/calendar/scheduler.test.ts
git commit -m "feat: add calendar scheduler with poll/tick boundary detection"
```

---

## Task 4: Google OAuth (ported, storage-injected)

**Files:**
- Create: `src/auth/googleOAuth.ts`

No unit test (network/loopback I/O); verified by build in Task 9. Ported from `obsidian-notion-dashboard/src/auth/googleOAuth.ts` with three changes: (1) scope trimmed to `calendar.readonly`; (2) credentials/tokens come from an injected `OAuthStorage` instead of `plugin.loadData()`; (3) node `http`/`url` imported statically (esbuild externalizes builtins).

- [ ] **Step 1: Create the file**

```ts
import { Notice, Platform, requestUrl } from "obsidian";
import * as http from "http";
import * as nodeUrl from "url";

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

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export class GoogleOAuth {
	constructor(private readonly storage: OAuthStorage) {}

	isAuthenticated(): boolean {
		return this.storage.getTokens() !== null;
	}

	/** Returns a valid access token, refreshing if it expires within 60s. */
	async getAccessToken(): Promise<string> {
		const tokens = this.storage.getTokens();
		if (!tokens) throw new Error("認証されていません。コマンドパレットで認証してください。");
		if (Date.now() < tokens.expires_at - 60_000) {
			return tokens.access_token;
		}
		return await this.refresh(tokens);
	}

	private async refresh(tokens: StoredTokens): Promise<string> {
		const creds = this.storage.getCredentials();
		if (!creds) throw new Error("OAuth credentials が未設定です。");
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

	/** Loopback + PKCE flow: opens the browser, captures the code locally, exchanges for tokens. Desktop only. */
	async authenticate(): Promise<void> {
		if (!Platform.isDesktop) {
			throw new Error("OAuth認証はデスクトップ版のみ対応です。");
		}
		const creds = this.storage.getCredentials();
		if (!creds) {
			throw new Error("先に OAuth Client ID / Secret を設定してください。");
		}

		const codeVerifier = randomString(32);
		const codeChallenge = await sha256Base64Url(codeVerifier);
		const state = randomString(16);

		const { port, codePromise, close } = await startLoopbackServer(state);
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
		new Notice("ブラウザで Google 認証を開きます…");
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
			throw new Error(
				"refresh_token が返ってきません。OAuth 同意画面のテストユーザーに自分を追加して再試行してください。"
			);
		}
		await this.storage.setTokens({
			access_token: json.access_token,
			refresh_token: json.refresh_token,
			expires_at: Date.now() + json.expires_in * 1000,
			scope: json.scope,
		});
		new Notice("✅ Google Calendar 認証完了");
	}
}

interface LoopbackResult {
	port: number;
	codePromise: Promise<string>;
	close: () => void;
}

function startLoopbackServer(expectedState: string): Promise<LoopbackResult> {
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
					res.end(`<h1>OAuth エラー</h1><p>${String(q.error)}</p>`);
					rejectCode(new Error(`OAuth error: ${String(q.error)}`));
					return;
				}
				if (q.state !== expectedState) {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(`<h1>state 不一致</h1>`);
					rejectCode(new Error("OAuth state mismatch"));
					return;
				}
				if (typeof q.code !== "string") {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(`<h1>code がありません</h1>`);
					rejectCode(new Error("OAuth code missing"));
					return;
				}
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(
					`<!doctype html><html><head><title>認証完了</title></head><body style="font-family:system-ui;padding:40px;text-align:center;"><h1>✅ 認証完了</h1><p>このタブを閉じて Obsidian に戻ってください。</p></body></html>`
				);
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
			const timer = setTimeout(() => {
				rejectCode(new Error("認証がタイムアウトしました (5分)。"));
			}, 5 * 60 * 1000);
			const close = () => {
				clearTimeout(timer);
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
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/auth/googleOAuth.ts
git commit -m "feat: add Google OAuth (loopback + PKCE, calendar.readonly)"
```

---

## Task 5: Google Calendar API adapter

**Files:**
- Create: `src/calendar/googleCalendar.ts`

No unit test (network I/O); the pure parts (`extractMeetLink`) are already tested. Uses `extractMeetLink` from Task 2.

- [ ] **Step 1: Create the file**

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/calendar/googleCalendar.ts
git commit -m "feat: add Google Calendar API adapter with Meet link extraction"
```

---

## Task 6: Action notice helper

**Files:**
- Create: `src/ui/actionNotice.ts`

No unit test (DOM/Notice I/O); verified by build and manual testing.

- [ ] **Step 1: Create the file**

```ts
import { Notice } from "obsidian";

/**
 * Shows a persistent Notice (no auto-timeout) with a single action button.
 * Clicking the button runs `onClick` and dismisses the notice.
 */
export function actionNotice(message: string, buttonLabel: string, onClick: () => void): Notice {
	const frag = document.createDocumentFragment();
	const container = frag.createDiv();
	container.createSpan({ text: message });
	const btn = container.createEl("button", { text: buttonLabel, cls: "mod-cta" });
	btn.style.marginInlineStart = "8px";
	const notice = new Notice(frag, 0);
	btn.addEventListener("click", () => {
		onClick();
		notice.hide();
	});
	return notice;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/actionNotice.ts
git commit -m "feat: add action notice helper with button"
```

---

## Task 7: Settings — Google/calendar fields and UI

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Replace the settings interface and defaults**

Replace lines 1–12 of `src/settings.ts` with:

```ts
import { App, PluginSettingTab, Setting } from "obsidian";
import SystemRecordingPlugin from "./main";
import type { StoredTokens } from "./auth/googleOAuth";

export interface SystemRecordingSettings {
	recordingFolder: string;
	fileNameTemplate: string;
	googleClientId: string;
	googleClientSecret: string;
	googleTokens: StoredTokens | null;
	calendarAutoRecord: boolean;
	calendarId: string;
	exclusionKeywords: string;
	openMeetAutomatically: boolean;
}

export const DEFAULT_SETTINGS: SystemRecordingSettings = {
	recordingFolder: "recordings",
	fileNameTemplate: "recording-YYYY-MM-DD-HHmmss",
	googleClientId: "",
	googleClientSecret: "",
	googleTokens: null,
	calendarAutoRecord: false,
	calendarId: "primary",
	exclusionKeywords: "",
	openMeetAutomatically: true,
};
```

- [ ] **Step 2: Append the calendar settings UI inside `display()`**

In `src/settings.ts`, inside `display()`, after the existing "File name template" `Setting` block (before the closing `}` of `display()`), add:

```ts
		containerEl.createEl("h3", { text: "Google カレンダー連携" });

		new Setting(containerEl)
			.setName("OAuth Client ID")
			.setDesc("Google Cloud で作成した OAuth クライアントの Client ID。")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.googleClientId)
					.onChange(async (value) => {
						this.plugin.settings.googleClientId = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("OAuth Client Secret")
			.setDesc("OAuth クライアントの Client Secret。")
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
			.setName("Google 認証")
			.setDesc(
				this.plugin.isCalendarAuthenticated()
					? "認証済み。再認証するとトークンを更新します。"
					: "未認証。Client ID / Secret を設定してから認証してください。"
			)
			.addButton((btn) =>
				btn
					.setButtonText(
						this.plugin.isCalendarAuthenticated() ? "再認証" : "認証する"
					)
					.setCta()
					.onClick(async () => {
						await this.plugin.authenticateCalendar();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("カレンダー自動録音")
			.setDesc("予定の開始時刻に録音開始の通知を出します。")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.calendarAutoRecord)
					.onChange(async (value) => {
						this.plugin.settings.calendarAutoRecord = value;
						await this.plugin.saveSettings();
						this.plugin.updateScheduler();
					})
			);

		new Setting(containerEl)
			.setName("対象カレンダー ID")
			.setDesc("監視するカレンダーの ID。既定の primary はメインカレンダー。")
			.addText((text) =>
				text
					.setPlaceholder("primary")
					.setValue(this.plugin.settings.calendarId)
					.onChange(async (value) => {
						this.plugin.settings.calendarId = value.trim() || "primary";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("除外キーワード")
			.setDesc("タイトルにこれらの語を含む予定は録音しません（改行またはカンマ区切り、大文字小文字無視）。")
			.addTextArea((ta) =>
				ta
					.setValue(this.plugin.settings.exclusionKeywords)
					.onChange(async (value) => {
						this.plugin.settings.exclusionKeywords = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Meet を自動で開く")
			.setDesc("予定の開始時刻に Google Meet リンクをブラウザで開きます。")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openMeetAutomatically)
					.onChange(async (value) => {
						this.plugin.settings.openMeetAutomatically = value;
						await this.plugin.saveSettings();
					})
			);
```

> Note: `isCalendarAuthenticated()`, `authenticateCalendar()`, and `updateScheduler()` are added to `main.ts` in Task 8. Implement Task 8 before building.

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat: add Google calendar settings fields and UI"
```

---

## Task 8: Wire scheduler, commands, and callbacks in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add imports**

At the top of `src/main.ts`, after the existing imports (after `import * as path from "path";` on line 10), add:

```ts
import { GoogleOAuth } from "./auth/googleOAuth";
import { listEvents } from "./calendar/googleCalendar";
import { shouldRecord, parseKeywords } from "./calendar/eventFilter";
import { CalendarScheduler, ScheduledEvent } from "./calendar/scheduler";
import { actionNotice } from "./ui/actionNotice";
```

- [ ] **Step 2: Add fields**

In the `SystemRecordingPlugin` class body, after `private ribbonIconEl: HTMLElement | null = null;` (line 20), add:

```ts
	private oauth = new GoogleOAuth({
		getCredentials: () => {
			const id = this.settings.googleClientId.trim();
			const secret = this.settings.googleClientSecret.trim();
			return id && secret ? { client_id: id, client_secret: secret } : null;
		},
		getTokens: () => this.settings.googleTokens,
		setTokens: async (tokens) => {
			this.settings.googleTokens = tokens;
			await this.saveSettings();
		},
	});
	private scheduler: CalendarScheduler | null = null;
```

- [ ] **Step 3: Register commands and start the scheduler in `onload()`**

In `onload()`, after the `this.addSettingTab(...)` call (line 50), add:

```ts
		this.addCommand({
			id: "authenticate-google-calendar",
			name: "Authenticate Google Calendar",
			callback: () => void this.authenticateCalendar(),
		});

		this.addCommand({
			id: "toggle-calendar-auto-recording",
			name: "Toggle calendar auto-recording",
			callback: async () => {
				this.settings.calendarAutoRecord = !this.settings.calendarAutoRecord;
				await this.saveSettings();
				this.updateScheduler();
				new Notice(
					this.settings.calendarAutoRecord
						? "カレンダー自動録音: ON"
						: "カレンダー自動録音: OFF"
				);
			},
		});
```

Then at the very end of `onload()` (after the recorder callbacks on line 56), add:

```ts
		this.updateScheduler();
```

- [ ] **Step 4: Stop the scheduler in `onunload()`**

In `onunload()`, after `this.clearDurationTimer();` (line 63), add:

```ts
		this.scheduler?.stop();
```

- [ ] **Step 5: Add the calendar methods**

After the `stopRecording()` method (after line 154, before the `// MARK: - Status handling` comment), add:

```ts
	// MARK: - Calendar integration

	isCalendarAuthenticated(): boolean {
		return this.oauth.isAuthenticated();
	}

	async authenticateCalendar(): Promise<void> {
		try {
			await this.oauth.authenticate();
			this.updateScheduler();
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}

	/** Starts the scheduler when auto-record is on and authenticated; stops it otherwise. */
	updateScheduler(): void {
		const shouldRun =
			this.settings.calendarAutoRecord && this.oauth.isAuthenticated();
		if (shouldRun) {
			if (!this.scheduler) {
				this.scheduler = new CalendarScheduler({
					now: () => Date.now(),
					fetchEvents: (minMs, maxMs) => this.fetchCalendarEvents(minMs, maxMs),
					onEventStart: (event) => this.handleEventStart(event),
					onEventEnd: (event) => this.handleEventEnd(event),
					onError: (message) => new Notice(`Calendar error: ${message}`),
				});
			}
			if (!this.scheduler.isRunning) this.scheduler.start();
		} else {
			this.scheduler?.stop();
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
			new Date(maxMs)
		);
		const keywords = parseKeywords(this.settings.exclusionKeywords);
		return events
			.filter((e) => shouldRecord({ summary: e.summary, allDay: e.allDay }, keywords))
			.map((e) => ({
				id: e.id,
				summary: e.summary,
				start: e.start.getTime(),
				end: e.end.getTime(),
				meetLink: e.meetLink,
			}));
	}

	private handleEventStart(event: ScheduledEvent): void {
		if (event.meetLink && this.settings.openMeetAutomatically) {
			window.open(event.meetLink, "_blank");
		}
		actionNotice(`「${event.summary}」が始まりました`, "録音開始", () => {
			void this.startRecording();
		});
	}

	private handleEventEnd(event: ScheduledEvent): void {
		actionNotice(`「${event.summary}」が終了しました`, "録音停止", () => {
			this.stopRecording();
		});
	}
```

> Note: `startRecording()` and `stopRecording()` are existing private methods; the new methods are in the same class so access is fine.

- [ ] **Step 6: Type-check and build**

Run: `npm run build`
Expected: `tsc` passes and esbuild writes `main.js` with no errors.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: no errors. (If `obsidianmd/ui/sentence-case` flags Japanese/CTA strings, add a targeted `// eslint-disable-next-line` like the existing settings file does — do not change rule config.)

- [ ] **Step 8: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire calendar scheduler, commands, and event callbacks"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — existing `binary.test.ts` plus `eventFilter`, `meetLink`, `scheduler` tests.

- [ ] **Step 2: Build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed, `main.js` regenerated.

- [ ] **Step 3: Manual smoke test (record in the plan, perform if a vault is available)**

Deploy `main.js` + `manifest.json` to a test vault's `.obsidian/plugins/system-recording/` and verify:
1. Settings show the Google section; entering Client ID/Secret then "認証する" opens the browser, completes consent, and the desc flips to "認証済み".
2. Turning on "カレンダー自動録音" with a near-future calendar event produces, at start time: the Meet link opening (if present) and a "「…」が始まりました" notice with a "録音開始" button that starts recording.
3. At the event's end time, a "「…」が終了しました" notice with a "録音停止" button stops the recording.
4. An event whose title contains an exclusion keyword does **not** trigger a notice.

- [ ] **Step 4: Commit any fixes from verification**

```bash
git add -A
git commit -m "fix: address issues found during calendar integration verification"
```

(Skip if there were no fixes.)

---

## Self-Review (completed by plan author)

- **Spec coverage:** OAuth/BYO (Task 4 + Task 7 fields) ✓; reuse of notion-dashboard pattern (Task 4) ✓; exclusion-keyword filter incl. all-day exclusion (Task 1) ✓; manual start via start notice (Task 8 `handleEventStart`) ✓; auto-open Meet at start (Task 8) ✓; manual stop via end notice (Task 8 `handleEventEnd`) ✓; polling + tick detection with grace (Task 3) ✓; single calendar default primary (Task 7) ✓; settings (creds, auth button, toggle, calendar id, keywords, Meet toggle) (Task 7) ✓; commands (authenticate, toggle) (Task 8) ✓; error handling (auth/refresh/API/Meet) (Tasks 4,5,8) ✓; tests for shouldRecord/extractMeetLink/scheduler (Tasks 1,2,3) ✓.
- **Persistence:** All Google state stored inside `SystemRecordingSettings` so `saveData(this.settings)` cannot clobber tokens; OAuth uses injected `OAuthStorage`.
- **Type consistency:** `ScheduledEvent` shape identical in Task 3 and Task 8; `GCalEvent.meetLink` (Task 5) maps to `ScheduledEvent.meetLink` (Task 8); `extractMeetLink`/`RawConferenceEvent` shared between Task 2 and Task 5; `StoredTokens` shared between Task 4 and Task 7; method names `isCalendarAuthenticated`/`authenticateCalendar`/`updateScheduler` consistent between Task 7 (callers) and Task 8 (definitions).
- **Placeholder scan:** No TBDs; every code step is complete.
