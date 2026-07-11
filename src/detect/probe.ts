import { execFile } from "child_process";

/**
 * macOS signals for an *ongoing* meeting (not just a running app).
 *
 * - Zoom: the `CptHost` helper process only runs while you're in a call, so it's
 *   a far better signal than the always-running `zoom.us`.
 * - Google Meet: scan open browser tabs for a live meet.google.com meeting.
 *
 * Teams/Webex "in a meeting" needs CoreAudio (Tier 2) to be reliable, so they're
 * intentionally omitted here to avoid the false positives of process presence.
 */

function run(cmd: string, args: string[], timeoutMs = 5000): Promise<{ ok: boolean; stdout: string }> {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: timeoutMs }, (err, stdout) => {
			resolve({ ok: !err, stdout: (stdout ?? "").toString() });
		});
	});
}

/** True when a Zoom meeting is in progress (the `CptHost` subprocess is alive). */
export async function zoomInMeeting(): Promise<boolean> {
	// pgrep exits 0 when a matching process exists.
	const { ok } = await run("pgrep", ["-x", "CptHost"]);
	return ok;
}

// AppleScript: is any supported browser showing a live Google Meet tab?
const GOOGLE_MEET_SCRIPT = `
set meetFound to false
tell application "System Events"
	set browserNames to {"Google Chrome", "Brave Browser", "Microsoft Edge", "Arc"}
	repeat with browserName in browserNames
		if exists (process browserName) then
			try
				tell application browserName
					repeat with w in windows
						repeat with t in tabs of w
							if URL of t contains "meet.google.com/" and (URL of t does not end with "meet.google.com/") then
								set meetFound to true
								exit repeat
							end if
						end repeat
						if meetFound then exit repeat
					end repeat
				end tell
			end try
		end if
		if meetFound then exit repeat
	end repeat
end tell
if meetFound then
	return "true"
else
	return "false"
end if
`;

/**
 * True when a browser has an active Google Meet call open. Requires macOS
 * Automation permission for Obsidian to control the browser (prompted once).
 */
export async function googleMeetActive(): Promise<boolean> {
	const { ok, stdout } = await run("osascript", ["-e", GOOGLE_MEET_SCRIPT]);
	return ok && stdout.trim() === "true";
}
