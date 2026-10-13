import Foundation

/// Git repo + branch for a directory, read from files only (no `git` subprocess)
/// so it's cheap enough for the status poll. See husk/specs/git-repo-branch-status.md.
struct HuskGitInfo: Equatable {
    let repo: String
    let root: String
    let branch: String
}

/// Details shown in the git popover. Fetched with `git` only when the popover opens.
struct HuskGitDetails {
    var upstream: String?
    var ahead: Int?
    var behind: Int?
    var commit: (sha: String, subject: String, author: String, when: String)?
    var modified: Int?
    var untracked: Int?
    var remotes: [(name: String, url: String)] = []
}

enum HuskGit {
    static func info(for cwd: String) -> HuskGitInfo? {
        let fm = FileManager.default
        var dir = URL(fileURLWithPath: cwd).standardizedFileURL
        while true {
            let dotGit = dir.appendingPathComponent(".git")
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: dotGit.path, isDirectory: &isDir) {
                let gitDir: URL
                if isDir.boolValue {
                    gitDir = dotGit
                } else {
                    // Worktree / submodule: ".git" is a file with "gitdir: <path>"
                    guard let text = try? String(contentsOf: dotGit, encoding: .utf8),
                          let line = text.split(separator: "\n").first(where: { $0.hasPrefix("gitdir:") }) else { return nil }
                    let path = line.dropFirst("gitdir:".count).trimmingCharacters(in: .whitespaces)
                    gitDir = path.hasPrefix("/") ? URL(fileURLWithPath: path) : dir.appendingPathComponent(path)
                }
                guard let head = try? String(contentsOf: gitDir.appendingPathComponent("HEAD"), encoding: .utf8) else { return nil }
                return HuskGitInfo(repo: dir.lastPathComponent, root: dir.path, branch: branch(fromHead: head))
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { return nil }
            dir = parent
        }
    }

    static func branch(fromHead head: String) -> String {
        let trimmed = head.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefix = "ref: refs/heads/"
        if trimmed.hasPrefix(prefix) { return String(trimmed.dropFirst(prefix.count)) }
        if trimmed.hasPrefix("ref: ") { return String(trimmed.dropFirst(5)) }
        return String(trimmed.prefix(7))
    }

    static func details(root: String) -> HuskGitDetails {
        var d = HuskGitDetails()
        d.upstream = run(["rev-parse", "--abbrev-ref", "@{u}"], in: root)
        if d.upstream != nil, let counts = run(["rev-list", "--left-right", "--count", "@{u}...HEAD"], in: root) {
            let parts = counts.split(whereSeparator: { $0 == "\t" || $0 == " " }).compactMap { Int($0) }
            if parts.count == 2 { d.behind = parts[0]; d.ahead = parts[1] }
        }
        if let log = run(["log", "-1", "--format=%h%x00%s%x00%an%x00%cr"], in: root) {
            let f = log.split(separator: "\0", omittingEmptySubsequences: false).map(String.init)
            if f.count == 4 { d.commit = (f[0], f[1], f[2], f[3]) }
        }
        if let status = run(["status", "--porcelain"], in: root, trim: false) {
            let lines = status.split(separator: "\n")
            d.untracked = lines.filter { $0.hasPrefix("??") }.count
            d.modified = lines.count - d.untracked!
        }
        if let remotes = run(["remote", "-v"], in: root) {
            for line in remotes.split(separator: "\n") where line.hasSuffix("(fetch)") {
                let cols = line.split(whereSeparator: { $0 == "\t" || $0 == " " })
                if cols.count >= 2 { d.remotes.append((String(cols[0]), String(cols[1]))) }
            }
        }
        return d
    }

    private static func run(_ args: [String], in dir: String, trim: Bool = true) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        p.arguments = ["-C", dir] + args
        let out = Pipe()
        p.standardOutput = out
        p.standardError = Pipe()
        do { try p.run() } catch { return nil }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { return nil }
        let s = String(decoding: data, as: UTF8.self)
        return trim ? s.trimmingCharacters(in: .whitespacesAndNewlines) : s
    }
}
