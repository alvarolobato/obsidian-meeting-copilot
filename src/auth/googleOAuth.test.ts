import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// `obsidian` is aliased to test/obsidian-mock.ts at runtime; import the test
// hook from that same module directly so tsc sees its types too.
import { __setRequestUrl } from "../../test/obsidian-mock";
import {
	GoogleOAuth,
	AuthInvalidatedError,
	CredentialsMissingError,
	CALENDAR_READONLY_SCOPE,
	DIRECTORY_READONLY_SCOPE,
	GROUPS_READONLY_SCOPE,
	type StoredTokens,
	type OAuthStorage,
} from "./googleOAuth";

function makeStorage(tokens: StoredTokens | null): {
	storage: OAuthStorage;
	setTokens: ReturnType<typeof vi.fn>;
} {
	let current = tokens;
	const setTokens = vi.fn(async (t: StoredTokens | null) => {
		current = t;
	});
	return {
		setTokens,
		storage: {
			getCredentials: () => ({ client_id: "id", client_secret: "sec" }),
			getTokens: () => current,
			setTokens,
			getOptionalScopes: () => [],
		},
	};
}

const expired: StoredTokens = {
	access_token: "old",
	refresh_token: "refresh",
	expires_at: 0, // already expired → forces a refresh
	scope: "scope",
};

describe("GoogleOAuth.getAccessToken", () => {
	beforeEach(() => {
		__setRequestUrl(() => ({ status: 200, json: {}, text: "" }));
	});

	it("coalesces concurrent refreshes into a single request", async () => {
		const calls = vi.fn();
		__setRequestUrl(() => {
			calls();
			return {
				status: 200,
				json: { access_token: "new", expires_in: 3600, scope: "scope" },
			};
		});
		const { storage } = makeStorage(expired);
		const oauth = new GoogleOAuth(storage);

		const [a, b, c] = await Promise.all([
			oauth.getAccessToken(),
			oauth.getAccessToken(),
			oauth.getAccessToken(),
		]);
		expect([a, b, c]).toEqual(["new", "new", "new"]);
		expect(calls).toHaveBeenCalledTimes(1);
	});

	it("clears tokens and notifies once on invalid_grant", async () => {
		__setRequestUrl(() => ({
			status: 400,
			json: { error: "invalid_grant" },
			text: '{"error":"invalid_grant"}',
		}));
		const { storage, setTokens } = makeStorage(expired);
		const onAuthExpired = vi.fn();
		const oauth = new GoogleOAuth(storage, onAuthExpired);

		await expect(oauth.getAccessToken()).rejects.toBeInstanceOf(
			AuthInvalidatedError
		);
		expect(setTokens).toHaveBeenCalledWith(null);
		expect(onAuthExpired).toHaveBeenCalledTimes(1);
	});

	it("detects invalid_grant from the body text when json.error is absent", async () => {
		__setRequestUrl(() => ({
			status: 400,
			text: 'error=invalid_grant&error_description=Token+expired',
		}));
		const { storage, setTokens } = makeStorage(expired);
		const oauth = new GoogleOAuth(storage);
		await expect(oauth.getAccessToken()).rejects.toBeInstanceOf(
			AuthInvalidatedError
		);
		expect(setTokens).toHaveBeenCalledWith(null);
	});

	it("resets the in-flight refresh so a later call retries", async () => {
		let attempt = 0;
		__setRequestUrl(() => {
			attempt++;
			if (attempt === 1) return { status: 500, text: "server error" };
			return {
				status: 200,
				json: { access_token: "second", expires_in: 3600, scope: "scope" },
			};
		});
		const { storage } = makeStorage(expired);
		const oauth = new GoogleOAuth(storage);

		await expect(oauth.getAccessToken()).rejects.toThrow(/HTTP 500/);
		// A second call must issue a fresh request (coalesce slot was cleared).
		await expect(oauth.getAccessToken()).resolves.toBe("second");
		expect(attempt).toBe(2);
	});

	it("returns the cached token without refreshing when still valid", async () => {
		const calls = vi.fn(() => ({ status: 200, json: {} }));
		__setRequestUrl(calls);
		const { storage } = makeStorage({
			...expired,
			access_token: "valid",
			expires_at: Date.now() + 10 * 60 * 1000,
		});
		const oauth = new GoogleOAuth(storage);
		await expect(oauth.getAccessToken()).resolves.toBe("valid");
		expect(calls).not.toHaveBeenCalled();
	});
});

describe("GoogleOAuth.hasCredentials / authenticate credential guard", () => {
	it("is true when the storage has bundled or user credentials", () => {
		const { storage } = makeStorage(null);
		const oauth = new GoogleOAuth(storage);
		expect(oauth.hasCredentials()).toBe(true);
	});

	it("is false when getCredentials() returns null (e.g. a community build with no bundled secret and no override)", () => {
		const storage: OAuthStorage = {
			getCredentials: () => null,
			getTokens: () => null,
			setTokens: async () => {},
			getOptionalScopes: () => [],
		};
		const oauth = new GoogleOAuth(storage);
		expect(oauth.hasCredentials()).toBe(false);
	});

	it("authenticate() throws CredentialsMissingError (not a generic Error) when credentials are missing", async () => {
		const storage: OAuthStorage = {
			getCredentials: () => null,
			getTokens: () => null,
			setTokens: async () => {},
			getOptionalScopes: () => [],
		};
		const oauth = new GoogleOAuth(storage);
		await expect(oauth.authenticate()).rejects.toBeInstanceOf(
			CredentialsMissingError
		);
	});
});

describe("GoogleOAuth.hasScope", () => {
	it("is true when the stored token's granted scope includes it", () => {
		const { storage } = makeStorage({
			...expired,
			scope:
				"https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/directory.readonly",
		});
		const oauth = new GoogleOAuth(storage);
		expect(
			oauth.hasScope(
				"https://www.googleapis.com/auth/directory.readonly"
			)
		).toBe(true);
	});

	it("is false for a scope added after the user's last consent (not in the granted string)", () => {
		const { storage } = makeStorage({
			...expired,
			scope: "https://www.googleapis.com/auth/calendar.readonly",
		});
		const oauth = new GoogleOAuth(storage);
		expect(
			oauth.hasScope(
				"https://www.googleapis.com/auth/directory.readonly"
			)
		).toBe(false);
	});

	it("is false with no stored tokens at all", () => {
		const { storage } = makeStorage(null);
		const oauth = new GoogleOAuth(storage);
		expect(oauth.hasScope("https://www.googleapis.com/auth/calendar.readonly")).toBe(
			false
		);
	});
});

describe("GoogleOAuth.authenticate cancellation", () => {
	beforeEach(() => {
		// authenticate() opens the system browser and schedules its 5-minute
		// timeout via `window.*` — stub just enough for the loopback server to
		// start and be torn down without a real browser or jsdom.
		(globalThis as unknown as { window: unknown }).window = {
			open: vi.fn(),
			setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
			clearTimeout: (id: unknown) => clearTimeout(id as Parameters<typeof clearTimeout>[0]),
		};
	});

	afterEach(() => {
		delete (globalThis as unknown as { window?: unknown }).window;
	});

	it("throws AbortError immediately if the signal is already aborted", async () => {
		const { storage } = makeStorage(null);
		const oauth = new GoogleOAuth(storage);
		const controller = new AbortController();
		controller.abort();

		await expect(oauth.authenticate(controller.signal)).rejects.toMatchObject({
			name: "AbortError",
		});
	});

	it("rejects with AbortError when cancelled while waiting on the browser redirect", async () => {
		const { storage } = makeStorage(null);
		const oauth = new GoogleOAuth(storage);
		const controller = new AbortController();

		const authPromise = oauth.authenticate(controller.signal);
		// Give the loopback server a tick to bind its ephemeral port before
		// cancelling, mirroring a user clicking "Cancel" mid-flight.
		await new Promise((r) => setTimeout(r, 10));
		controller.abort();

		await expect(authPromise).rejects.toMatchObject({ name: "AbortError" });
	});
});

describe("GoogleOAuth.authenticate scope composition", () => {
	let openedUrl = "";
	beforeEach(() => {
		openedUrl = "";
		(globalThis as unknown as { window: unknown }).window = {
			open: (url: string) => {
				openedUrl = url;
			},
			setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
			clearTimeout: (id: unknown) => clearTimeout(id as Parameters<typeof clearTimeout>[0]),
		};
	});

	afterEach(() => {
		delete (globalThis as unknown as { window?: unknown }).window;
	});

	/** Starts authenticate(), lets it open the browser, then cancels — we only
	 * need the requested URL, not a completed sign-in. */
	async function authenticateAndCaptureScope(oauth: GoogleOAuth): Promise<string | null> {
		const controller = new AbortController();
		const authPromise = oauth.authenticate(controller.signal);
		await new Promise((r) => setTimeout(r, 10));
		controller.abort();
		await expect(authPromise).rejects.toMatchObject({ name: "AbortError" });
		return new URL(openedUrl).searchParams.get("scope");
	}

	it("always includes calendar.readonly plus only the currently-enabled optional scopes", async () => {
		const { storage } = makeStorage(null);
		const oauth = new GoogleOAuth({
			...storage,
			getOptionalScopes: () => [DIRECTORY_READONLY_SCOPE],
		});
		const scope = await authenticateAndCaptureScope(oauth);
		expect(scope).toContain(CALENDAR_READONLY_SCOPE);
		expect(scope).toContain(DIRECTORY_READONLY_SCOPE);
		expect(scope).not.toContain(GROUPS_READONLY_SCOPE);
	});

	it("requests only calendar.readonly when every optional scope is turned off", async () => {
		const { storage } = makeStorage(null);
		const oauth = new GoogleOAuth({ ...storage, getOptionalScopes: () => [] });
		const scope = await authenticateAndCaptureScope(oauth);
		expect(scope).toBe(CALENDAR_READONLY_SCOPE);
	});

	it("includes both optional scopes when both are enabled", async () => {
		const { storage } = makeStorage(null);
		const oauth = new GoogleOAuth({
			...storage,
			getOptionalScopes: () => [
				GROUPS_READONLY_SCOPE,
				DIRECTORY_READONLY_SCOPE,
			],
		});
		const scope = await authenticateAndCaptureScope(oauth);
		expect(scope).toBe(
			[
				CALENDAR_READONLY_SCOPE,
				GROUPS_READONLY_SCOPE,
				DIRECTORY_READONLY_SCOPE,
			].join(" ")
		);
	});
});
