import { ChildProcess, spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import type { RecordingFormat } from "./transcribe/sidecar";
import { formatLogData } from "./util/logLine";

export type { RecordingFormat };

export interface RecorderStatus {
    // "warning" is non-fatal (e.g. a device-change capture restart failed);
    // recording continues.
    status: "recording" | "stopped" | "error" | "warning";
    duration?: number;
    file?: string;
    message?: string;
}

export interface RecorderStartOptions {
    split?: boolean;
    /** Output container/codec; the helper defaults to "wav" when omitted. */
    format?: RecordingFormat;
    /**
     * Stable UID of the input device to record from. Omitted/empty = the
     * system default input. A UID that no longer resolves at start time falls
     * back to the default (the helper emits a non-fatal "warning" status).
     */
    inputDeviceUid?: string;
}

/** An input (microphone) device the user can pick, from the helper's `list-devices`. */
export interface InputDevice {
    /** Stable CoreAudio UID; persists across reboots/reconnects. */
    uid: string;
    name: string;
}

/**
 * Enumerate the machine's input (microphone) devices by invoking the helper's
 * `list-devices` subcommand. Resolves to `[]` on any failure (missing binary,
 * bad output, timeout) so the caller can just fall back to the system default.
 * macOS-only in practice; the helper is only shipped there.
 */
export function listInputDevices(
    binaryPath: string,
    timeoutMs = 5000
): Promise<InputDevice[]> {
    return new Promise((resolve) => {
        let settled = false;
        const done = (devices: InputDevice[]): void => {
            if (settled) return;
            settled = true;
            resolve(devices);
        };
        let proc: ChildProcess;
        try {
            proc = spawn(binaryPath, ["list-devices"], {
                stdio: ["ignore", "pipe", "ignore"],
            });
        } catch (e) {
            log("list-devices spawn threw", { message: String(e) });
            done([]);
            return;
        }
        // A hung helper must not block the caller (the settings UI, or a
        // recording start's availability pre-check) for long. SIGKILL after a
        // short grace so a wedged process is actually reaped.
        const timer = setTimeout(() => {
            proc.kill();
            setTimeout(() => {
                if (proc.exitCode === null && proc.signalCode === null) {
                    proc.kill("SIGKILL");
                }
            }, 500);
            log("list-devices timed out");
            done([]);
        }, timeoutMs);
        let out = "";
        proc.stdout?.on("data", (d: string | Uint8Array) => {
            out += d.toString();
        });
        proc.on("error", (err: Error) => {
            clearTimeout(timer);
            log("list-devices error", { message: err.message });
            done([]);
        });
        proc.on("close", () => {
            clearTimeout(timer);
            done(parseDeviceList(out));
        });
    });
}

/** Parse the helper's `{ "devices": [{uid,name}, …] }` output, tolerating noise. Exported for testing. */
export function parseDeviceList(stdout: string): InputDevice[] {
    for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
            const parsed = JSON.parse(trimmed) as { devices?: unknown };
            if (!Array.isArray(parsed.devices)) continue;
            return parsed.devices.flatMap((d): InputDevice[] => {
                if (
                    d &&
                    typeof d === "object" &&
                    typeof (d as InputDevice).uid === "string" &&
                    typeof (d as InputDevice).name === "string"
                ) {
                    const dev = d as InputDevice;
                    return dev.uid ? [{ uid: dev.uid, name: dev.name }] : [];
                }
                return [];
            });
        } catch {
            // Not the JSON line; keep scanning.
        }
    }
    return [];
}

/**
 * Split a stdout chunk into complete JSON status lines, returning any leftover
 * partial line as the new buffer. Exported for testing (#127).
 */
export function parseStatusLines(
    chunk: string,
    priorBuffer: string
): { statuses: RecorderStatus[]; buffer: string } {
    const combined = priorBuffer + chunk;
    const lines = combined.split("\n");
    const buffer = lines.pop() ?? "";
    const statuses: RecorderStatus[] = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            // Trim so CRLF helpers (`\r` left by split on `\n`) still parse (#132).
            statuses.push(JSON.parse(trimmed) as RecorderStatus);
        } catch {
            // Ignore non-JSON output
        }
    }
    return { statuses, buffer };
}

/**
 * Durable recorder-lifecycle logging. Uses console.warn (not .info/.debug) so
 * the line is visible in Obsidian's console without switching on Verbose — the
 * recorder's only signals are otherwise ephemeral Notices, which makes a
 * "recording didn't start" failure impossible to diagnose after the fact.
 * Single-string payloads so console exports don't show `Object` (#129).
 */
function log(event: string, data?: Record<string, unknown>): void {
    if (data) {
        console.warn(
            `[Meeting Copilot][recorder] ${event} ${formatLogData(data)}`
        );
    } else {
        console.warn(`[Meeting Copilot][recorder] ${event}`);
    }
}

export class Recorder {
    private process: ChildProcess | null = null;
    private _isRecording = false;
    private stopFilePath: string | null = null;
    /** Basename of the output path — correlates start/stop/exit in console exports (#129). */
    private sessionId: string | null = null;
    /** True after this session's stop-file has been written (#130). */
    private stopSignaled = false;
    /** Whether the helper has emitted at least one "recording" status this run. */
    private loggedRecording = false;
    /** Injected for unit tests (#130). */
    private readonly writeStopFile: (path: string, data: string) => void;

    onStatus: ((status: RecorderStatus) => void) | null = null;
    onError: ((message: string) => void) | null = null;

    constructor(opts?: { writeStopFile?: (path: string, data: string) => void }) {
        this.writeStopFile = opts?.writeStopFile ?? ((p, d) => fs.writeFileSync(p, d));
    }

    get isRecording(): boolean {
        return this._isRecording;
    }

    /** Test seam: whether stop() has already written the stop-file this session. */
    get hasStopBeenSignaled(): boolean {
        return this.stopSignaled;
    }

    /**
     * Test-only: mark as recording with a stop-file path so `stop()` can be
     * exercised without spawning the helper (#130).
     */
    armForStopTest(stopFilePath: string, sessionId = "test-session"): void {
        this._isRecording = true;
        this.stopFilePath = stopFilePath;
        this.sessionId = sessionId;
        this.stopSignaled = false;
    }

    start(binaryPath: string, outputPath: string, opts?: RecorderStartOptions): void {
        if (this._isRecording) {
            // A start slipped past the caller's own guard while a prior run was
            // still finalizing — log it, since the caller may have already
            // created the note/folder and would otherwise see a silent no-op.
            log("start ignored: already recording", {
                session: this.sessionId,
                outputPath,
            });
            return;
        }

        const stopFile = path.join(
            os.tmpdir(),
            `system-recorder-stop-${Date.now()}`
        );
        this.stopFilePath = stopFile;
        this.sessionId = path.basename(outputPath);
        this.stopSignaled = false;

        const spawnArgs = [
            "start", "--output", outputPath,
            "--stop-file", stopFile,
        ];
        // Keep --split first: an older helper only understands the positional
        // --split at args[6] and ignores the rest.
        if (opts?.split) spawnArgs.push("--split");
        if (opts?.format) spawnArgs.push("--format", opts.format);
        if (opts?.inputDeviceUid) {
            spawnArgs.push("--input-device", opts.inputDeviceUid);
        }

        log("spawning helper", {
            session: this.sessionId,
            binaryPath,
            args: spawnArgs.join(" "),
        });
        const proc = spawn(binaryPath, spawnArgs, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        this.process = proc;
        this._isRecording = true;
        this.loggedRecording = false;

        let buffer = "";

        proc.stdout?.on("data", (data: string | Uint8Array) => {
            const parsed = parseStatusLines(data.toString(), buffer);
            buffer = parsed.buffer;
            for (const status of parsed.statuses) {
                // Log lifecycle transitions but not every duration tick:
                // the first "recording" line confirms capture actually began
                // (vs. a helper that spawns then dies), plus every terminal
                // status. This is the signal for "did recording start?".
                if (status.status === "recording") {
                    if (!this.loggedRecording) {
                        this.loggedRecording = true;
                        log("helper reports recording", {
                            session: this.sessionId,
                            file: status.file,
                        });
                    }
                } else {
                    log(`helper status: ${status.status}`, {
                        session: this.sessionId,
                        file: status.file,
                        message: status.message,
                    });
                }
                this.onStatus?.(status);

                if (status.status === "stopped" || status.status === "error") {
                    this._isRecording = false;
                }
            }
        });

        proc.stderr?.on("data", (data: string | Uint8Array) => {
            const msg = data.toString().trim();
            if (msg) {
                // Core Audio / SCK emit routine warnings on stderr during
                // healthy capture — log only; Notices come from spawn/exit/
                // terminal "error" status (#127).
                log("helper stderr", { session: this.sessionId, msg });
            }
        });

        proc.on("close", (code: number | null) => {
            const wasRecording = this._isRecording;
            const session = this.sessionId;
            this._isRecording = false;
            this.process = null;
            this.stopFilePath = null;
            this.stopSignaled = false;
            log("helper exited", {
                session,
                code,
                wasRecording,
                everReportedRecording: this.loggedRecording,
            });
            if (!wasRecording) return;
            if (code !== 0 && code !== null) {
                this.onError?.(`Process exited with code ${code}`);
            } else {
                // Exited without emitting a terminal "stopped"/"error" line;
                // surface a terminal status so the UI resets.
                this.onStatus?.({ status: "stopped" });
            }
        });

        proc.on("error", (err: Error) => {
            this._isRecording = false;
            this.process = null;
            this.stopFilePath = null;
            this.stopSignaled = false;
            log("helper spawn error", {
                session: this.sessionId,
                message: err.message,
            });
            this.onError?.(err.message);
        });
    }

    stop(): void {
        if (this.stopSignaled) {
            log("stop ignored: already signaled", { session: this.sessionId });
            return;
        }
        if (this._isRecording && this.stopFilePath) {
            // Create the stop file - the Swift CLI polls for this
            log("stop requested (writing stop-file)", {
                session: this.sessionId,
                stopFile: this.stopFilePath,
            });
            try {
                this.writeStopFile(this.stopFilePath, "stop");
                this.stopSignaled = true;
            } catch (e) {
                // If /tmp is unwritable, try to terminate the helper so the UI
                // is not stuck in a recording state (#127).
                log("stop-file write failed; killing helper", {
                    session: this.sessionId,
                    message: e instanceof Error ? e.message : String(e),
                });
                this._isRecording = false;
                try {
                    this.process?.kill("SIGTERM");
                } catch {
                    /* ignore */
                }
                this.onError?.(
                    e instanceof Error
                        ? `Could not stop recording: ${e.message}`
                        : "Could not stop recording"
                );
            }
        } else {
            log("stop ignored: not recording", { session: this.sessionId });
        }
    }
}
