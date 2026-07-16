import Foundation
import ScreenCaptureKit
import AVFoundation
import AudioToolbox
import CoreAudio
import CoreMedia

@available(macOS 13.0, *)
final class AudioCaptureManager: NSObject, SCStreamDelegate, @unchecked Sendable {
    private var stream: SCStream?
    private var streamOutput: StreamOutput?
    private var audioEngine: AVAudioEngine?
    private var configChangeObserver: NSObjectProtocol?
    // The Core Audio process tap, when the tap path is active (macOS 14.4+).
    // Stored as AnyObject because the concrete type is only available on 14.4+
    // while this class is available from 13.0; it's cast back inside
    // `if #available` blocks. Nil when the SCK fallback is in use. Mutated only
    // on controlQueue (start / recovery / stop), so it never races itself.
    private var processTap: AnyObject?
    /// Which system-audio source actually came up, for accurate diagnostics
    /// (the watchdog's permission hint differs: the tap path needs no Screen
    /// Recording grant). Backed by `_usingProcessTap` under `restartLock` since
    /// it's written on the control path and read from the watchdog thread; use
    /// `isUsingProcessTap()` / `setUsingProcessTap(_:)`.
    private var _usingProcessTap = false

    // Callbacks for captured audio buffers
    var onSystemAudio: ((CMSampleBuffer) -> Void)?
    /// System audio from the Core Audio process tap (macOS 14.4+ path), as an
    /// already-decoded PCM buffer. Wired in addition to `onSystemAudio` so the
    /// same manager can drive either source.
    var onSystemAudioPCM: ((AVAudioPCMBuffer) -> Void)?
    var onMicrophoneAudio: ((AVAudioPCMBuffer, AVAudioTime) -> Void)?
    /// Non-fatal capture warnings (e.g. a device-change restart that failed).
    /// The recording keeps going; the plugin surfaces these for visibility.
    var onWarning: ((String) -> Void)?

    /// Stable UID of the input device to record from. Nil/empty = the system
    /// default. Set before startCapture(); a UID that no longer resolves (the
    /// device was unplugged) falls back to the default with a warning. Read on
    /// every (re)start of the mic engine, so a device that returns after a
    /// config change is picked back up.
    var preferredInputDeviceUID: String?

    // Recovery bookkeeping. Both capture paths bind to whatever audio devices
    // exist at start; an app like Zoom launching *after* we start switches the
    // default input/output device (or spins up its own aggregate device), which
    // stops the AVAudioEngine input node and can stop the SCStream. Without the
    // recovery below both go silent for the whole meeting ("No audio was
    // captured").
    //
    // Correctness rules for the recovery, since restarts fire from arbitrary
    // threads (the config-change notification, the SCStream delegate) while
    // stopCapture() runs on the stop Task:
    //   * `restartLock` guards the flags below (via the synchronous helpers).
    //   * mic restarts run on `controlQueue` (serialized, and off the
    //     notification poster's thread); stopCapture() drains it with a barrier
    //     so no mic restart is mid-flight during teardown.
    //   * every restart re-checks `capturing()` AFTER its (possibly async) start
    //     and tears down anything it created if stop won the race — so a restart
    //     can never resurrect capture after stop.
    private let restartLock = NSLock()
    private let controlQueue = DispatchQueue(label: "com.meetingcopilot.audio-control")
    private var isCapturing = false
    private var restartingSystem = false
    private var restartingMic = false
    /// Whether we've already switched the tap path over to the ScreenCaptureKit
    /// fallback. One-shot: the fallback is a terminal action, and (unlike a tap
    /// restart) it must remain possible even after the restart budget is spent,
    /// so we never end up with no system-audio source at all.
    private var tapFallbackStarted = false
    /// Whether the mic engine currently has a live tap installed. False when the
    /// mic was deliberately left off at start (e.g. an unusable device format),
    /// so the watchdog can tell an intentionally-off mic from one that's
    /// installed but delivering nothing.
    private var micTapInstalled = false
    private var micRestarts = 0
    private var systemRestarts = 0
    private static let maxRestarts = 30

    // MARK: - Lock helpers (synchronous, so they're safe to call from async code)

    private func setCapturing(_ value: Bool) {
        restartLock.lock(); defer { restartLock.unlock() }
        isCapturing = value
    }

    private func capturing() -> Bool {
        restartLock.lock(); defer { restartLock.unlock() }
        return isCapturing
    }

    private func setMicTapInstalled(_ value: Bool) {
        restartLock.lock(); defer { restartLock.unlock() }
        micTapInstalled = value
    }

    /// Whether the mic engine currently has a live tap. Used by the no-audio
    /// watchdog so it only warns about a silent mic when one is actually running
    /// (not when the mic was intentionally disabled for an unusable format,
    /// which already warned).
    func micTapActive() -> Bool {
        restartLock.lock(); defer { restartLock.unlock() }
        return micTapInstalled
    }

    private func setUsingProcessTap(_ value: Bool) {
        restartLock.lock(); defer { restartLock.unlock() }
        _usingProcessTap = value
    }

    /// Whether the Core Audio process tap (not the SCK fallback) is the live
    /// system-audio source. Read from the watchdog thread; guarded so it can't
    /// race the control-path writes.
    func isUsingProcessTap() -> Bool {
        restartLock.lock(); defer { restartLock.unlock() }
        return _usingProcessTap
    }

    /// Claim a system-stream restart. Returns false if we shouldn't restart
    /// (stopped, one already in flight, or the cap was hit).
    private func beginSystemRestart() -> Bool {
        restartLock.lock(); defer { restartLock.unlock() }
        guard isCapturing, !restartingSystem, systemRestarts < Self.maxRestarts else {
            return false
        }
        restartingSystem = true
        systemRestarts += 1
        return true
    }

    private func endSystemRestart() {
        restartLock.lock(); defer { restartLock.unlock() }
        restartingSystem = false
    }

    /// True when a tap rebuild can't be claimed *specifically because the restart
    /// budget is spent* (not because we're stopping or a restart is already in
    /// flight) — mirrors `beginSystemRestart`'s guard. This is the one denial
    /// `restartProcessTap` must act on: otherwise the 31st genuine tap death
    /// would silently leave a dead tap with no source. Reads consistently since
    /// it runs on the same serialized controlQueue as the tap rebuild path.
    private func systemRestartBudgetExhausted() -> Bool {
        restartLock.lock(); defer { restartLock.unlock() }
        return isCapturing && !restartingSystem && systemRestarts >= Self.maxRestarts
    }

    /// Claim the one-shot switch to the ScreenCaptureKit fallback. Blocks while
    /// another system restart is in flight and fires at most once, but is NOT
    /// bounded by maxRestarts — falling back must always be possible so a spent
    /// tap-restart budget can't strand us with no system-audio source. Released
    /// via endSystemRestart() (which clears `restartingSystem`); the one-shot
    /// `tapFallbackStarted` stays set.
    private func beginTapFallback() -> Bool {
        restartLock.lock(); defer { restartLock.unlock() }
        guard isCapturing, !restartingSystem, !tapFallbackStarted else { return false }
        tapFallbackStarted = true
        restartingSystem = true
        return true
    }

    /// Claim a mic-engine restart. Returns false if stopped, one is already in
    /// flight, or the cap was hit.
    private func beginMicRestart() -> Bool {
        restartLock.lock(); defer { restartLock.unlock() }
        guard isCapturing, !restartingMic, micRestarts < Self.maxRestarts else {
            return false
        }
        restartingMic = true
        micRestarts += 1
        return true
    }

    private func endMicRestart() {
        restartLock.lock(); defer { restartLock.unlock() }
        restartingMic = false
    }

    // MARK: - Start capturing

    func startCapture() async throws {
        // Register the config-change observer up front so a device change during
        // start-up isn't missed once we're capturing. It's gated by isCapturing
        // inside restartMicEngine(), so a change before we finish starting is a
        // no-op (the initial startMicEngine() binds to the current device
        // anyway). object: nil since we recreate the engine on each restart.
        configChangeObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.restartMicEngine()
        }

        try await startSystemAudio()
        do {
            try startMicEngine()
        } catch {
            // System audio came up but the mic engine failed: unwind the
            // system-audio source (tap or SCStream) and the config-change
            // observer we registered, so a failed start leaves nothing running.
            await stopCapture()
            throw error
        }
        setCapturing(true)

        // If stop somehow raced start-up, don't leave capture running.
        if !capturing() { await stopCapture() }
    }

    // MARK: - System audio (source selection)

    /// Env escape hatch to force the legacy ScreenCaptureKit path even on a
    /// tap-capable OS (for debugging / A-B comparisons). Any non-empty value.
    private static var forceLegacySystemAudio: Bool {
        !(ProcessInfo.processInfo.environment["MC_DISABLE_PROCESS_TAP"] ?? "").isEmpty
    }

    /// Bring up system-audio capture, preferring the Core Audio process tap on
    /// macOS 14.4+ and falling back to ScreenCaptureKit. The tap needs no
    /// Screen Recording permission and is device-change-resilient; if it can't
    /// be created (older OS, a denied System Audio Recording grant, or an API
    /// error) we transparently fall back to SCK, which keeps working as before.
    private func startSystemAudio() async throws {
        if #available(macOS 14.4, *), !Self.forceLegacySystemAudio {
            do {
                try startProcessTap()
                setUsingProcessTap(true)
                return
            } catch {
                // Non-fatal: warn and fall through to the SCK source so a tap
                // failure never blocks recording.
                onWarning?(
                    "System-audio process tap unavailable (\(error.localizedDescription)); using the screen-capture fallback."
                )
            }
        }
        setUsingProcessTap(false)
        try await startSystemStream()
    }

    @available(macOS 14.4, *)
    private func startProcessTap() throws {
        let tap = SystemAudioProcessTap()
        tap.onAudioBuffer = { [weak self] buffer in
            self?.onSystemAudioPCM?(buffer)
        }
        // The tap edge-triggers this when the HAL reports it stopped working
        // (coreaudiod restart, aggregate died, or a format change). Rebuild on
        // controlQueue so it serializes with stopCapture()'s barrier and other
        // restarts. There's no timer: silence legitimately produces no IO
        // cycles, so "quiet" must never be mistaken for "dead".
        tap.onNeedsRestart = { [weak self] in
            guard let self else { return }
            self.controlQueue.async { [weak self] in
                guard let self, self.capturing(), self.isUsingProcessTap() else { return }
                self.restartProcessTap()
            }
        }
        try tap.start()
        processTap = tap
    }

    // MARK: - Tap recovery

    /// Tear down the tap and switch to the ScreenCaptureKit source, which has
    /// its own device-change recovery. Called only from `restartProcessTap`
    /// (already on controlQueue). The tap teardown + flag reset happen
    /// **synchronously** here so they serialize with stopCapture()'s barrier and
    /// can't race it; only the async SCK bring-up is deferred to a Task. Claimed
    /// via beginTapFallback so it fires at most once and isn't bounded by
    /// maxRestarts — a spent tap-restart budget must never strand us with no
    /// system-audio source.
    @available(macOS 14.4, *)
    private func fallbackToScreenCapture(reason: String) {
        guard beginTapFallback() else { return }
        // Synchronous on controlQueue: destroy the tap and clear the flag before
        // spawning the async SCK start, so a concurrent stopCapture() barrier
        // never overlaps the teardown.
        if let tap = processTap as? SystemAudioProcessTap { tap.stop() }
        processTap = nil
        setUsingProcessTap(false)
        Task { [weak self] in
            guard let self else { return }
            defer { self.endSystemRestart() }
            guard self.capturing() else { return }
            do {
                try await self.startSystemStream()
            } catch {
                self.onWarning?(
                    "System audio unavailable: \(reason); the screen-capture fallback also failed: \(error.localizedDescription)."
                )
                return
            }
            self.onWarning?("System audio: \(reason). Switched to the screen-capture fallback.")
            // Stop won the race while we awaited: tear down what we just started.
            if !self.capturing(), let s = self.stream {
                try? await s.stopCapture()
                self.stream = nil
                self.streamOutput = nil
            }
        }
    }

    /// Rebuild a dead tap in place. Runs on controlQueue (dispatched from the
    /// tap's onNeedsRestart). Bounded by the shared systemRestarts cap; on
    /// repeated failure it falls back to SCK (which is not so bounded).
    @available(macOS 14.4, *)
    private func restartProcessTap() {
        guard beginSystemRestart() else {
            // Denied for one of three reasons: we're stopping, a restart is
            // already in flight, or the budget is spent. Only the last must act
            // here — leaving a dead tap with no system-audio source is exactly
            // what beginTapFallback's unbounded claim exists to prevent — so
            // switch to SCK (not bounded by maxRestarts) instead of returning.
            if systemRestartBudgetExhausted() {
                fallbackToScreenCapture(reason: "the system-audio tap failed repeatedly")
            }
            return
        }
        guard capturing() else { endSystemRestart(); return }
        if let tap = processTap as? SystemAudioProcessTap { tap.stop() }
        processTap = nil
        do {
            try startProcessTap()
        } catch {
            // Release the restart claim BEFORE falling back so beginTapFallback
            // (which requires no in-flight restart) isn't blocked by our own claim.
            endSystemRestart()
            onWarning?("System-audio tap stopped; rebuilding it failed: \(error.localizedDescription).")
            fallbackToScreenCapture(reason: "the system-audio tap stopped and could not be rebuilt")
            return
        }
        endSystemRestart()
        // Stop raced us: don't leave a resurrected tap running.
        if !capturing(), let tap = processTap as? SystemAudioProcessTap {
            tap.stop()
            processTap = nil
        }
    }

    // MARK: - System audio (ScreenCaptureKit)

    private func makeStreamConfig() -> SCStreamConfiguration {
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        // Ask ScreenCaptureKit for the mixer's target format up front so the
        // per-buffer conversion is usually a pass-through. The mixer converts
        // whatever actually arrives, so an OS that ignores this still works.
        config.channelCount = 1
        config.sampleRate = Int(AudioMixer.targetSampleRate)
        // We don't need video
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        return config
    }

    private func startSystemStream() async throws {
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(
                false, onScreenWindowsOnly: false
            )
        } catch {
            throw RecorderError.captureNotAuthorized
        }
        guard let display = content.displays.first else {
            throw RecorderError.noDisplay
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        // delegate: self so an unexpected stop (e.g. an audio-config change from
        // Zoom) is caught by stream(_:didStopWithError:) and restarted instead
        // of silently ending the system-audio capture.
        let stream = SCStream(filter: filter, configuration: makeStreamConfig(), delegate: self)
        let output = StreamOutput()
        output.onAudioBuffer = { [weak self] sampleBuffer in
            self?.onSystemAudio?(sampleBuffer)
        }
        try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: .global())
        try await stream.startCapture()
        // On a restart the previous stream already stopped (that's what fired
        // didStopWithError), but stop + clear it defensively so we never leave a
        // stale SCStream/output referenced after swapping in the new one.
        if let old = self.stream {
            try? await old.stopCapture()
        }
        self.stream = stream
        self.streamOutput = output
    }

    /// SCStreamDelegate: the stream stopped unexpectedly (device/config change,
    /// permission loss). Rebuild and restart it so system audio keeps flowing.
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        guard beginSystemRestart() else {
            if capturing() {
                onWarning?("System-audio capture stopped and could not be recovered: \(error.localizedDescription)")
            }
            return
        }
        Task { [weak self] in
            guard let self else { return }
            defer { self.endSystemRestart() }
            guard self.capturing() else { return }
            do {
                try await self.startSystemStream()
            } catch {
                self.onWarning?("Failed to restart system-audio capture after a device change: \(error.localizedDescription)")
                return
            }
            // Stop won the race while we awaited: tear down what we just started
            // so capture isn't resurrected past stopCapture().
            if !self.capturing(), let s = self.stream {
                try? await s.stopCapture()
                self.stream = nil
                self.streamOutput = nil
            }
        }
    }

    // MARK: - Microphone (AVAudioEngine)

    private func startMicEngine() throws {
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        // Point the input node at the chosen device before we read its format
        // and install the tap; a missing device leaves the node on the system
        // default (and warns).
        let overrodeDevice = applyPreferredInputDevice(to: inputNode)
        // Tap format. `outputFormat(forBus:0)` is the node's graph-facing format,
        // negotiated when the node was first realized against the *default*
        // device. After we repoint the AUHAL at a specific device that format is
        // stale: a tap installed with it silently receives no buffers when the
        // chosen device's native rate differs (e.g. a 16 kHz USB headset vs a
        // 48 kHz built-in mic), so the recording ends up one-sided with no
        // `.me` sidecar and diarization can't run. For an explicitly selected
        // device only the device's own hardware format (`inputFormat(forBus:0)`)
        // is trustworthy — never fall back to the stale `outputFormat`, which is
        // exactly what caused the zero-frame bug. Keep `outputFormat` for the
        // system default, which the OS already negotiated correctly.
        let format = overrodeDevice
            ? inputNode.inputFormat(forBus: 0)
            : inputNode.outputFormat(forBus: 0)
        // installTap traps on a zero/invalid format, which would take down the
        // whole recording (including system audio). If we can't get a usable
        // mic format, warn and record system audio only instead.
        guard format.sampleRate > 0, format.channelCount > 0 else {
            onWarning?(
                "Microphone format is unavailable; recording system audio only."
            )
            return
        }
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) {
            [weak self] buffer, time in
            self?.onMicrophoneAudio?(buffer, time)
        }
        engine.prepare()
        try engine.start()
        self.audioEngine = engine
        setMicTapInstalled(true)
    }

    /// Bind the mic engine's input node to `preferredInputDeviceUID` via the
    /// underlying AUHAL's current-device property. No-op for the system default.
    /// Any failure (device gone, property rejected) is non-fatal: the node
    /// stays on the default and we warn, so a recording still happens.
    ///
    /// Returns true only when a specific device was actually applied, so the
    /// caller knows to read that device's hardware format for the tap instead of
    /// the (now stale) default-device format.
    private func applyPreferredInputDevice(to inputNode: AVAudioInputNode) -> Bool {
        guard let uid = preferredInputDeviceUID, !uid.isEmpty else { return false }
        guard let deviceID = AudioDevices.deviceID(forUID: uid) else {
            onWarning?(
                "Selected microphone is unavailable; recording with the system default."
            )
            return false
        }
        guard let audioUnit = inputNode.audioUnit else {
            onWarning?(
                "Selected microphone couldn't be applied; recording with the system default."
            )
            return false
        }
        var device = deviceID
        let status = AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &device,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )
        if status != noErr {
            onWarning?(
                "Could not select the chosen microphone (error \(status)); recording with the system default."
            )
            return false
        }
        return true
    }

    private func teardownMicEngine() {
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        setMicTapInstalled(false)
    }

    /// Rebuild the mic engine/tap after an audio-graph reconfiguration. Claimed
    /// via beginMicRestart() (coalesces bursts, one in flight) then run on
    /// controlQueue so it's serialized against other restarts and stopCapture's
    /// barrier, and off the notification poster's thread.
    private func restartMicEngine() {
        guard beginMicRestart() else { return }
        controlQueue.async { [weak self] in
            guard let self else { return }
            defer { self.endMicRestart() }
            guard self.capturing() else { return }

            self.teardownMicEngine()
            do {
                try self.startMicEngine()
            } catch {
                self.onWarning?("Failed to restart microphone capture after a device change: \(error.localizedDescription)")
                return
            }
            // Stop raced us: don't leave a resurrected engine running.
            if !self.capturing() { self.teardownMicEngine() }
        }
    }

    // MARK: - Stop capturing

    func stopCapture() async {
        setCapturing(false)

        if let observer = configChangeObserver {
            NotificationCenter.default.removeObserver(observer)
            configChangeObserver = nil
        }
        // Drain any in-flight mic restart / tap rebuild / SCK-fallback teardown:
        // all run on controlQueue and re-check capturing() (now false), so after
        // this barrier none is mid-flight touching audioEngine or the tap, and
        // none can resurrect capture. The tap's own teardown is idempotent, so
        // the tap.stop() below is safe even if a rebuild just tore one down.
        controlQueue.sync {}

        if let stream = stream {
            try? await stream.stopCapture()
            self.stream = nil
            self.streamOutput = nil
        }
        if #available(macOS 14.4, *), let tap = processTap as? SystemAudioProcessTap {
            tap.stop()
        }
        processTap = nil
        teardownMicEngine()
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
