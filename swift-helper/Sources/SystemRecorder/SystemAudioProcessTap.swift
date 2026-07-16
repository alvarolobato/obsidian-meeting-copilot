import Foundation
import AVFoundation
import CoreAudio
import AudioToolbox

/// System-audio capture via a Core Audio **process tap** (macOS 14.2+).
///
/// This is the modern replacement for the ScreenCaptureKit system-audio source
/// (`AudioCaptureManager.startSystemStream`). A `CATapDescription` for a global
/// mono mixdown is turned into a tap object with `AudioHardwareCreateProcessTap`,
/// wrapped in a **private, auto-starting aggregate device**, and driven by an IO
/// proc that streams the tapped output back as `AVAudioPCMBuffer`s.
///
/// Why this over ScreenCaptureKit:
///   * **No Screen Recording permission** and no screen-capture classification —
///     so macOS doesn't show the screen-recording indicator or suppress the
///     user's notifications for the duration of a meeting (taps are audio-only).
///     It does need the **System Audio Recording** grant (see below).
///   * **Device-independent.** A global tap observes every process's output
///     stream regardless of the current output *hardware* device, so the classic
///     "Zoom launched after we started, switched the default device, and system
///     audio went silent" failure the SCK path must actively recover from
///     doesn't arise.
///
/// Permission: creating/running a tap requires the **System Audio Recording**
/// TCC grant (`Privacy & Security → Screen & System Audio Recording`), attributed
/// to the responsible app (Obsidian). If it's missing the OS may let the tap
/// start but deliver no IO cycles; `AudioCaptureManager` treats "started but no
/// callbacks" as a failure and falls back to ScreenCaptureKit.
///
/// The tap is `muteBehavior = .unmuted`, so the user keeps hearing the meeting
/// while we observe it. Everything is torn down in `stop()` (idempotent), and a
/// failure at any construction step unwinds what was already created and throws.
@available(macOS 14.2, *)
final class SystemAudioProcessTap: @unchecked Sendable {
    enum TapError: LocalizedError {
        case createTap(OSStatus)
        case readFormat(OSStatus)
        case invalidFormat
        case createAggregate(OSStatus)
        case createIOProc(OSStatus)
        case start(OSStatus)

        var errorDescription: String? {
            switch self {
            case .createTap(let s): return "AudioHardwareCreateProcessTap failed (\(s))"
            case .readFormat(let s): return "reading the tap's stream format failed (\(s))"
            case .invalidFormat: return "the tap reported an unusable stream format"
            case .createAggregate(let s): return "AudioHardwareCreateAggregateDevice failed (\(s))"
            case .createIOProc(let s): return "AudioDeviceCreateIOProcIDWithBlock failed (\(s))"
            case .start(let s): return "AudioDeviceStart failed (\(s))"
            }
        }
    }

    /// A point-in-time view of IO-proc liveness, used by `AudioCaptureManager`
    /// to detect a tap that started but never delivers (permission denied) or
    /// one that stalls mid-recording (HAL glitch).
    struct Liveness {
        let callbackCount: Int
        let secondsSinceLastCallback: TimeInterval
    }

    /// Captured system audio, already in the tap's native format (a global
    /// mono mixdown). The mixer resamples/downmixes to the 24 kHz target. Set
    /// before `start()`; only mutated afterwards under the ioQueue barrier in
    /// `teardown()`, so reads on the IO queue are race-free.
    var onAudioBuffer: ((AVAudioPCMBuffer) -> Void)?

    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var ioProcID: AudioDeviceIOProcID?
    private var tapFormat: AVAudioFormat?
    // The IO block is invoked on this serial queue (not a realtime thread), so
    // the per-buffer copy + downstream temp-file write in the mixer can't glitch
    // the audio HAL — matching the SCK path, which runs its handler on a global
    // queue. Teardown drains it with a barrier so no block runs after destroy.
    private let ioQueue = DispatchQueue(label: "com.meetingcopilot.audio-tap-io")

    // IO-proc liveness, updated on ioQueue and read from other threads under the
    // lock. `callbackCount` counts only cycles that carried audio frames (see
    // startIOProc); `lastCallback` is initialized to "now" so the stall check
    // has a sane baseline before the first buffer arrives.
    private let livenessLock = NSLock()
    private var callbackCount = 0
    private var lastCallback = Date()

    func start() throws {
        // Exclude our own process from the global tap, mirroring SCK's
        // `excludesCurrentProcessAudio`. Best-effort: an unresolved id just
        // means we also observe our own (silent) output, which is harmless.
        let excluded = Self.currentProcessAudioObjectID().map { [$0] } ?? []
        let description = CATapDescription(monoGlobalTapButExcludeProcesses: excluded)
        description.name = "Meeting Copilot System Audio"
        description.isPrivate = true
        description.muteBehavior = .unmuted
        description.uuid = UUID()

        var newTap = AudioObjectID(kAudioObjectUnknown)
        let tapStatus = AudioHardwareCreateProcessTap(description, &newTap)
        guard tapStatus == noErr, newTap != AudioObjectID(kAudioObjectUnknown) else {
            throw TapError.createTap(tapStatus)
        }
        tapID = newTap

        do {
            tapFormat = try Self.readTapFormat(tapID)
            // Prefer the HAL-assigned tap UID over the description's UUID for the
            // aggregate's sub-tap list (Apple's sample reads it back), falling
            // back to the UUID we set if the property read fails.
            let tapUID = Self.readTapUID(tapID) ?? description.uuid.uuidString
            aggregateID = try Self.createAggregateDevice(tappingUID: tapUID)
            try startIOProc()
        } catch {
            // Unwind whatever succeeded so a failed start leaves no orphaned
            // tap/aggregate device registered with the HAL.
            teardown()
            throw error
        }
    }

    /// Idempotent teardown: stop and destroy the IO proc, aggregate device, and
    /// tap, in reverse creation order. Safe to call more than once and on a
    /// partially-started tap (the guards skip anything never created).
    func stop() {
        teardown()
    }

    /// IO-proc liveness snapshot for the health checks in `AudioCaptureManager`.
    func liveness() -> Liveness {
        livenessLock.lock(); defer { livenessLock.unlock() }
        return Liveness(
            callbackCount: callbackCount,
            secondsSinceLastCallback: Date().timeIntervalSince(lastCallback)
        )
    }

    // MARK: - IO proc

    private func startIOProc() throws {
        guard let format = tapFormat else { throw TapError.invalidFormat }
        let bytesPerFrame = format.streamDescription.pointee.mBytesPerFrame
        // Guard against a degenerate ASBD so the IO block's frame math is sound.
        guard bytesPerFrame > 0 else { throw TapError.invalidFormat }

        var newProcID: AudioDeviceIOProcID?
        let procStatus = AudioDeviceCreateIOProcIDWithBlock(
            &newProcID, aggregateID, ioQueue
        ) { [weak self] _, inInputData, _, _, _ in
            guard let self else { return }
            guard let pcm = SystemAudioProcessTap.makeBuffer(
                inInputData, format: format, bytesPerFrame: bytesPerFrame
            ) else { return }
            // Count only cycles that actually carried audio frames: a tap that
            // clocks but delivers empty buffers (e.g. the System Audio Recording
            // grant is missing) then still reads as "never delivered", so the
            // liveness monitor falls back to ScreenCaptureKit. Genuine silence
            // still delivers full (zero-sample) frames, so a quiet meeting won't
            // trip the fallback.
            self.noteCallback()
            // Read the handler on the ioQueue; teardown nils it under the same
            // queue's barrier, so this can't race a stop.
            self.onAudioBuffer?(pcm)
        }
        guard procStatus == noErr, let procID = newProcID else {
            throw TapError.createIOProc(procStatus)
        }
        ioProcID = procID

        let startStatus = AudioDeviceStart(aggregateID, procID)
        guard startStatus == noErr else { throw TapError.start(startStatus) }
    }

    private func noteCallback() {
        livenessLock.lock(); defer { livenessLock.unlock() }
        callbackCount += 1
        lastCallback = Date()
    }

    /// Copy one IO cycle's tapped audio into an owned `AVAudioPCMBuffer`. A copy
    /// (rather than a no-copy wrap of the transient IO buffer) keeps the buffer
    /// valid regardless of when the mixer consumes it.
    private static func makeBuffer(
        _ inInputData: UnsafePointer<AudioBufferList>,
        format: AVAudioFormat,
        bytesPerFrame: UInt32
    ) -> AVAudioPCMBuffer? {
        let srcABL = UnsafeMutableAudioBufferListPointer(
            UnsafeMutablePointer(mutating: inInputData)
        )
        // Derive the frame count from the largest channel buffer, not just the
        // first: a planar layout whose first buffer is momentarily empty must
        // not truncate the cycle to zero frames.
        var maxBytes: UInt32 = 0
        for buffer in srcABL {
            maxBytes = max(maxBytes, buffer.mDataByteSize)
        }
        guard maxBytes > 0 else { return nil }
        let frames = AVAudioFrameCount(maxBytes / bytesPerFrame)
        guard frames > 0,
              let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)
        else { return nil }
        pcm.frameLength = frames

        let dstABL = UnsafeMutableAudioBufferListPointer(pcm.mutableAudioBufferList)
        for i in 0..<min(srcABL.count, dstABL.count) {
            if let src = srcABL[i].mData, let dst = dstABL[i].mData {
                memcpy(dst, src, min(Int(srcABL[i].mDataByteSize), Int(dstABL[i].mDataByteSize)))
            }
        }
        return pcm
    }

    // MARK: - Teardown

    // Must NOT be called from the IO queue itself (the `ioQueue.sync` barrier
    // below would self-deadlock). All current callers run off it: stop(), the
    // start() failure path, and AudioCaptureManager's control-queue health path.
    private func teardown() {
        if let procID = ioProcID {
            // Stop the device, then drain the IO queue so any block already
            // dispatched has finished before we destroy the proc/aggregate/tap —
            // otherwise a late block could memcpy from a freed IO buffer.
            AudioDeviceStop(aggregateID, procID)
            ioQueue.sync { self.onAudioBuffer = nil }
            AudioDeviceDestroyIOProcID(aggregateID, procID)
            ioProcID = nil
        } else {
            onAudioBuffer = nil
        }
        if aggregateID != AudioObjectID(kAudioObjectUnknown) {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != AudioObjectID(kAudioObjectUnknown) {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
        tapFormat = nil
    }

    // MARK: - CoreAudio helpers

    /// The tap object's stream format (`kAudioTapPropertyFormat`) as an
    /// `AVAudioFormat` for building capture buffers.
    private static func readTapFormat(_ tapID: AudioObjectID) throws -> AVAudioFormat {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        let status = AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, &asbd)
        guard status == noErr else { throw TapError.readFormat(status) }
        guard let format = AVAudioFormat(streamDescription: &asbd) else {
            throw TapError.invalidFormat
        }
        return format
    }

    /// The tap object's HAL-assigned UID (`kAudioTapPropertyUID`), or nil if the
    /// property can't be read.
    private static func readTapUID(_ tapID: AudioObjectID) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size = UInt32(MemoryLayout<CFString?>.size)
        var value: Unmanaged<CFString>?
        let status = AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, &value)
        guard status == noErr, let cf = value else { return nil }
        return cf.takeRetainedValue() as String
    }

    /// A private, auto-starting aggregate device whose only member is the given
    /// tap. Private so it isn't published to other apps; auto-start so it begins
    /// clocking as soon as the IO proc runs.
    private static func createAggregateDevice(tappingUID tapUID: String) throws -> AudioObjectID {
        let description: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Meeting Copilot Aggregate",
            kAudioAggregateDeviceUIDKey: "com.meetingcopilot.aggregate-\(UUID().uuidString)",
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[String: Any]](),
            kAudioAggregateDeviceTapListKey: [
                [
                    kAudioSubTapDriftCompensationKey: true,
                    kAudioSubTapUIDKey: tapUID,
                ]
            ],
        ]
        var aggregateID = AudioObjectID(kAudioObjectUnknown)
        let status = AudioHardwareCreateAggregateDevice(description as CFDictionary, &aggregateID)
        guard status == noErr, aggregateID != AudioObjectID(kAudioObjectUnknown) else {
            throw TapError.createAggregate(status)
        }
        return aggregateID
    }

    /// Resolve this process's Core Audio process-object id (for the tap's
    /// exclude list), or nil if the translation isn't available.
    private static func currentProcessAudioObjectID() -> AudioObjectID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var pid = getpid()
        var object = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            UInt32(MemoryLayout<pid_t>.size),
            &pid,
            &size,
            &object
        )
        guard status == noErr, object != AudioObjectID(kAudioObjectUnknown) else { return nil }
        return object
    }
}
