import { afterEach, describe, expect, it, vi } from "vitest";
import { notifDebugEnabled } from "./notifLog";

describe("notifDebugEnabled (non-release build)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("is off when the flag isn't set", () => {
		vi.stubGlobal("localStorage", { getItem: () => null });
		expect(notifDebugEnabled()).toBe(false);
	});

	it("is on when the flag is set", () => {
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => (key === "mc:notif-debug" ? "1" : null),
		});
		expect(notifDebugEnabled()).toBe(true);
	});

	it("is off when localStorage is unavailable", () => {
		vi.stubGlobal("localStorage", undefined);
		expect(notifDebugEnabled()).toBe(false);
	});
});
