import { describe, it, expect } from "vitest";
import { parseDeviceList, parseStatusLines } from "./recorder";

describe("parseDeviceList", () => {
	it("parses the helper's device JSON", () => {
		const out = JSON.stringify({
			devices: [
				{ uid: "BuiltInMicrophoneDevice", name: "MacBook Pro Microphone" },
				{ uid: "AppleUSBAudio:Jabra", name: "Jabra Link 380" },
			],
		});
		expect(parseDeviceList(out)).toEqual([
			{ uid: "BuiltInMicrophoneDevice", name: "MacBook Pro Microphone" },
			{ uid: "AppleUSBAudio:Jabra", name: "Jabra Link 380" },
		]);
	});

	it("finds the JSON line among surrounding noise", () => {
		const out = [
			"some stderr-ish warning leaked to stdout",
			JSON.stringify({ devices: [{ uid: "u1", name: "Mic One" }] }),
			"",
		].join("\n");
		expect(parseDeviceList(out)).toEqual([{ uid: "u1", name: "Mic One" }]);
	});

	it("drops entries missing a uid or with the wrong shape", () => {
		const out = JSON.stringify({
			devices: [
				{ uid: "", name: "No UID" },
				{ uid: "ok", name: "Good" },
				{ name: "missing uid key" },
				{ uid: 42, name: "wrong type" },
				null,
				"nonsense",
			],
		});
		expect(parseDeviceList(out)).toEqual([{ uid: "ok", name: "Good" }]);
	});

	it("returns [] for empty, non-JSON, or device-less output", () => {
		expect(parseDeviceList("")).toEqual([]);
		expect(parseDeviceList("not json at all")).toEqual([]);
		expect(parseDeviceList("{}")).toEqual([]);
		expect(parseDeviceList(JSON.stringify({ devices: [] }))).toEqual([]);
		expect(parseDeviceList(JSON.stringify({ devices: "oops" }))).toEqual([]);
	});
});

describe("parseStatusLines", () => {
	it("parses complete JSON lines and keeps a partial trailing line", () => {
		const first = parseStatusLines(
			'{"status":"recording","file":"/a.wav"}\n{"status":"sto',
			""
		);
		expect(first.statuses).toEqual([
			{ status: "recording", file: "/a.wav" },
		]);
		expect(first.buffer).toBe('{"status":"sto');

		const second = parseStatusLines('pped"}\n', first.buffer);
		expect(second.statuses).toEqual([{ status: "stopped" }]);
		expect(second.buffer).toBe("");
	});

	it("parses CRLF-terminated JSON status lines", () => {
		const { statuses, buffer } = parseStatusLines(
			'{"status":"recording","file":"/a.wav"}\r\n',
			""
		);
		expect(statuses).toEqual([{ status: "recording", file: "/a.wav" }]);
		expect(buffer).toBe("");
	});
});
