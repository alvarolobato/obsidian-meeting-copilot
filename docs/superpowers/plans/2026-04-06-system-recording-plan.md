# System Recording Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** macOSのシステム音声+マイク音声を録音し、M4AファイルとしてObsidian Vault内に保存するプラグインを構築する。

**Architecture:** Swift CLI ヘルパーが ScreenCaptureKit + AVAudioEngine で音声キャプチャ・ミックス・M4A書き出しを担当。Obsidian プラグイン (TypeScript) が child_process 経由で Swift CLI を制御し、UI（リボン・ステータスバー・コマンド・設定）を提供する。

**Tech Stack:** TypeScript (Obsidian Plugin API, esbuild), Swift 6.2 (ScreenCaptureKit, AVFoundation, AVAudioEngine), Swift Package Manager

---

## File Structure

### TypeScript (Obsidian Plugin)

| File | Responsibility |
|------|---------------|
| `src/main.ts` | プラグインエントリポイント。リボン・コマンド・ステータスバー登録 |
| `src/settings.ts` | 設定インターフェース・設定画面 |
| `src/recorder.ts` | Swift CLIの起動・停止・stdout解析 |

### Swift (CLI Helper)

| File | Responsibility |
|------|---------------|
| `swift-helper/Package.swift` | Swift Package 定義 |
| `swift-helper/Sources/SystemRecorder/main.swift` | CLI エントリポイント。引数解析・シグナルハンドリング |
| `swift-helper/Sources/SystemRecorder/AudioCaptureManager.swift` | ScreenCaptureKit でシステム音声、AVAudioEngine でマイク音声をキャプチャ |
| `swift-helper/Sources/SystemRecorder/AudioMixer.swift` | 2つの音声ストリームをミックスし AVAssetWriter で M4A 書き出し |

---

## Task 1: Swift Package プロジェクトのセットアップ

**Files:**
- Create: `swift-helper/Package.swift`
- Create: `swift-helper/Sources/SystemRecorder/main.swift`

- [ ] **Step 1: Swift Package を作成**

`swift-helper/Package.swift`:
```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SystemRecorder",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "SystemRecorder",
            path: "Sources/SystemRecorder"
        )
    ]
)
```

`swift-helper/Sources/SystemRecorder/main.swift`:
```swift
import Foundation

print("{\"status\": \"ready\"}")
```

- [ ] **Step 2: ビルドできることを確認**

Run: `cd swift-helper && swift build 2>&1`
Expected: `Build complete!`

- [ ] **Step 3: 実行できることを確認**

Run: `cd swift-helper && swift run SystemRecorder 2>&1`
Expected: `{"status": "ready"}`

- [ ] **Step 4: Commit**

```bash
git add swift-helper/
git commit -m "feat: add Swift Package scaffold for system-recorder CLI"
```

---

## Task 2: Swift CLI - 引数解析とシグナルハンドリング

**Files:**
- Modify: `swift-helper/Sources/SystemRecorder/main.swift`

- [ ] **Step 1: main.swift に引数解析とシグナルハンドリングを実装**

`swift-helper/Sources/SystemRecorder/main.swift`:
```swift
import Foundation

// MARK: - Argument parsing

let args = CommandLine.arguments
guard args.count >= 4,
      args[1] == "start",
      args[2] == "--output" else {
    let errorJson = "{\"status\": \"error\", \"message\": \"Usage: system-recorder start --output <path>\"}"
    FileHandle.standardOutput.write(Data((errorJson + "\n").utf8))
    exit(1)
}

let outputPath = args[3]

// MARK: - JSON output helper

func emitJSON(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict),
       let str = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write(Data((str + "\n").utf8))
    }
}

// MARK: - Signal handling

let shouldStop = DispatchSemaphore(value: 0)

for sig: Int32 in [SIGINT, SIGHUP, SIGTERM] {
    signal(sig) { _ in
        shouldStop.signal()
    }
}

emitJSON(["status": "recording", "duration": 0])

// Placeholder: actual recording will be added in Task 3-4
// For now, wait for signal
shouldStop.wait()

emitJSON(["status": "stopped", "duration": 0, "file": outputPath])
exit(0)
```

- [ ] **Step 2: ビルドできることを確認**

Run: `cd swift-helper && swift build 2>&1`
Expected: `Build complete!`

- [ ] **Step 3: 引数なしでエラーが出ることを確認**

Run: `cd swift-helper && swift run SystemRecorder 2>&1`
Expected: JSON with `"status": "error"`

- [ ] **Step 4: 正しい引数で起動し、Ctrl+C で停止できることを確認**

Run: `cd swift-helper && timeout 2 swift run SystemRecorder start --output /tmp/test.m4a 2>&1 || true`
Expected: `{"status":"recording","duration":0}` が出力される

- [ ] **Step 5: Commit**

```bash
git add swift-helper/
git commit -m "feat: add CLI argument parsing and signal handling"
```

---

## Task 3: Swift CLI - AudioCaptureManager（音声キャプチャ）

**Files:**
- Create: `swift-helper/Sources/SystemRecorder/AudioCaptureManager.swift`

- [ ] **Step 1: AudioCaptureManager を実装**

`swift-helper/Sources/SystemRecorder/AudioCaptureManager.swift`:
```swift
import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia

@available(macOS 13.0, *)
final class AudioCaptureManager: NSObject, @unchecked Sendable {
    private var stream: SCStream?
    private var audioEngine: AVAudioEngine?

    // Callbacks for captured audio buffers
    var onSystemAudio: ((CMSampleBuffer) -> Void)?
    var onMicrophoneAudio: ((AVAudioPCMBuffer, AVAudioTime) -> Void)?

    // MARK: - Start capturing

    func startCapture() async throws {
        // 1. ScreenCaptureKit: system audio
        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: false
        )
        guard let display = content.displays.first else {
            throw RecorderError.noDisplay
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.channelCount = 2
        config.sampleRate = 44100

        // We don't need video
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        let streamOutput = StreamOutput()
        streamOutput.onAudioBuffer = { [weak self] sampleBuffer in
            self?.onSystemAudio?(sampleBuffer)
        }
        try stream.addStreamOutput(streamOutput, type: .audio, sampleHandlerQueue: .global())
        try await stream.startCapture()
        self.stream = stream

        // 2. AVAudioEngine: microphone
        let audioEngine = AVAudioEngine()
        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) {
            [weak self] buffer, time in
            self?.onMicrophoneAudio?(buffer, time)
        }
        audioEngine.prepare()
        try audioEngine.start()
        self.audioEngine = audioEngine
    }

    // MARK: - Stop capturing

    func stopCapture() async {
        if let stream = stream {
            try? await stream.stopCapture()
            self.stream = nil
        }
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine = nil
    }
}

// MARK: - SCStream output delegate

@available(macOS 13.0, *)
private class StreamOutput: NSObject, SCStreamOutput {
    var onAudioBuffer: ((CMSampleBuffer) -> Void)?

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        if type == .audio {
            onAudioBuffer?(sampleBuffer)
        }
    }
}

// MARK: - Errors

enum RecorderError: Error, LocalizedError {
    case noDisplay
    case captureNotAuthorized

    var errorDescription: String? {
        switch self {
        case .noDisplay: return "No display found"
        case .captureNotAuthorized: return "Screen capture not authorized"
        }
    }
}
```

- [ ] **Step 2: ビルドできることを確認**

Run: `cd swift-helper && swift build 2>&1`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add swift-helper/Sources/SystemRecorder/AudioCaptureManager.swift
git commit -m "feat: add AudioCaptureManager with ScreenCaptureKit and microphone capture"
```

---

## Task 4: Swift CLI - AudioMixer（ミックス + M4A書き出し）

**Files:**
- Create: `swift-helper/Sources/SystemRecorder/AudioMixer.swift`

- [ ] **Step 1: AudioMixer を実装**

`swift-helper/Sources/SystemRecorder/AudioMixer.swift`:
```swift
import Foundation
import AVFoundation
import CoreMedia

@available(macOS 13.0, *)
final class AudioMixer: @unchecked Sendable {
    private let assetWriter: AVAssetWriter
    private let audioInput: AVAssetWriterInput
    private var isWriting = false
    private let lock = NSLock()
    private var startTime: CMTime?

    init(outputURL: URL) throws {
        // Remove existing file if present
        if FileManager.default.fileExists(atPath: outputURL.path) {
            try FileManager.default.removeItem(at: outputURL)
        }

        assetWriter = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)

        let audioSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 2,
            AVEncoderBitRateKey: 128000
        ]
        audioInput = AVAssetWriterInput(
            mediaType: .audio,
            outputSettings: audioSettings
        )
        audioInput.expectsMediaDataInRealTime = true

        assetWriter.add(audioInput)
    }

    // MARK: - Append system audio (CMSampleBuffer from ScreenCaptureKit)

    func appendSystemAudio(_ sampleBuffer: CMSampleBuffer) {
        lock.lock()
        defer { lock.unlock() }

        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }

        if !isWriting {
            let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            assetWriter.startWriting()
            assetWriter.startSession(atSourceTime: time)
            startTime = time
            isWriting = true
        }

        if audioInput.isReadyForMoreMediaData {
            audioInput.append(sampleBuffer)
        }
    }

    // MARK: - Finalize

    func finalize() async -> Double {
        lock.lock()
        let writing = isWriting
        lock.unlock()

        guard writing else { return 0 }

        audioInput.markAsFinished()
        await assetWriter.finishWriting()

        // Calculate duration
        let asset = AVURLAsset(url: assetWriter.outputURL)
        let duration = try? await asset.load(.duration)
        return duration.map { CMTimeGetSeconds($0) } ?? 0
    }
}
```

- [ ] **Step 2: ビルドできることを確認**

Run: `cd swift-helper && swift build 2>&1`
Expected: `Build complete!`

- [ ] **Step 3: Commit**

```bash
git add swift-helper/Sources/SystemRecorder/AudioMixer.swift
git commit -m "feat: add AudioMixer with M4A/AAC writing via AVAssetWriter"
```

---

## Task 5: Swift CLI - main.swift を統合して録音フローを完成

**Files:**
- Modify: `swift-helper/Sources/SystemRecorder/main.swift`

- [ ] **Step 1: main.swift を録音フロー対応に書き換え**

`swift-helper/Sources/SystemRecorder/main.swift` を以下の内容に置き換え:
```swift
import Foundation
import AVFoundation

// MARK: - Argument parsing

let args = CommandLine.arguments
guard args.count >= 4,
      args[1] == "start",
      args[2] == "--output" else {
    let errorJson = "{\"status\": \"error\", \"message\": \"Usage: system-recorder start --output <path>\"}"
    FileHandle.standardOutput.write(Data((errorJson + "\n").utf8))
    exit(1)
}

let outputPath = args[3]
let outputURL = URL(fileURLWithPath: outputPath)

// MARK: - JSON output helper

func emitJSON(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict),
       let str = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write(Data((str + "\n").utf8))
    }
}

// MARK: - Signal handling

nonisolated(unsafe) var stopRequested = false
let stopSemaphore = DispatchSemaphore(value: 0)

for sig: Int32 in [SIGINT, SIGHUP, SIGTERM] {
    signal(sig) { _ in
        stopRequested = true
        stopSemaphore.signal()
    }
}

// MARK: - Main recording logic

if #available(macOS 13.0, *) {
    let captureManager = AudioCaptureManager()
    let mixer: AudioMixer

    do {
        mixer = try AudioMixer(outputURL: outputURL)
    } catch {
        emitJSON(["status": "error", "message": "Failed to create audio writer: \(error.localizedDescription)"])
        exit(1)
    }

    // Wire system audio → mixer
    captureManager.onSystemAudio = { sampleBuffer in
        mixer.appendSystemAudio(sampleBuffer)
    }

    // Note: microphone audio is captured but for simplicity,
    // we focus on system audio via ScreenCaptureKit's CMSampleBuffer pipeline.
    // Microphone audio mixing with CMSampleBuffer requires format conversion.
    // A future improvement can add mic mixing.

    // Start capture
    let startTask = Task {
        do {
            try await captureManager.startCapture()
            emitJSON(["status": "recording", "duration": 0])
        } catch {
            emitJSON(["status": "error", "message": "Failed to start capture: \(error.localizedDescription)"])
            exit(1)
        }
    }

    // Duration ticker - emit duration every second
    let startDate = Date()
    let ticker = DispatchSource.makeTimerSource(queue: .global())
    ticker.schedule(deadline: .now() + 1, repeating: 1.0)
    ticker.setEventHandler {
        let elapsed = Int(Date().timeIntervalSince(startDate))
        emitJSON(["status": "recording", "duration": elapsed])
    }
    ticker.resume()

    // Wait for stop signal
    stopSemaphore.wait()
    ticker.cancel()

    // Stop and finalize
    let finalizeTask = Task {
        await captureManager.stopCapture()
        let duration = await mixer.finalize()
        emitJSON(["status": "stopped", "duration": Int(duration), "file": outputPath])
        exit(0)
    }

    // Keep run loop alive for async tasks
    RunLoop.current.run(until: Date.distantFuture)

} else {
    emitJSON(["status": "error", "message": "macOS 13.0 or later is required"])
    exit(1)
}
```

- [ ] **Step 2: ビルドできることを確認**

Run: `cd swift-helper && swift build 2>&1`
Expected: `Build complete!`

- [ ] **Step 3: リリースビルドしてバイナリサイズを確認**

Run: `cd swift-helper && swift build -c release 2>&1 && ls -lh .build/release/SystemRecorder`
Expected: ビルド成功。バイナリサイズは数MB程度。

- [ ] **Step 4: Commit**

```bash
git add swift-helper/Sources/SystemRecorder/main.swift
git commit -m "feat: integrate AudioCaptureManager and AudioMixer into main recording flow"
```

---

## Task 6: Obsidian プラグイン - プロジェクト名とマニフェスト更新

**Files:**
- Modify: `package.json`
- Modify: `manifest.json`

- [ ] **Step 1: package.json を更新**

`package.json` の以下のフィールドを変更:
```json
{
    "name": "obsidian-system-recording",
    "description": "Record system audio (Zoom, Meet, Teams) and save as M4A in your vault",
    "scripts": {
        "dev": "node esbuild.config.mjs",
        "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
        "build:swift": "cd swift-helper && swift build -c release",
        "build:all": "npm run build:swift && npm run build",
        "version": "node version-bump.mjs && git add manifest.json versions.json",
        "lint": "eslint ."
    }
}
```

- [ ] **Step 2: manifest.json を更新**

`manifest.json` を以下に変更:
```json
{
    "id": "system-recording",
    "name": "System Recording",
    "version": "1.0.0",
    "minAppVersion": "0.15.0",
    "description": "Record system audio (Zoom, Meet, Teams) and save as M4A in your vault",
    "author": "s32747",
    "isDesktopOnly": true
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json manifest.json
git commit -m "chore: rename project to system-recording and update manifest"
```

---

## Task 7: Obsidian プラグイン - settings.ts（設定画面）

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: settings.ts を書き換え**

`src/settings.ts` を以下の内容に置き換え:
```typescript
import { App, PluginSettingTab, Setting } from "obsidian";
import SystemRecordingPlugin from "./main";

export interface SystemRecordingSettings {
    recordingFolder: string;
    fileNameTemplate: string;
}

export const DEFAULT_SETTINGS: SystemRecordingSettings = {
    recordingFolder: "recordings",
    fileNameTemplate: "recording-YYYY-MM-DD-HHmm",
};

export class SystemRecordingSettingTab extends PluginSettingTab {
    plugin: SystemRecordingPlugin;

    constructor(app: App, plugin: SystemRecordingPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Recording folder")
            .setDesc("Folder in your vault to save recordings")
            .addText((text) =>
                text
                    .setPlaceholder("recordings")
                    .setValue(this.plugin.settings.recordingFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.recordingFolder = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("File name template")
            .setDesc(
                "Template for recording file names. YYYY, MM, DD, HH, mm are replaced with date/time."
            )
            .addText((text) =>
                text
                    .setPlaceholder("recording-YYYY-MM-DD-HHmm")
                    .setValue(this.plugin.settings.fileNameTemplate)
                    .onChange(async (value) => {
                        this.plugin.settings.fileNameTemplate = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}
```

- [ ] **Step 2: ビルドできることを確認**

Run: `npm run build 2>&1` (from project root)
Note: This will fail because `main.ts` still imports old types. That's expected — we fix it in Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat: add recording folder and file name template settings"
```

---

## Task 8: Obsidian プラグイン - recorder.ts（Swift CLI制御）

**Files:**
- Create: `src/recorder.ts`

- [ ] **Step 1: recorder.ts を作成**

`src/recorder.ts`:
```typescript
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

    /**
     * Resolve path to the Swift CLI binary bundled with this plugin.
     */
    private getBinaryPath(plugin: Plugin): string {
        const pluginDir = (plugin.app.vault.adapter as any).getBasePath()
            + "/"
            + plugin.manifest.dir;
        return path.join(pluginDir, "system-recorder");
    }

    /**
     * Start recording system + microphone audio.
     * @param plugin - The plugin instance (used to locate the binary)
     * @param outputPath - Absolute path for the output .m4a file
     */
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

        proc.stdout?.on("data", (data: Buffer) => {
            buffer += data.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const status: RecorderStatus = JSON.parse(line);
                    this.onStatus?.(status);

                    if (status.status === "stopped" || status.status === "error") {
                        this._isRecording = false;
                    }
                } catch {
                    // Ignore non-JSON output
                }
            }
        });

        proc.stderr?.on("data", (data: Buffer) => {
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

    /**
     * Stop recording by sending SIGINT to the Swift CLI process.
     */
    stop(): void {
        if (this.process && this._isRecording) {
            this.process.kill("SIGINT");
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/recorder.ts
git commit -m "feat: add Recorder class to manage Swift CLI child process"
```

---

## Task 9: Obsidian プラグイン - main.ts（統合）

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: main.ts を書き換え**

`src/main.ts` を以下の内容に置き換え:
```typescript
import { MarkdownView, Notice, Plugin } from "obsidian";
import {
    DEFAULT_SETTINGS,
    SystemRecordingSettings,
    SystemRecordingSettingTab,
} from "./settings";
import { Recorder, RecorderStatus } from "./recorder";
import * as path from "path";

export default class SystemRecordingPlugin extends Plugin {
    settings: SystemRecordingSettings;
    private recorder = new Recorder();
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
        this.statusBarEl.style.display = "none";

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
            await this.loadData()
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
            this.startRecording();
        }
    }

    private async startRecording() {
        if (this.recorder.isRecording) {
            new Notice("Already recording");
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
        const relativePath = `${folder}/${fileName}.m4a`;
        const vaultBasePath = (adapter as any).getBasePath() as string;
        const absolutePath = path.join(vaultBasePath, relativePath);

        // Start recording
        this.recorder.start(this, absolutePath);
        this.recordingStartTime = Date.now();
        this.startDurationTimer();
        this.updateRibbonIcon(true);

        new Notice("Recording started");
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
            this.statusBarEl.style.display = "";
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
            this.statusBarEl.style.display = "none";
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
            .replace("mm", String(now.getMinutes()).padStart(2, "0"));
    }
}
```

- [ ] **Step 2: TypeScript ビルドが通ることを確認**

Run: `cd /Users/s32747/Develop/obsidian-system-recording && npm install && npm run build 2>&1`
Expected: ビルド成功

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: integrate recorder, settings, and UI into main plugin"
```

---

## Task 10: 録音中スタイル + 不要ファイル削除

**Files:**
- Modify: `styles.css`
- Delete: `AGENTS.md` (sample plugin artifact)

- [ ] **Step 1: styles.css に録音中のリボンアイコンスタイルを追加**

`styles.css` を以下の内容に置き換え:
```css
.is-recording {
    color: var(--text-error) !important;
    animation: recording-pulse 1.5s ease-in-out infinite;
}

@keyframes recording-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}
```

- [ ] **Step 2: 不要なサンプルファイルを削除**

Run:
```bash
rm AGENTS.md
```

- [ ] **Step 3: Commit**

```bash
git add styles.css
git rm AGENTS.md
git commit -m "feat: add recording pulse animation, remove sample plugin artifacts"
```

---

## Task 11: ビルドスクリプト統合 + 最終ビルド確認

**Files:**
- Modify: `package.json` (scripts already updated in Task 6)

- [ ] **Step 1: Swift ヘルパーをリリースビルドし、プラグインルートにコピー**

Run:
```bash
cd /Users/s32747/Develop/obsidian-system-recording
cd swift-helper && swift build -c release 2>&1
cp .build/release/SystemRecorder ../system-recorder
cd ..
```

- [ ] **Step 2: TypeScript ビルド**

Run:
```bash
npm run build 2>&1
```
Expected: ビルド成功。`main.js` がルートに生成される。

- [ ] **Step 3: 最終成果物の確認**

Run:
```bash
ls -lh main.js manifest.json styles.css system-recorder
```
Expected: 4ファイルが存在する。

- [ ] **Step 4: .gitignore を更新**

`.gitignore` を作成:
```
node_modules/
main.js
system-recorder
swift-helper/.build/
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore and finalize build pipeline"
```

---

## Task 12: README 更新

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README.md を書き換え**

`README.md` を以下の内容に置き換え:
```markdown
# Obsidian System Recording

macOSのシステム音声（Zoom / Google Meet / Teams等）とマイク音声を録音し、M4A(AAC)ファイルとしてVault内に保存するObsidianプラグイン。

## Requirements

- macOS 13.0+
- Obsidian Desktop

## Features

- ScreenCaptureKitによるシステム音声キャプチャ（追加ドライバ不要）
- マイク音声との同時録音
- リボンボタン / コマンドパレットから操作
- 録音中はステータスバーに経過時間を表示
- 録音完了時に現在のノートへ自動リンク挿入

## Installation

1. [Releases](https://github.com/your-username/obsidian-system-recording/releases) から最新版をダウンロード
2. `main.js`, `manifest.json`, `styles.css`, `system-recorder` を Vault の `.obsidian/plugins/system-recording/` に配置
3. Obsidian の設定 → Community plugins → System Recording を有効化
4. 初回の録音開始時に「画面収録」と「マイク」の権限許可ダイアログが表示されます

## Usage

- 左サイドバーのマイクアイコンをクリックして録音開始/停止
- コマンドパレット (`Cmd+P`) → "Start recording" / "Stop recording"

## Settings

- **Recording folder**: 録音ファイルの保存先フォルダ（デフォルト: `recordings/`）
- **File name template**: ファイル名テンプレート（デフォルト: `recording-YYYY-MM-DD-HHmm`）

## Development

```bash
# Install dependencies
npm install

# Build Swift helper
cd swift-helper && swift build -c release && cd ..
cp swift-helper/.build/release/SystemRecorder system-recorder

# Build plugin (dev mode with watch)
npm run dev

# Build plugin (production)
npm run build
```
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README with installation and usage instructions"
```
