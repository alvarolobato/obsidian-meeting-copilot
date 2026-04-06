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

    private func checkIsWriting() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return isWriting
    }

    // MARK: - Finalize

    func finalize() async -> Double {
        let writing = checkIsWriting()
        guard writing else { return 0 }

        audioInput.markAsFinished()
        await assetWriter.finishWriting()

        // Calculate duration
        let asset = AVURLAsset(url: assetWriter.outputURL)
        let duration = try? await asset.load(.duration)
        return duration.map { CMTimeGetSeconds($0) } ?? 0
    }
}
