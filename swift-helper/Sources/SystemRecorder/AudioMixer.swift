import Foundation
import AVFoundation
import CoreMedia

@available(macOS 13.0, *)
final class AudioMixer: @unchecked Sendable {
    private var systemAudioFile: AVAudioFile?
    private var micAudioFile: AVAudioFile?
    private let systemLock = NSLock()
    private let micLock = NSLock()
    private let outputURL: URL
    private var isSystemWriting = false
    private var isMicWriting = false
    private var sampleRate: Double = 48000
    private var totalSystemFrames: AVAudioFrameCount = 0
    private var totalMicFrames: AVAudioFrameCount = 0

    private let systemTempURL: URL
    private let micTempURL: URL

    init(outputURL: URL) throws {
        self.outputURL = outputURL

        let tempDir = NSTemporaryDirectory()
        let pid = ProcessInfo.processInfo.processIdentifier
        systemTempURL = URL(fileURLWithPath: tempDir).appendingPathComponent("sysrec-system-\(pid).wav")
        micTempURL = URL(fileURLWithPath: tempDir).appendingPathComponent("sysrec-mic-\(pid).wav")

        for url in [outputURL, systemTempURL, micTempURL] {
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
        }
    }

    // MARK: - System audio (from ScreenCaptureKit)

    func appendSystemAudio(_ sampleBuffer: CMSampleBuffer) {
        systemLock.lock()
        defer { systemLock.unlock() }

        guard CMSampleBufferDataIsReady(sampleBuffer) else { return }
        let numSamples = CMSampleBufferGetNumSamples(sampleBuffer)
        guard numSamples > 0 else { return }

        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else { return }
        let srcFormat = AVAudioFormat(streamDescription: asbd)!

        if !isSystemWriting {
            do {
                sampleRate = srcFormat.sampleRate
                let wavFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: srcFormat.channelCount, interleaved: true)!
                systemAudioFile = try AVAudioFile(forWriting: systemTempURL, settings: wavFormat.settings)
                isSystemWriting = true
            } catch { return }
        }

        // Convert CMSampleBuffer to AVAudioPCMBuffer
        let frameCount = AVAudioFrameCount(numSamples)
        var ablSize: Int = 0
        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer, bufferListSizeNeededOut: &ablSize, bufferListOut: nil, bufferListSize: 0, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)

        let ablMemory = UnsafeMutablePointer<UInt8>.allocate(capacity: ablSize)
        defer { ablMemory.deallocate() }
        let ablPointer = ablMemory.withMemoryRebound(to: AudioBufferList.self, capacity: 1) { $0 }

        var blockBuffer: CMBlockBuffer?
        let err = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer, bufferListSizeNeededOut: nil, bufferListOut: ablPointer, bufferListSize: ablSize, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, blockBufferOut: &blockBuffer)
        guard err == noErr else { return }

        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: srcFormat, frameCapacity: frameCount) else { return }
        pcmBuffer.frameLength = frameCount

        let ablPtr = UnsafeMutableAudioBufferListPointer(ablPointer)
        let channelCount = Int(srcFormat.channelCount)
        for ch in 0..<min(channelCount, ablPtr.count) {
            if let src = ablPtr[ch].mData, let dst = pcmBuffer.floatChannelData?[ch] {
                memcpy(dst, src, Int(ablPtr[ch].mDataByteSize))
            }
        }

        do {
            try systemAudioFile?.write(from: pcmBuffer)
            totalSystemFrames += pcmBuffer.frameLength
        } catch {}
    }

    // MARK: - Microphone audio (from AVAudioEngine)

    func appendMicrophoneAudio(_ buffer: AVAudioPCMBuffer) {
        micLock.lock()
        defer { micLock.unlock() }

        guard buffer.frameLength > 0 else { return }

        if !isMicWriting {
            do {
                let wavFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: buffer.format.sampleRate, channels: buffer.format.channelCount, interleaved: true)!
                micAudioFile = try AVAudioFile(forWriting: micTempURL, settings: wavFormat.settings)
                isMicWriting = true
            } catch { return }
        }

        do {
            try micAudioFile?.write(from: buffer)
            totalMicFrames += buffer.frameLength
        } catch {}
    }

    // MARK: - Finalize: mix system + mic into output

    func finalize() async -> Double {
        // Close files
        systemLock.lock()
        systemAudioFile = nil
        systemLock.unlock()

        micLock.lock()
        micAudioFile = nil
        micLock.unlock()

        guard isSystemWriting else { return 0 }

        // Read system audio
        guard let systemFile = try? AVAudioFile(forReading: systemTempURL) else { return 0 }
        let systemLength = systemFile.length
        let systemFormat = systemFile.processingFormat

        // Output format: stereo, same sample rate
        let outputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: systemFormat.sampleRate, channels: 2, interleaved: false)!

        // Read all system audio
        guard let systemBuffer = AVAudioPCMBuffer(pcmFormat: systemFormat, frameCapacity: AVAudioFrameCount(systemLength)) else { return 0 }
        try? systemFile.read(into: systemBuffer)

        // Read mic audio if available
        var micBuffer: AVAudioPCMBuffer?
        if isMicWriting, let micFile = try? AVAudioFile(forReading: micTempURL) {
            let micLength = micFile.length
            let micFormat = micFile.processingFormat

            // Convert mic to match system sample rate if needed
            if micFormat.sampleRate != systemFormat.sampleRate {
                // Simple case: just read what we can
                let buf = AVAudioPCMBuffer(pcmFormat: micFormat, frameCapacity: AVAudioFrameCount(micLength))!
                try? micFile.read(into: buf)
                micBuffer = buf
            } else {
                let buf = AVAudioPCMBuffer(pcmFormat: micFormat, frameCapacity: AVAudioFrameCount(micLength))!
                try? micFile.read(into: buf)
                micBuffer = buf
            }
        }

        // Write mixed output
        let wavFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: systemFormat.sampleRate, channels: 2, interleaved: true)!
        guard let outputFile = try? AVAudioFile(forWriting: outputURL, settings: wavFormat.settings) else { return 0 }

        // Mix: create output buffer
        let maxFrames = max(systemBuffer.frameLength, micBuffer?.frameLength ?? 0)
        guard let mixBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: maxFrames) else { return 0 }
        mixBuffer.frameLength = maxFrames

        // Zero fill
        for ch in 0..<Int(outputFormat.channelCount) {
            if let data = mixBuffer.floatChannelData?[ch] {
                memset(data, 0, Int(maxFrames) * MemoryLayout<Float>.size)
            }
        }

        // Add system audio
        let sysChannels = Int(systemFormat.channelCount)
        for ch in 0..<min(sysChannels, 2) {
            if let src = systemBuffer.floatChannelData?[ch], let dst = mixBuffer.floatChannelData?[ch] {
                for i in 0..<Int(systemBuffer.frameLength) {
                    dst[i] += src[i]
                }
            }
        }

        // Add mic audio (sum into both channels for mono mic, or per-channel for stereo)
        if let mic = micBuffer {
            let micChannels = Int(mic.format.channelCount)
            let micFrames = Int(mic.frameLength)
            let framesToMix = min(micFrames, Int(maxFrames))

            for ch in 0..<min(micChannels, 2) {
                let outCh = micChannels == 1 ? 0 : ch
                if let src = mic.floatChannelData?[ch], let dst = mixBuffer.floatChannelData?[outCh] {
                    for i in 0..<framesToMix {
                        dst[i] += src[i]
                    }
                }
                // For mono mic, also add to right channel
                if micChannels == 1, let src = mic.floatChannelData?[0], let dst = mixBuffer.floatChannelData?[1] {
                    for i in 0..<framesToMix {
                        dst[i] += src[i]
                    }
                }
            }
        }

        // Clip to [-1, 1]
        for ch in 0..<Int(outputFormat.channelCount) {
            if let data = mixBuffer.floatChannelData?[ch] {
                for i in 0..<Int(maxFrames) {
                    data[i] = max(-1.0, min(1.0, data[i]))
                }
            }
        }

        try? outputFile.write(from: mixBuffer)

        // Cleanup temp files
        try? FileManager.default.removeItem(at: systemTempURL)
        try? FileManager.default.removeItem(at: micTempURL)

        return Double(maxFrames) / systemFormat.sampleRate
    }
}
