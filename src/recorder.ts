import { ChildProcess, spawn } from "child_process";
import * as path from "path";
import { Plugin, Platform } from "obsidian";

export interface RecorderStatus {
    status: "recording" | "stopped" | "error";
    duration?: number;
    file?: string;
    message?: string;
}

export class Recorder {
    private process: ChildProcess | null = null;
    private _isRecording = false;

    onStatus: ((status: RecorderStatus) => void) | null = null;
    onError: ((message: string) => void) | null = null;

    get isRecording(): boolean {
        return this._isRecording;
    }

    private getBinaryPath(plugin: Plugin): string {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const basePath = (plugin.app.vault.adapter as any).getBasePath() as string;
        const pluginDir = basePath + "/" + plugin.manifest.dir;
        return path.join(pluginDir, "system-recorder");
    }

    start(plugin: Plugin, outputPath: string): void {
        if (this._isRecording) return;

        if (!Platform.isMacOS) {
            this.onError?.("System recording is only supported on macOS");
            return;
        }

        const binaryPath = this.getBinaryPath(plugin);
        const proc = spawn(binaryPath, ["start", "--output", outputPath]);
        this.process = proc;
        this._isRecording = true;

        let buffer = "";

        proc.stdout?.on("data", (data: string | Uint8Array) => {
            buffer += data.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const status = JSON.parse(line) as RecorderStatus;
                    this.onStatus?.(status);

                    if (status.status === "stopped" || status.status === "error") {
                        this._isRecording = false;
                    }
                } catch {
                    // Ignore non-JSON output
                }
            }
        });

        proc.stderr?.on("data", (data: string | Uint8Array) => {
            const msg = data.toString().trim();
            if (msg) {
                this.onError?.(msg);
            }
        });

        proc.on("close", () => {
            this._isRecording = false;
            this.process = null;
        });

        proc.on("error", (err: Error) => {
            this._isRecording = false;
            this.process = null;
            this.onError?.(err.message);
        });
    }

    stop(): void {
        if (this.process && this._isRecording) {
            this.process.kill("SIGINT");
        }
    }
}
