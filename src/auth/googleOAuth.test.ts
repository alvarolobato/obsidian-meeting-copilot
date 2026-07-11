import { describe, it, expect, vi, beforeEach } from "vitest";
// `obsidian` is aliased to test/obsidian-mock.ts at runtime; import the test
// hook from that same module directly so tsc sees its types too.
import { __setRequestUrl } from "../../test/obsidian-mock";
import {
	GoogleOAuth,
	AuthInvalidatedError,
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
