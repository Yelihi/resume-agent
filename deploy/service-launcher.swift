import Foundation
import Darwin

// Keep one process identity so launchd stops/restarts the actual server, not just its parent.
let arguments = Array(CommandLine.arguments.dropFirst())
let job = arguments.first ?? "backup"
guard arguments.count <= 1, ["app", "backup"].contains(job) else {
    fputs("Usage: ResumeAgentService [app|backup]\n", stderr)
    exit(64)
}
let home = FileManager.default.homeDirectoryForCurrentUser.path
let release = "/Volumes/Storage2TB/server/resume-agent/release/current"
let script = job == "app" ? "run-app.sh" : "run-backup.sh"
let configuration = job == "app" ? "server.env" : "backup.env"
do {
    // Keep removable-volume access attributed to this app before replacing its process.
    _ = try Data(contentsOf: URL(fileURLWithPath: "/Volumes/Storage2TB/.resume-agent-volume"))
    let command = ["/bin/sh", "\(release)/deploy/\(script)", "\(home)/.config/resume-agent/\(configuration)"]
    let environment = ["HOME=\(home)", "PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", "LANG=en_US.UTF-8", "TMPDIR=\(NSTemporaryDirectory())"]
    let argv = command.map { strdup($0) } + [nil]
    let envp = environment.map { strdup($0) } + [nil]
    defer { argv.forEach { free($0) }; envp.forEach { free($0) } }
    guard chdir(home) == 0 else { exit(1) }
    execve("/bin/sh", argv, envp)
    fputs("Resume Agent Service could not start its job.\n", stderr)
    exit(1)
} catch {
    fputs("Resume Agent Service could not access its storage.\n", stderr)
    exit(1)
}
