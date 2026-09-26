import Foundation
import Darwin

// Fixed deployment entry point. The existing app/tunnel/backup launchers stay intact.
guard CommandLine.arguments.count == 1 else { exit(64) }
let home = FileManager.default.homeDirectoryForCurrentUser.path
let state = "\(home)/.config/resume-agent/deployment"
do {
    _ = try Data(contentsOf: URL(fileURLWithPath: "/Volumes/Storage2TB/.resume-agent-volume"))
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/Volumes/Storage2TB/server/resume-agent/release/current/backend/.venv/bin/python")
    process.arguments = ["\(state)/github-deploy.py", "poll", state]
    process.currentDirectoryURL = URL(fileURLWithPath: home)
    process.environment = ["HOME": home, "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8", "TMPDIR": NSTemporaryDirectory()]
    try process.run()
    process.waitUntilExit()
    exit(process.terminationReason == .exit ? process.terminationStatus : 1)
} catch {
    fputs("Deployment could not access its storage or start.\n", stderr)
    exit(1)
}
