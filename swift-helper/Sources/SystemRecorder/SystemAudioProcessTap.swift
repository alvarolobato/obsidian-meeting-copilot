import Foundation
import AVFoundation
import CoreAudio
import AudioToolbox

/// System-audio capture via a Core Audio **process tap** (macOS 14.4+).
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
///   * **Observes every process's output** regardless of which one is playing,
///     via a single global tap.
///
/// ## Hosting the aggregate on the real output device
/// The aggregate is hosted on the **current default output device** (as its main
/// sub-device / clock master), not left as a free-floating tap-only aggregate.
/// A tap-only aggregate makes coreaudiod serialize *other* apps' audio
/// initialization against ours — which blocked conferencing apps (Zoom/Meet)
/// from joining audio until the recording stopped. Hosting on real hardware
/// (the shape AudioCap and Apple's guidance use) avoids that. The tap itself is
/// still global, so what we capture is unchanged; only the clock host differs.
/// A default-output change is watched (`installHealthListeners`) and triggers a
/// rebuild so the aggregate re-hosts on the new device.
///
/// ## Keeping the tap clocked during silence (the real Zoom-hang fix)
/// Hosting on the default output is necessary but **not** sufficient: a global
/// tap's IO cycle is driven by the *system mixer*, which only runs while some
/// process feeds it. When the default output is the always-on built-in, macOS
/// keeps a mixer stream active continuously and the tap clocks even in silence;
/// but a USB/Bluetooth default output lets that mixer stream idle in silence, so
/// the tap stalls — and coreaudiod serializes other apps' (Zoom/Meet) audio init
/// against ours until something plays (the hang). Driving the output *device*
/// directly (a raw `AudioDeviceIOProcID`) runs its hardware clock but bypasses
/// the mixer, so it doesn't help. Instead `startKeepAlive()` renders continuous
/// silence through the **normal output path** (an `AVAudioEngine`) — what
/// "playing music unblocks it" does — routed to the built-in output so it never
/// engages the user's headset. The global tap captures process audio regardless
/// of destination device, so this keeps its mixdown IO cycle running. For the
/// same reason the tap does **not** exclude our own process: an excluded
/// keep-alive stream doesn't wake the tap (verified), and our output is pure
/// silence so including it in the captured mixdown is harmless.
///
/// ## Silence and the IO clock
/// A global process tap only produces IO cycles **while some process is playing
/// audio**; a silent system delivers *no* callbacks at all (verified on macOS
/// 26). Left as-is, the captured system stream would omit every silent interval
/// and drift earlier against the continuously-recorded microphone. To keep the
/// two aligned, the IO block reconstructs the elapsed timeline from the cycle's
/// host timestamp and prepends the missing silent frames as zeros (see
/// `deliver`). It follows that "no callbacks" is a normal silent state — **not**
/// a signal that the tap is dead — so this class does no wall-clock liveness
/// guessing; genuine failures are observed via HAL property listeners
/// (`onNeedsRestart`) and a denied grant surfaces as a `start()` throw.
///
/// Permission: creating/running a tap requires the **System Audio Recording**
/// TCC grant (`Privacy & Security → Screen & System Audio Recording`), which
/// exists from macOS 14.4; it's attributed to the responsible app (Obsidian).
///
/// The tap is `muteBehavior = .unmuted`, so the user keeps hearing the meeting
/// while we observe it. Everything is torn down in `stop()` (idempotent), and a
/// failure at any construction step unwinds what was already created and throws.
@available(macOS 14.4, *)
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

    /// Captured system audio, already in the tap's native format (a global
    /// mono mixdown). The mixer resamples/downmixes to the 24 kHz target. Set
    /// before `start()`; only mutated afterwards under the ioQueue barrier in
    /// `teardown()`, so reads on the IO queue are race-free.
    var onAudioBuffer: ((AVAudioPCMBuffer) -> Void)?

    /// Called (off the IO queue, on `listenerQueue`) when the OS reports the tap
    /// or its aggregate is no longer healthy — coreaudiod restarted, the
    /// aggregate device died, or the tap's stream format changed. The owner
    /// (`AudioCaptureManager`) rebuilds the tap in response. This replaces any
    /// timer-based "is it still alive?" polling, which can't work when silence
    /// legitimately produces no IO cycles.
    var onNeedsRestart: (() -> Void)?

    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    // Keep-alive engine (see `startKeepAlive()`): renders silence through the
    // normal output path so the system mixer — the node the tap observes — keeps
    // clocking during silence. Routed to the built-in output so it never engages
    // the user's headset. Started in `start()`, stopped in `teardown()`.
    private var keepAliveEngine: AVAudioEngine?
    private var ioProcID: AudioDeviceIOProcID?
    private var tapFormat: AVAudioFormat?
    private var bytesPerFrame: UInt32 = 0
    // The IO block is invoked on this serial queue (not a realtime thread), so
    // the per-buffer copy + downstream temp-file write in the mixer can't glitch
    // the audio HAL — matching the SCK path, which runs its handler on a global
    // queue. Teardown drains it with a barrier so no block runs after destroy.
    private let ioQueue = DispatchQueue(label: "com.meetingcopilot.audio-tap-io")
    // HAL property-listener callbacks run here (kept off the IO queue).
    private let listenerQueue = DispatchQueue(label: "com.meetingcopilot.audio-tap-listeners")

    // Registered HAL property listeners, kept so `teardown()` can remove them.
    private var listeners: [(AudioObjectID, AudioObjectPropertyAddress, AudioObjectPropertyListenerBlock)] = []

    // Lifecycle lock: makes `teardown()` idempotent and mutually exclusive, so a
    // listener-driven rebuild and a concurrent `stop()` (from stopCapture) can't
    // free the Core Audio objects twice or race the id writes. The IO block
    // never takes this lock (it only touches ioQueue-local state + the handler,
    // which teardown nils under the ioQueue barrier).
    private let stateLock = NSLock()
    private var stopped = false

    // Silence-gap synthesis state — touched ONLY on the IO queue.
    private var anchorHostTime: UInt64 = 0
    private var deliveredFrames: Int64 = 0

    /// Create the tap + aggregate + IO proc and start clocking. Must run to
    /// completion before the instance is shared with another thread (it does not
    /// take `stateLock`; only teardown does). A failure unwinds via `teardown()`.
    func start() throws {
        // Do NOT exclude our own process. `startKeepAlive()` renders silence
        // through the system mixer to keep the tap clocking during silence; if
        // the tap excluded our process it wouldn't wake on that (only) active
        // stream — verified: with self-exclusion the tap stays at 0 IO cycles in
        // silence. Our output is pure silence, so observing it is harmless.
        let description = CATapDescription(monoGlobalTapButExcludeProcesses: [])
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
            let format = try Self.readTapFormat(tapID)
            tapFormat = format
            let bpf = format.streamDescription.pointee.mBytesPerFrame
            guard bpf > 0 else { throw TapError.invalidFormat }
            bytesPerFrame = bpf
            // Prefer the HAL-assigned tap UID over the description's UUID for the
            // aggregate's sub-tap list (Apple's sample reads it back), falling
            // back to the UUID we set if the property read fails.
            let tapUID = Self.readTapUID(tapID) ?? description.uuid.uuidString
            aggregateID = try Self.createAggregateDevice(
                tappingUID: tapUID,
                outputUID: Self.defaultOutputDeviceUID()
            )
            try startIOProc(format: format)
            startKeepAlive()
            installHealthListeners()
        } catch {
            // Unwind whatever succeeded so a failed start leaves no orphaned
            // tap/aggregate device registered with the HAL.
            teardown()
            throw error
        }
    }

    /// Idempotent teardown: remove listeners, then stop and destroy the IO proc,
    /// aggregate device, and tap, in reverse creation order. Safe to call more
    /// than once, from more than one thread, and on a partially-started tap.
    func stop() {
        teardown()
    }

    // MARK: - IO proc

    private func startIOProc(format: AVAudioFormat) throws {
        anchorHostTime = AudioGetCurrentHostTime()
        deliveredFrames = 0

        var newProcID: AudioDeviceIOProcID?
        let procStatus = AudioDeviceCreateIOProcIDWithBlock(
            &newProcID, aggregateID, ioQueue
        ) { [weak self] _, inInputData, inInputTime, _, _ in
            self?.deliver(inInputData, inputTime: inInputTime)
        }
        guard procStatus == noErr, let procID = newProcID else {
            throw TapError.createIOProc(procStatus)
        }
        ioProcID = procID

        let startStatus = AudioDeviceStart(aggregateID, procID)
        guard startStatus == noErr else { throw TapError.start(startStatus) }
    }

    // MARK: - Keep-alive

    /// Keep the system mixer's IO cycle alive during silence by rendering silence
    /// through the normal output path (`AVAudioEngine` → output device). The tap
    /// observes the mixer's output, which only runs while a process feeds it; a
    /// silent system with a USB/Bluetooth default output lets that cycle idle,
    /// stalling the tap and blocking other apps' audio init (the Zoom hang).
    /// Rendering through the mixer is what "playing music unblocks it" does — a
    /// raw `AudioDeviceIOProcID` on the hardware clocks the device but bypasses
    /// the mixer, so it doesn't help.
    ///
    /// Routed to the **built-in** output (not the default): the global tap
    /// captures process audio regardless of destination, and this avoids opening
    /// an output stream on the user's headset (mic capture + our output on the
    /// same device would flip a Bluetooth/USB headset into call mode). Falls back
    /// to the engine's default output if the built-in can't be resolved/assigned.
    ///
    /// Best-effort: any failure just restores the old "clocks only during
    /// playback" behavior, so it never blocks recording. Torn down in `teardown()`.
    private func startKeepAlive() {
        let engine = AVAudioEngine()
        if let builtInID = Self.builtInOutputDeviceID(),
            let unit = engine.outputNode.audioUnit {
            var device = builtInID
            AudioUnitSetProperty(
                unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global,
                0, &device, UInt32(MemoryLayout<AudioObjectID>.size))
        }
        let format = engine.outputNode.inputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { return }
        let source = AVAudioSourceNode(format: format) { isSilence, _, _, ablPtr in
            let buffers = UnsafeMutableAudioBufferListPointer(ablPtr)
            for buffer in buffers where buffer.mData != nil {
                memset(buffer.mData, 0, Int(buffer.mDataByteSize))
            }
            // Don't flag the buffer as silence, so the engine keeps its IO cycle
            // running instead of optimizing an all-silent stream away.
            isSilence.pointee = false
            return noErr
        }
        engine.attach(source)
        engine.connect(source, to: engine.mainMixerNode, format: format)
        engine.prepare()
        do {
            try engine.start()
            keepAliveEngine = engine
        } catch {
            // Leave keepAliveEngine nil; recording proceeds without the keep-alive.
        }
    }

    /// One IO cycle. Runs on `ioQueue`. Reconstructs any silent gap that the tap
    /// skipped (a global tap clocks only while audio plays) from the cycle's host
    /// timestamp, prepends it as zeros, then delivers the real audio — so the
    /// system stream tracks wall-clock time and stays aligned with the mic.
    private func deliver(
        _ inInputData: UnsafePointer<AudioBufferList>,
        inputTime: UnsafePointer<AudioTimeStamp>
    ) {
        guard let format = tapFormat, let handler = onAudioBuffer else { return }
        guard let pcm = Self.makeBuffer(inInputData, format: format, bytesPerFrame: bytesPerFrame) else {
            return
        }

        // Frames that should have elapsed since `start()` per the host clock.
        // The difference from what we've delivered is the silence to backfill.
        let ts = inputTime.pointee
        if ts.mFlags.contains(.hostTimeValid), ts.mHostTime > anchorHostTime {
            let elapsedNanos =
                AudioConvertHostTimeToNanos(ts.mHostTime)
                - AudioConvertHostTimeToNanos(anchorHostTime)
            let expected = Int64((Double(elapsedNanos) / 1_000_000_000.0 * format.sampleRate).rounded())
            let gap = expected - deliveredFrames
            // Only backfill a real gap (> ~1.5 IO periods); ignore sub-period
            // timestamp jitter during continuous playback, which would otherwise
            // churn tiny zero writes. Cap the fill so a bogus timestamp can't
            // request an unbounded amount of silence.
            let periodFrames = Int64(pcm.frameLength)
            if gap > periodFrames + periodFrames / 2 {
                emitSilence(frames: Self.cappedGap(gap, sampleRate: format.sampleRate),
                            format: format, to: handler)
            }
        }

        handler(pcm)
        deliveredFrames += Int64(pcm.frameLength)
    }

    /// Deliver `frames` of silence in modest chunks (so a long leading gap isn't
    /// one giant allocation) and account for it in `deliveredFrames`.
    private func emitSilence(
        frames: Int64,
        format: AVAudioFormat,
        to handler: (AVAudioPCMBuffer) -> Void
    ) {
        var remaining = frames
        let chunk = max(Int64(format.sampleRate / 2), 1) // ~0.5 s
        while remaining > 0 {
            let n = AVAudioFrameCount(min(remaining, chunk))
            guard let buf = Self.makeSilence(format: format, frames: n) else { break }
            handler(buf)
            deliveredFrames += Int64(n)
            remaining -= Int64(n)
        }
    }

    /// Backfill the silence between the last delivered frame and *now*, so the
    /// system stream reaches wall-clock time before this tap is torn down. The
    /// tap clocks only while audio plays, so at teardown `deliveredFrames` sits
    /// at the last IO cycle — potentially far behind wall-clock if a silent
    /// stretch preceded the teardown. On an in-place rebuild the replacement tap
    /// re-anchors at *now*, so without this flush that entire silent gap is
    /// dropped and every later sample lands early against the mic (the exact
    /// desync `deliver`'s backfill prevents mid-stream). At final stop it's
    /// harmless (the mixer zero-pads the shorter stream anyway). Runs on the IO
    /// queue (touches `deliveredFrames`/`anchorHostTime`); call before nilling
    /// the handler under the teardown barrier.
    private func flushTrailingSilence() {
        guard let format = tapFormat, let handler = onAudioBuffer, anchorHostTime != 0 else {
            return
        }
        let now = AudioGetCurrentHostTime()
        guard now > anchorHostTime else { return }
        let elapsedNanos =
            AudioConvertHostTimeToNanos(now) - AudioConvertHostTimeToNanos(anchorHostTime)
        let expected = Int64((Double(elapsedNanos) / 1_000_000_000.0 * format.sampleRate).rounded())
        let gap = expected - deliveredFrames
        if gap > 0 {
            emitSilence(frames: Self.cappedGap(gap, sampleRate: format.sampleRate),
                        format: format, to: handler)
        }
    }

    /// Clamp a synthesized gap to [0, 1 h] so a single bad timestamp can't write
    /// an absurd amount of zeros.
    private static func cappedGap(_ frames: Int64, sampleRate: Double) -> Int64 {
        let maxFrames = Int64(3600 * sampleRate)
        return min(max(frames, 0), maxFrames)
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
        for i in 0..<dstABL.count {
            guard let dst = dstABL[i].mData else { continue }
            let dstBytes = Int(dstABL[i].mDataByteSize)
            // Zero the destination first: AVAudioPCMBuffer's backing store isn't
            // guaranteed cleared, and a shorter/absent source channel would
            // otherwise leave stale bytes in the uncopied tail.
            memset(dst, 0, dstBytes)
            if i < srcABL.count, let src = srcABL[i].mData {
                memcpy(dst, src, min(Int(srcABL[i].mDataByteSize), dstBytes))
            }
        }
        return pcm
    }

    /// An owned, fully-zeroed buffer of `frames` in `format`, for backfilling
    /// silent gaps the tap skipped.
    private static func makeSilence(format: AVAudioFormat, frames: AVAudioFrameCount) -> AVAudioPCMBuffer? {
        guard frames > 0, let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else {
            return nil
        }
        buf.frameLength = frames
        let abl = UnsafeMutableAudioBufferListPointer(buf.mutableAudioBufferList)
        for b in abl {
            if let d = b.mData { memset(d, 0, Int(b.mDataByteSize)) }
        }
        return buf
    }

    // MARK: - Health listeners

    /// Observe the events that mean the tap really stopped working, so recovery
    /// is edge-triggered (not a timer that can't tell silence from death):
    ///   * the aggregate device going not-alive (`kAudioDevicePropertyDeviceIsAlive`),
    ///   * coreaudiod restarting (`kAudioHardwarePropertyServiceRestarted`),
    ///   * the tap's stream format changing (`kAudioTapPropertyFormat`) — e.g. the
    ///     default output switches to a device at a different sample rate, which
    ///     would otherwise mislabel every subsequent buffer; the rebuild re-reads
    ///     the format.
    private func installHealthListeners() {
        let aggID = aggregateID
        addListener(aggID, kAudioDevicePropertyDeviceIsAlive) { [weak self] in
            guard let self else { return }
            // Only a genuine not-alive transition should force a rebuild.
            if !Self.deviceIsAlive(aggID) { self.onNeedsRestart?() }
        }
        addListener(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyServiceRestarted) {
            [weak self] in self?.onNeedsRestart?()
        }
        addListener(tapID, kAudioTapPropertyFormat) { [weak self] in
            self?.onNeedsRestart?()
        }
        // We now host the aggregate on the current default output device, so a
        // default-output switch (headphones in/out, an app moving audio to its
        // own device) must rebuild the aggregate around the new device —
        // otherwise its clock host is stale. Cheap and edge-triggered, and the
        // rebuild is bounded by the shared restart budget.
        addListener(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultOutputDevice) {
            [weak self] in self?.onNeedsRestart?()
        }
    }

    private func addListener(
        _ objectID: AudioObjectID,
        _ selector: AudioObjectPropertySelector,
        handler: @escaping () -> Void
    ) {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let block: AudioObjectPropertyListenerBlock = { _, _ in handler() }
        let status = AudioObjectAddPropertyListenerBlock(objectID, &address, listenerQueue, block)
        if status == noErr {
            listeners.append((objectID, address, block))
        }
    }

    private static func deviceIsAlive(_ deviceID: AudioObjectID) -> Bool {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceIsAlive,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var alive: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        let status = AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &alive)
        // If the read fails (device already gone), treat it as not-alive.
        return status == noErr && alive != 0
    }

    // MARK: - Teardown

    // Idempotent + thread-safe via `stateLock`. Must NOT be called from the IO
    // queue itself (the `ioQueue.sync` barrier below would self-deadlock) or from
    // `listenerQueue` (removing listeners is fine from any other queue). All
    // current callers run off both: stop(), the start() failure path, and
    // AudioCaptureManager's control-queue recovery path.
    private func teardown() {
        stateLock.lock()
        defer { stateLock.unlock() }
        if stopped { return }
        stopped = true

        // Remove listeners first so none can fire mid-teardown.
        for (obj, var address, block) in listeners {
            AudioObjectRemovePropertyListenerBlock(obj, &address, listenerQueue, block)
        }
        listeners.removeAll()

        // Stop the keep-alive engine (independent of the aggregate/tap).
        if let engine = keepAliveEngine {
            engine.stop()
            keepAliveEngine = nil
        }

        if let procID = ioProcID {
            // Stop the device, then drain the IO queue so any block already
            // dispatched has finished before we destroy the proc/aggregate/tap —
            // otherwise a late block could memcpy from a freed IO buffer. While
            // holding the barrier (no IO cycle can be mid-flight), flush the
            // trailing silence up to now so a rebuild doesn't drop the gap, then
            // detach the handler.
            AudioDeviceStop(aggregateID, procID)
            ioQueue.sync {
                self.flushTrailingSilence()
                self.onAudioBuffer = nil
            }
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

    /// A private, auto-starting aggregate device that hosts the given tap on the
    /// current default output device (`outputUID`) as its clock master. Private
    /// so it isn't published to other apps; auto-start so it begins clocking as
    /// soon as the IO proc runs. Hosting on a real output device — rather than a
    /// free-floating tap-only aggregate — is what keeps coreaudiod from blocking
    /// other apps' (Zoom/Meet) audio init against ours; when the output device
    /// can't be resolved we fall back to the tap-only shape (capture still works,
    /// it just risks the contention this fix addresses).
    private static func createAggregateDevice(
        tappingUID tapUID: String,
        outputUID: String?
    ) throws -> AudioObjectID {
        var description: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Meeting Copilot Aggregate",
            kAudioAggregateDeviceUIDKey: "com.meetingcopilot.aggregate-\(UUID().uuidString)",
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            // Auto-start is the HAL default for a tap aggregate, but set it
            // explicitly so the intent is clear and independent of that default.
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceTapListKey: [
                [
                    kAudioSubTapDriftCompensationKey: true,
                    kAudioSubTapUIDKey: tapUID,
                ]
            ],
        ]
        if let outputUID {
            // Real hardware as the clock master + sole audio sub-device, with the
            // tap drift-compensated against it. This is the AudioCap / Apple
            // sample shape.
            description[kAudioAggregateDeviceMainSubDeviceKey] = outputUID
            description[kAudioAggregateDeviceSubDeviceListKey] = [
                [kAudioSubDeviceUIDKey: outputUID]
            ]
        } else {
            description[kAudioAggregateDeviceSubDeviceListKey] = [[String: Any]]()
        }
        var aggregateID = AudioObjectID(kAudioObjectUnknown)
        let status = AudioHardwareCreateAggregateDevice(description as CFDictionary, &aggregateID)
        guard status == noErr, aggregateID != AudioObjectID(kAudioObjectUnknown) else {
            throw TapError.createAggregate(status)
        }
        return aggregateID
    }

    /// UID of the current default output device (the aggregate's clock host), or
    /// nil if it can't be resolved (the caller then builds a tap-only aggregate).
    private static func defaultOutputDeviceUID() -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var deviceID = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID
        )
        guard status == noErr, deviceID != AudioObjectID(kAudioObjectUnknown) else {
            return nil
        }
        var uidAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var uidSize = UInt32(MemoryLayout<CFString?>.size)
        var value: Unmanaged<CFString>?
        let uidStatus = AudioObjectGetPropertyData(
            deviceID, &uidAddress, 0, nil, &uidSize, &value
        )
        guard uidStatus == noErr, let cf = value else { return nil }
        return cf.takeRetainedValue() as String
    }

    /// The id of a **built-in** output device (transport type "built-in" with at
    /// least one output channel), or nil if the machine has none (e.g. a headless
    /// Mac wired only to external outputs, in which case the keep-alive falls back
    /// to the default output). Independent of which device is currently the
    /// default output — we render the keep-alive silence here so it never engages
    /// the user's (USB/Bluetooth) meeting-audio device.
    private static func builtInOutputDeviceID() -> AudioObjectID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var dataSize: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &dataSize
        ) == noErr, dataSize > 0 else { return nil }
        let count = Int(dataSize) / MemoryLayout<AudioObjectID>.size
        var devices = [AudioObjectID](repeating: AudioObjectID(kAudioObjectUnknown), count: count)
        guard AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &dataSize, &devices
        ) == noErr else { return nil }

        for device in devices where device != AudioObjectID(kAudioObjectUnknown) {
            guard deviceTransportType(device) == kAudioDeviceTransportTypeBuiltIn,
                deviceHasOutputChannels(device)
            else { continue }
            return device
        }
        return nil
    }

    /// A device's transport type (`kAudioDevicePropertyTransportType`), or nil.
    private static func deviceTransportType(_ device: AudioObjectID) -> UInt32? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyTransportType,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var transport: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &transport)
        return status == noErr ? transport : nil
    }

    /// Whether a device exposes at least one output channel (so we don't pick an
    /// input-only built-in device as the keep-alive target).
    private static func deviceHasOutputChannels(_ device: AudioObjectID) -> Bool {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration,
            mScope: kAudioObjectPropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(device, &address, 0, nil, &size) == noErr,
            size > 0 else { return false }
        let ablPtr = UnsafeMutableRawPointer.allocate(
            byteCount: Int(size),
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer { ablPtr.deallocate() }
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, ablPtr) == noErr else {
            return false
        }
        let abl = UnsafeMutableAudioBufferListPointer(
            ablPtr.assumingMemoryBound(to: AudioBufferList.self)
        )
        var channels: UInt32 = 0
        for buffer in abl { channels += buffer.mNumberChannels }
        return channels > 0
    }
}
