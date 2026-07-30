import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { __setRequestUrl } from "../../test/obsidian-mock";
import type { GoogleOAuth } from "../auth/googleOAuth";
import { DirectoryCache } from "./directoryCache";
import { createCloudIdentityDirectory } from "./expandGroupAttendees";
import { createPeopleDirectory, PersonNameCache } from "./personDirectory";

function fakeOauth(): GoogleOAuth {
	return {
		getAccessToken: async () => "tok",
	} as unknown as GoogleOAuth;
}

describe("directory clients HTTP 403", () => {
	beforeEach(() => {
		__setRequestUrl(() => ({ status: 200, json: {}, text: "" }));
	});
	afterEach(() => {
		__setRequestUrl(() => ({ status: 200, json: {}, text: "" }));
	});

	it("groups lookup 403 does not persist a disk negative", async () => {
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const setSpy = vi.spyOn(cache, "setGroupLookup");
		__setRequestUrl(() => ({
			status: 403,
			json: { error: { details: [{ reason: "PERMISSION_DENIED" }] } },
			text: "forbidden",
		}));
		const dir = createCloudIdentityDirectory(fakeOauth(), cache);
		await expect(dir.lookup("elg@x.com")).resolves.toBeUndefined();
		expect(setSpy).not.toHaveBeenCalled();
		expect(cache.getGroup("elg@x.com")).toBeUndefined();
	});

	it("people resolve 403 does not persist a disk negative", async () => {
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const setSpy = vi.spyOn(cache, "setPerson");
		__setRequestUrl(() => ({
			status: 403,
			json: { error: { details: [{ reason: "PERMISSION_DENIED" }] } },
			text: "forbidden",
		}));
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
		});
		await expect(
			people.resolveDisplayName("ruflin@x.com")
		).resolves.toBeUndefined();
		expect(setSpy).not.toHaveBeenCalled();
		expect(cache.getPerson("ruflin@x.com")).toBeUndefined();
	});

	it("logs a non-SERVICE_DISABLED 403 (previously silent, indistinguishable from a rate-limit skip)", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		__setRequestUrl(() => ({
			status: 403,
			json: { error: { details: [{ reason: "PERMISSION_DENIED" }] } },
			text: "forbidden",
		}));
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
		});
		await people.resolvePhotoUrl("ruflin@x.com");
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"people lookup 403 (non-SERVICE_DISABLED)"
			)
		);
		warnSpy.mockRestore();
	});

	it("throws on a Workspace-admin-policy 403 (external directory sharing disabled) instead of retrying forever", async () => {
		// Google's real response for this case has no `details`/`reason` at
		// all — only `message` — unlike the generic PERMISSION_DENIED test
		// fixture above.
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		__setRequestUrl(() => ({
			status: 403,
			json: {
				error: {
					code: 403,
					status: "PERMISSION_DENIED",
					message:
						"The G Suite domain admin has disabled external directory sharing. See more details at https://support.google.com/a/answer/6343701",
				},
			},
			text: "forbidden",
		}));
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
		});
		await expect(
			people.resolvePhotoUrl("ruflin@x.com")
		).rejects.toThrow(/Workspace admin policy/);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				"people lookup blocked by Workspace admin policy"
			)
		);
		warnSpy.mockRestore();
	});

	it("keeps skipping the network call even after the per-poll `disabled` reset (permanentlyBlocked doesn't get cleared)", async () => {
		// Regression test: runGroupAttendeeExpand resets nameCache.disabled to
		// false at the start of every background poll, to give a *transient*
		// soft-fail one retry per pass. Without a separate sticky flag, that
		// reset also silently undid the Workspace-policy circuit breaker,
		// burning one doomed network call every single poll forever.
		let networkCalls = 0;
		__setRequestUrl(() => {
			networkCalls++;
			return {
				status: 403,
				json: {
					error: {
						status: "PERMISSION_DENIED",
						message:
							"The G Suite domain admin has disabled external directory sharing. See more details at https://support.google.com/a/answer/6343701",
					},
				},
				text: "forbidden",
			};
		});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const nameCache = new PersonNameCache();
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
			nameCache,
		});

		await expect(
			people.resolvePhotoUrl("ruflin@x.com")
		).rejects.toThrow(/Workspace admin policy/);
		expect(networkCalls).toBe(1);
		expect(nameCache.permanentlyBlocked).toBe(true);

		// Simulate the next poll's per-pass reset.
		nameCache.disabled = false;

		await expect(
			people.resolvePhotoUrl("someone-else@x.com")
		).resolves.toBeUndefined();
		expect(networkCalls).toBe(1); // no second network call
	});
});
