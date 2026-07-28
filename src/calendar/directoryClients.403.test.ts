import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { __setRequestUrl } from "../../test/obsidian-mock";
import type { GoogleOAuth } from "../auth/googleOAuth";
import { DirectoryCache } from "./directoryCache";
import { createCloudIdentityDirectory } from "./expandGroupAttendees";
import { createPeopleDirectory } from "./personDirectory";

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
});
