import Foundation
import Testing
@testable import Ghostty

// Ported from husk/src/renderer/dir-label.test.ts
struct HuskDirLabelTests {
    let home = "/Users/chris"

    @Test func usesLastPathSegment() {
        #expect(HuskDirLabel.label(for: "/Users/chris/Projects/dockhand", home: home) == "dockhand")
    }

    @Test func ignoresTrailingSlash() {
        #expect(HuskDirLabel.label(for: "/Users/chris/Projects/dockhand/", home: home) == "dockhand")
    }

    @Test func homeIsTilde() {
        #expect(HuskDirLabel.label(for: "/Users/chris", home: home) == "~")
        #expect(HuskDirLabel.label(for: "/Users/chris/", home: home) == "~")
    }

    @Test func rootIsSlash() {
        #expect(HuskDirLabel.label(for: "/", home: home) == "/")
    }

    @Test func keepsSpaces() {
        #expect(HuskDirLabel.label(for: "/Users/chris/My Projects/side gig", home: home) == "side gig")
    }

    @Test func homePrefixedSiblingIsNotHome() {
        #expect(HuskDirLabel.label(for: "/Users/chris2", home: home) == "chris2")
    }
}

struct HuskGitTests {
    @Test func branchFromSymbolicRef() {
        #expect(HuskGit.branch(fromHead: "ref: refs/heads/main\n") == "main")
        #expect(HuskGit.branch(fromHead: "ref: refs/heads/feature/x\n") == "feature/x")
    }

    @Test func detachedHeadIsShortSha() {
        #expect(HuskGit.branch(fromHead: "d5fdc57a1b2c3d4e5f60718293a4b5c6d7e8f901\n") == "d5fdc57")
    }

    @Test func walksUpToRepoRoot() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("husk-git-\(UUID().uuidString)")
        let nested = root.appendingPathComponent("a/b")
        try FileManager.default.createDirectory(at: root.appendingPathComponent(".git"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        try "ref: refs/heads/dev\n".write(to: root.appendingPathComponent(".git/HEAD"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: root) }

        let info = try #require(HuskGit.info(for: nested.path))
        #expect(info.branch == "dev")
        #expect(info.repo == root.lastPathComponent)
    }

    @Test func worktreeGitFile() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("husk-wt-\(UUID().uuidString)")
        let gitDir = base.appendingPathComponent("main/.git/worktrees/wt")
        let wt = base.appendingPathComponent("wt")
        try FileManager.default.createDirectory(at: gitDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: wt, withIntermediateDirectories: true)
        try "ref: refs/heads/topic\n".write(to: gitDir.appendingPathComponent("HEAD"), atomically: true, encoding: .utf8)
        try "gitdir: \(gitDir.path)\n".write(to: wt.appendingPathComponent(".git"), atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: base) }

        #expect(HuskGit.info(for: wt.path)?.branch == "topic")
    }

    @Test func noRepoIsNil() {
        #expect(HuskGit.info(for: "/") == nil)
    }
}

@Suite(.serialized) struct HuskClaudeTests {
    /// A transcript in a folder named the way Claude Code names it for a dotted path
    /// (~/Antidrift.io → -Users-chris-Antidrift-io), found by session ID alone.
    @Test func findsTranscriptBySessionId() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("husk-\(UUID().uuidString)")
        let folder = root.appendingPathComponent("-Users-chris-Antidrift-io")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let line = #"{"message":{"model":"claude-sonnet-5-5","usage":{"input_tokens":5,"cache_read_input_tokens":4000,"cache_creation_input_tokens":0}}}"#
        try line.write(to: folder.appendingPathComponent("abc-123.jsonl"), atomically: true, encoding: .utf8)

        let saved = HuskClaude.projectsRoot
        HuskClaude.projectsRoot = root
        defer { HuskClaude.projectsRoot = saved }

        let session = HuskClaudeSession(pid: 1, sessionId: "abc-123", cwd: "/Users/chris/Antidrift.io")
        #expect(HuskClaude.context(for: session)?.tokens == 4005)
        #expect(HuskClaude.context(for: HuskClaudeSession(pid: 1, sessionId: "missing", cwd: "/x")) == nil)
    }

    @Test func matchesTabToItsOwnSession() {
        let sessions = [
            HuskClaudeSession(pid: 100, sessionId: "a", cwd: "/p"),
            HuskClaudeSession(pid: 200, sessionId: "b", cwd: "/p"),
        ]
        #expect(HuskClaude.session(foregroundPid: 200, among: sessions)?.sessionId == "b")
        #expect(HuskClaude.session(foregroundPid: 0, among: sessions) == nil)
    }

    @Test func listsOtherSessionsInTheSameFolderOnly() {
        let sessions = [
            HuskClaudeSession(pid: 100, sessionId: "a", cwd: "/p"),
            HuskClaudeSession(pid: 300, sessionId: "c", cwd: "/p"),
            HuskClaudeSession(pid: 200, sessionId: "b", cwd: "/p/sub"),
        ]
        #expect(HuskClaude.others(of: sessions[0], among: sessions).map(\.pid) == [300])
        #expect(HuskClaude.others(of: sessions[2], among: sessions).isEmpty)
    }

    /// Session files whose process isn't a live `claude` (crashed, or the pid reused) are skipped.
    @Test func skipsSessionFilesWithoutALiveClaude() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("husk-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        for pid in [getpid(), 999_999] {
            let json = #"{"pid":\#(pid),"sessionId":"s\#(pid)","cwd":"/p"}"#
            try json.write(to: root.appendingPathComponent("\(pid).json"), atomically: true, encoding: .utf8)
        }

        let saved = HuskClaude.sessionsRoot
        HuskClaude.sessionsRoot = root
        defer { HuskClaude.sessionsRoot = saved }

        #expect(HuskClaude.liveSessions().isEmpty)
    }

    @Test func parsesLastUsageEntry() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("husk-\(UUID().uuidString).jsonl")
        let lines = [
            #"{"type":"user","message":{"content":"hi"}}"#,
            #"{"type":"assistant","message":{"model":"claude-opus-5-5","usage":{"input_tokens":10,"cache_read_input_tokens":1000,"cache_creation_input_tokens":90,"output_tokens":5}}}"#,
            #"{"type":"assistant","message":{"model":"claude-opus-5-5","usage":{"input_tokens":20,"cache_read_input_tokens":2000,"cache_creation_input_tokens":80,"output_tokens":7}}}"#,
        ]
        try lines.joined(separator: "\n").write(to: file, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: file) }

        let ctx = try #require(HuskClaude.parse(file))
        #expect(ctx.tokens == 2100)
        #expect(ctx.outputTokens == 7)
        #expect(ctx.model == "claude-opus-5-5")
        #expect(ctx.contextWindow == 200_000)
    }

    @Test func detectsMillionTokenWindow() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("husk-\(UUID().uuidString).jsonl")
        let lines = [
            #"{"message":{"usage":{"input_tokens":1,"cache_read_input_tokens":300000,"cache_creation_input_tokens":0}}}"#,
            #"{"message":{"usage":{"input_tokens":1,"cache_read_input_tokens":1000,"cache_creation_input_tokens":0}}}"#,
        ]
        try lines.joined(separator: "\n").write(to: file, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: file) }

        #expect(HuskClaude.parse(file)?.contextWindow == 1_000_000)
    }

    @Test func formatsTokens() {
        #expect(HuskClaude.formatTokens(950) == "950")
        #expect(HuskClaude.formatTokens(123_456) == "123k")
        #expect(HuskClaude.formatTokens(1_200_000) == "1.2M")
    }
}

struct HuskProcessTests {
    @Test func shellsAreGreyLikeHusk() {
        #expect(HuskProcessColors.nsColor(for: "zsh") == HuskProcessColors.nsColor(for: "bash"))
        #expect(HuskProcessColors.color(for: "zsh") != nil)
        #expect(HuskProcessColors.color(for: "unknown-tool") == nil)
        #expect(HuskProcessColors.color(for: nil) == nil)
    }

    @Test func knownAppsHaveColor() {
        #expect(HuskProcessColors.color(for: "claude") != nil)
        #expect(HuskProcessColors.color(for: "ssh") != nil)
    }

    @Test func readsOwnCommandLine() {
        let args = HuskProcess.commandLine(pid: getpid())
        #expect(args?.isEmpty == false)
    }

    @Test func ownProcessHasMemory() {
        #expect(HuskProcess.residentBytes(pid: getpid()) > 0)
    }
}

struct HuskCodexTests {
    @Test func parsesLastTokenCount() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("codex-\(UUID().uuidString).jsonl")
        let lines = [
            #"{"type":"event_msg","payload":{"type":"task_started","model_context_window":272000}}"#,
            #"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":5000,"cached_input_tokens":4000,"output_tokens":300}}}}"#,
            #"{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":9000,"cached_input_tokens":8000,"output_tokens":120}}}}"#,
        ]
        try lines.joined(separator: "\n").write(to: file, atomically: true, encoding: .utf8)
        defer { try? FileManager.default.removeItem(at: file) }

        let ctx = try #require(HuskCodex.parse(file, model: "gpt-5-codex"))
        #expect(ctx.tokens == 9000)
        #expect(ctx.inputTokens == 1000)
        #expect(ctx.cacheReadTokens == 8000)
        #expect(ctx.contextWindow == 272_000)
        #expect(ctx.model == "gpt-5-codex")
    }

    @Test func missingDatabaseIsNil() {
        let saved = HuskCodex.databasePath
        HuskCodex.databasePath = "/nonexistent/state.sqlite"
        defer { HuskCodex.databasePath = saved }
        #expect(HuskCodex.context(for: "/tmp") == nil)
    }
}
