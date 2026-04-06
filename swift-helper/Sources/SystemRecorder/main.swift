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

var stopRequested = false
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
