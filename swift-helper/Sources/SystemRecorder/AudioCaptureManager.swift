import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia

@available(macOS 13.0, *)
final class AudioCaptureManager: NSObject, SCStreamDelegate, @unchecked Sendable {
    private var stream: SCStream?
    private var streamOutput: StreamOutput?
    private var audioEngine: AVAudioEngine?
    private var configChangeObserver: NSObjectProtocol?

    // Callbacks for captured audio buffers
    var onSystemAudio: ((CMSampleBuffer) -> Void)?
    var onMicrophoneAudio: ((AVAudioPCMBuffer, AVAudioTime) -> Void)?
    /// Non-fatal capture warnings (e.g. a device-change restart that failed).
    /// The recording keeps going; the plugin surfaces these for visibility.
    var onWarning: ((String) -> Void)?

    // Recovery bookkeeping. Both capture paths bind to whatever audio devices
    // exist at start; an app like Zoom launching *after* we start switches the
    // default input/output device (or spins up its own aggregate device), which
    // stops the AVAudioEngine input node and can stop the SCStream. Without the
    // recovery below both go silent for the whole meeting ("No audio was
    // captured"). All access is behind `restartLock` via the synchronous
    // helpers below (never lock/unlock directly from an async context).
    private let restartLock = NSLock()
    private var isCapturing = false
    private var restartingSystem = false
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

    /// Claim a mic-engine restart. Returns false if stopped or capped.
    private func beginMicRestart() -> Bool {
        restartLock.lock(); defer { restartLock.unlock() }
        guard isCapturing, micRestarts < Self.maxRestarts else { return false }
        micRestarts += 1
        return true
    }

    // MARK: - Start capturing

    func startCapture() async throws {
        try await startSystemStream()
        try startMicEngine()
        setCapturing(true)

        // Rebuild the mic tap whenever the audio graph reconfigures (default
        // device switch, sample-rate change, headset (un)plug). The engine stops
        // its input node on this notification, so without a rebuild the tap never
        // fires again. Registered once with object: nil since we recreate the
        // engine instance on each restart. The mixer drains + recreates its
        // converter when the source format changes, so a new device format is
        // handled downstream.
        configChangeObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.restartMicEngine()
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
            do {
                try await self.startSystemStream()
            } catch {
                self.onWarning?("Failed to restart system-audio capture after a device change: \(error.localizedDescription)")
            }
            self.endSystemRestart()
        }
    }

    // MARK: - Microphone (AVAudioEngine)

    private func startMicEngine() throws {
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) {
            [weak self] buffer, time in
            self?.onMicrophoneAudio?(buffer, time)
        }
        engine.prepare()
        try engine.start()
        self.audioEngine = engine
    }

    /// Tear down and rebuild the mic engine/tap after an audio-graph
    /// reconfiguration. Runs on the notification's thread.
    private func restartMicEngine() {
        guard beginMicRestart() else { return }

        if let engine = audioEngine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        audioEngine = nil
        do {
            try startMicEngine()
        } catch {
            onWarning?("Failed to restart microphone capture after a device change: \(error.localizedDescription)")
        }
    }

    // MARK: - Stop capturing

    func stopCapture() async {
        setCapturing(false)

        if let observer = configChangeObserver {
            NotificationCenter.default.removeObserver(observer)
            configChangeObserver = nil
        }
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
