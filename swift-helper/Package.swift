// swift-tools-version: 5.9
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
