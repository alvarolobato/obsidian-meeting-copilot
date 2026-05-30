import { MarkdownView, Notice, Platform, Plugin } from "obsidian";
import {
    DEFAULT_SETTINGS,
    SystemRecordingSettings,
    SystemRecordingSettingTab,
} from "./settings";
import { Recorder, RecorderStatus } from "./recorder";
import { BinaryProvisioner } from "./binary";
import { nodeDeps, resolveBinaryPath } from "./binary-runtime";
import * as path from "path";

export default class SystemRecordingPlugin extends Plugin {
    settings: SystemRecordingSettings;
    private recorder = new Recorder();
    private provisioner = new BinaryProvisioner(nodeDeps());
    private starting = false;
    private statusBarEl: HTMLElement | null = null;
    private durationInterval: number | null = null;
    private recordingStartTime: number | null = null;
    private ribbonIconEl: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();

        // Ribbon icon
        this.ribbonIconEl = this.addRibbonIcon(
            "microphone",
            "Toggle recording",
            () => this.toggleRecording()
        );

        // Status bar
        this.statusBarEl = this.addStatusBarItem();
        this.statusBarEl.addClass("system-recording-hidden");

        // Commands
        this.addCommand({
            id: "start-recording",
            name: "Start recording",
            callback: () => this.startRecording(),
        });

        this.addCommand({
            id: "stop-recording",
            name: "Stop recording",
            callback: () => this.stopRecording(),
        });

        // Settings tab
        this.addSettingTab(new SystemRecordingSettingTab(this.app, this));

        // Recorder callbacks
        this.recorder.onStatus = (status: RecorderStatus) =>
            this.handleStatus(status);
        this.recorder.onError = (message: string) =>
            new Notice(`Recording error: ${message}`);
    }

    onunload() {
        if (this.recorder.isRecording) {
            this.recorder.stop();
        }
        this.clearDurationTimer();
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData() as Partial<SystemRecordingSettings>
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // MARK: - Recording control

    private toggleRecording() {
        if (this.recorder.isRecording) {
            this.stopRecording();
        } else {
            void this.startRecording();
        }
    }

    private async startRecording() {
        if (this.recorder.isRecording) {
            new Notice("Already recording");
            return;
        }

        // A start is already in progress (binary provisioning may be awaiting)
        if (this.starting) {
            return;
        }

        if (!Platform.isMacOS) {
            new Notice("System recording is only supported on macOS");
            return;
        }

        this.starting = true;
        try {
            // Ensure the recorder helper binary is present and verified
            let binaryPath: string;
            try {
                binaryPath = await this.provisioner.ensure(
                    resolveBinaryPath(this),
                    this.manifest.version,
                    () => new Notice("Downloading recorder helper…")
                );
            } catch (e) {
                new Notice(e instanceof Error ? e.message : String(e));
                return;
            }

            // Ensure recording folder exists
            const folder = this.settings.recordingFolder;
            const adapter = this.app.vault.adapter;
            if (!(await adapter.exists(folder))) {
                await adapter.mkdir(folder);
            }

            // Generate file name
            const fileName = this.formatFileName(this.settings.fileNameTemplate);
            const relativePath = `${folder}/${fileName}.wav`;
            // Obsidian's FileSystemAdapter has getBasePath() but it's not in the public type
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            const vaultBasePath = (adapter as any).getBasePath() as string;
            const absolutePath = path.join(vaultBasePath, relativePath);

            // Start recording
            this.recorder.start(binaryPath, absolutePath);
            this.recordingStartTime = Date.now();
            this.startDurationTimer();
            this.updateRibbonIcon(true);

            new Notice("Recording started");
        } finally {
            this.starting = false;
        }
    }

    private stopRecording() {
        if (!this.recorder.isRecording) {
            new Notice("Not recording");
            return;
        }

        this.recorder.stop();
        new Notice("Stopping recording...");
    }

    // MARK: - Status handling

    private handleStatus(status: RecorderStatus) {
        if (status.status === "stopped" && status.file) {
            this.clearDurationTimer();
            this.updateRibbonIcon(false);
            this.hideStatusBar();

            // Insert link into current note
            const fileName = path.basename(status.file);
            this.insertRecordingLink(fileName);
            new Notice("Recording saved");
        } else if (status.status === "error") {
            this.clearDurationTimer();
            this.updateRibbonIcon(false);
            this.hideStatusBar();
            new Notice(`Recording error: ${status.message ?? "Unknown error"}`);
        }
    }

    // MARK: - UI helpers

    private startDurationTimer() {
        if (this.statusBarEl) {
            this.statusBarEl.removeClass("system-recording-hidden");
        }

        this.durationInterval = window.setInterval(() => {
            if (!this.recordingStartTime || !this.statusBarEl) return;
            const elapsed = Math.floor(
                (Date.now() - this.recordingStartTime) / 1000
            );
            const h = String(Math.floor(elapsed / 3600)).padStart(2, "0");
            const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0");
            const s = String(elapsed % 60).padStart(2, "0");
            this.statusBarEl.setText(`Recording ${h}:${m}:${s}`);
        }, 1000);

        this.registerInterval(this.durationInterval);
    }

    private clearDurationTimer() {
        if (this.durationInterval !== null) {
            window.clearInterval(this.durationInterval);
            this.durationInterval = null;
        }
    }

    private hideStatusBar() {
        if (this.statusBarEl) {
            this.statusBarEl.addClass("system-recording-hidden");
            this.statusBarEl.setText("");
        }
    }

    private updateRibbonIcon(recording: boolean) {
        if (this.ribbonIconEl) {
            if (recording) {
                this.ribbonIconEl.addClass("is-recording");
            } else {
                this.ribbonIconEl.removeClass("is-recording");
            }
        }
    }

    private insertRecordingLink(fileName: string) {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
            const editor = view.editor;
            const cursor = editor.getCursor();
            editor.replaceRange(`![[${fileName}]]\n`, cursor);
        }
    }

    // MARK: - Helpers

    private formatFileName(template: string): string {
        const now = new Date();
        return template
            .replace("YYYY", String(now.getFullYear()))
            .replace("MM", String(now.getMonth() + 1).padStart(2, "0"))
            .replace("DD", String(now.getDate()).padStart(2, "0"))
            .replace("HH", String(now.getHours()).padStart(2, "0"))
            .replace("mm", String(now.getMinutes()).padStart(2, "0"))
            .replace("ss", String(now.getSeconds()).padStart(2, "0"));
    }
}
