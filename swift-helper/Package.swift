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
