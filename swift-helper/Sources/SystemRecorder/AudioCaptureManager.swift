import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia

@available(macOS 13.0, *)
final class AudioCaptureManager: NSObject, @unchecked Sendable {
    private var stream: SCStream?
    private var streamOutput: StreamOutput?
    private var audioEngine: AVAudioEngine?

    // Callbacks for captured audio buffers
    var onSystemAudio: ((CMSampleBuffer) -> Void)?
    var onMicrophoneAudio: ((AVAudioPCMBuffer, AVAudioTime) -> Void)?

    // MARK: - Start capturing

    func startCapture() async throws {
        // 1. ScreenCaptureKit: system audio
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

        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        let output = StreamOutput()
        output.onAudioBuffer = { [weak self] sampleBuffer in
            self?.onSystemAudio?(sampleBuffer)
        }
        try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: .global())
        try await stream.startCapture()
        self.stream = stream
        self.streamOutput = output

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
