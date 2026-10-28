import AppKit
import SwiftUI

/// Husk's status bar (husk/src/renderer/App.tsx): cwd, git repo + branch,
/// session memory, free disk, and the foreground process with Claude context.
struct HuskStatusBar: View {
    @ObservedObject private var model = HuskModel.shared
    weak var controller: TerminalController?

    @State private var showGit = false
    @State private var gitDetails: HuskGitDetails?
    @State private var showContext = false
    @State private var showMemory = false
    @State private var breakdown: [HuskProcess.Entry]?

    var body: some View {
        let status = controller.map { model.status(for: $0) } ?? HuskTabStatus()
        HStack(spacing: 14) {
            if let updates = (NSApp.delegate as? AppDelegate)?.updateViewModel {
                HuskUpdateButton(model: updates)
            }

            Text(status.cwd ?? " ")
                .lineLimit(1)
                .truncationMode(.head)
                .help(status.cwd ?? "")

            if let git = status.git {
                Button(action: { toggleGit(git) }) {
                    Text("\(git.repo) ⎇ \(git.branch)")
                        .underline(pattern: .dot)
                }
                .buttonStyle(.plain)
                .help(git.root)
                .popover(isPresented: $showGit, arrowEdge: .top) {
                    HuskGitPopover(info: git, details: gitDetails)
                }
            }

            Spacer(minLength: 8)

            if let mem = status.memoryMB {
                Button(action: toggleMemory) {
                    Text("memory used: \(mem) MB").underline(pattern: .dot)
                }
                .buttonStyle(.plain)
                .popover(isPresented: $showMemory, arrowEdge: .top) {
                    HuskMemoryPopover(entries: breakdown)
                }
            }
            if let disk = model.diskAvailableGB {
                Text("disk: \(disk) GB (avail)")
            }
            processView(status)
        }
        .font(.system(size: 12, design: .monospaced))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .frame(height: 34)
    }

    @ViewBuilder
    private func processView(_ status: HuskTabStatus) -> some View {
        if let ctx = status.agentContext, let process = status.process {
            let ratio = Double(ctx.tokens) / Double(ctx.contextWindow)
            Button(action: { showContext.toggle() }) {
                Text("\(process) (ctx: \(HuskClaude.formatTokens(ctx.tokens)))")
                    .underline(pattern: .dot)
                    .foregroundStyle(ratio > 0.9 ? Color.red : ratio > 0.75 ? Color.yellow : Color.secondary)
            }
            .buttonStyle(.plain)
            .popover(isPresented: $showContext, arrowEdge: .top) {
                HuskContextPopover(ctx: ctx)
            }
        } else {
            Text(status.process ?? "terminal")
        }
        if !status.otherSessions.isEmpty {
            otherSessionsView(status.otherSessions)
        }
    }

    /// "+1 session here (ctx: 120k)": other Claude Code or Codex sessions in the same folder,
    /// which are usually started by accident.
    private func otherSessionsView(_ others: [HuskOtherSession]) -> some View {
        let sizes = others.map { $0.context.map { HuskClaude.formatTokens($0.tokens) } ?? "?" }
        let noun = others.count == 1 ? "session" : "sessions"
        return Text("+\(others.count) \(noun) here (ctx: \(sizes.joined(separator: ", ")))")
            .foregroundStyle(Color.orange)
            .help("Other \(noun) running in this folder: \(others.map { "\($0.agent) pid \($0.pid)" }.joined(separator: ", "))")
    }

    private func toggleMemory() {
        showMemory.toggle()
        guard showMemory, let controller else { return }
        breakdown = nil
        let roots = model.childPids(of: controller)
        DispatchQueue.global(qos: .userInitiated).async {
            let entries = HuskProcess.breakdown(roots: roots)
            DispatchQueue.main.async { breakdown = entries }
        }
    }

    private func toggleGit(_ git: HuskGitInfo) {
        showGit.toggle()
        guard showGit else { return }
        gitDetails = nil
        let root = git.root
        DispatchQueue.global(qos: .userInitiated).async {
            let details = HuskGit.details(root: root)
            DispatchQueue.main.async { gitDetails = details }
        }
    }
}

private struct HuskGitPopover: View {
    let info: HuskGitInfo
    let details: HuskGitDetails?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(info.repo).font(.system(size: 13, weight: .semibold))
            Text((info.root as NSString).abbreviatingWithTildeInPath).foregroundStyle(.secondary)
            Divider()
            if let d = details {
                row("branch", branchText(d))
                if let c = d.commit {
                    row("commit", "\(c.sha)  \(c.subject)")
                    row("", "\(c.author) · \(c.when)")
                }
                if let m = d.modified, let u = d.untracked {
                    row("changes", m == 0 && u == 0 ? "clean" : "\(m) modified · \(u) untracked")
                }
                if !d.remotes.isEmpty {
                    Divider()
                    Text("remotes").foregroundStyle(.secondary)
                    ForEach(d.remotes, id: \.name) { remote in
                        HStack(alignment: .firstTextBaseline) {
                            Text(remote.name).frame(width: 70, alignment: .leading)
                            Button(remote.url) {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(remote.url, forType: .string)
                            }
                            .buttonStyle(.plain)
                            .help("Copy URL")
                        }
                    }
                }
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .font(.system(size: 12, design: .monospaced))
        .padding(14)
        .frame(minWidth: 380, alignment: .leading)
    }

    private func branchText(_ d: HuskGitDetails) -> String {
        var s = info.branch
        if let up = d.upstream {
            s += " → \(up)"
            if let a = d.ahead, let b = d.behind { s += "   ↑\(a) ↓\(b)" }
        }
        return s
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary).frame(width: 70, alignment: .leading)
            Text(value).textSelection(.enabled)
        }
    }
}

/// Husk's perf monitor: every process in the session, largest first.
private struct HuskMemoryPopover: View {
    let entries: [HuskProcess.Entry]?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("processes in this session").foregroundStyle(.secondary)
            Divider()
            if let entries {
                ForEach(entries.prefix(20)) { e in
                    HStack {
                        Text(e.name).lineLimit(1)
                        Text("\(e.pid)").foregroundStyle(.secondary)
                        Spacer()
                        Text("\(e.bytes / 1_048_576) MB")
                    }
                }
            } else {
                ProgressView().controlSize(.small)
            }
        }
        .font(.system(size: 12, design: .monospaced))
        .padding(14)
        .frame(minWidth: 300)
    }
}

private struct HuskContextPopover: View {
    let ctx: HuskClaudeContext

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            row("model", ctx.model ?? "unknown")
            row("context window", ctx.contextWindow.formatted())
            row("context used", "\(ctx.tokens.formatted()) (\(Int(Double(ctx.tokens) / Double(ctx.contextWindow) * 100))%)")
            Divider()
            row("input", ctx.inputTokens.formatted())
            row("cache read", ctx.cacheReadTokens.formatted())
            row("cache write", ctx.cacheCreationTokens.formatted())
            row("output", ctx.outputTokens.formatted())
        }
        .font(.system(size: 12, design: .monospaced))
        .padding(14)
        .frame(minWidth: 280)
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value)
        }
    }
}

/// A small circle in the update pill's colors: Ghostty's UpdateBadge for the current state, with the
/// same popover and the same "No Updates" auto-dismiss as UpdatePill. Hidden while there is nothing to say.
private struct HuskUpdateButton: View {
    @ObservedObject var model: UpdateViewModel
    @State private var showPopover = false
    @State private var resetTask: Task<Void, Never>?

    /// The download icon when an update is waiting; the spinner, progress or error badge for the other states.
    @ViewBuilder
    private var badge: some View {
        if case .updateAvailable = model.state {
            HuskDownloadIcon().stroke(style: StrokeStyle(lineWidth: 1, lineCap: .round, lineJoin: .round))
        } else {
            UpdateBadge(model: model)
        }
    }

    var body: some View {
        if !model.state.isHidden {
            Button(action: {
                if case .notFound(let notFound) = model.state {
                    model.state = .idle
                    notFound.acknowledgement()
                } else {
                    showPopover.toggle()
                }
            }, label: {
                badge
                    .frame(width: 16, height: 16)
                    .padding(4)
                    .background(Circle().fill(model.backgroundColor))
                    .foregroundColor(model.foregroundColor)
                    .contentShape(Circle())
            })
            .buttonStyle(.plain)
            .help(model.text)
            .accessibilityLabel(model.text)
            .popover(isPresented: $showPopover, arrowEdge: .top) {
                UpdatePopoverView(model: model)
            }
            .onChange(of: model.state) { newState in
                resetTask?.cancel()
                if case .notFound(let notFound) = newState {
                    resetTask = Task {
                        try? await Task.sleep(for: .seconds(5))
                        guard !Task.isCancelled, case .notFound = model.state else { return }
                        model.state = .idle
                        notFound.acknowledgement()
                    }
                } else {
                    resetTask = nil
                }
            }
        }
    }
}

/// Tabler "arrow-bar-to-down" (24 x 24 viewBox, stroke width 1, round caps and joins).
private struct HuskDownloadIcon: Shape {
    func path(in rect: CGRect) -> Path {
        let k = min(rect.width, rect.height) / 24
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * k, y: rect.minY + y * k)
        }
        var path = Path()
        path.move(to: point(4, 20)); path.addLine(to: point(20, 20))
        path.move(to: point(12, 14)); path.addLine(to: point(12, 4))
        path.move(to: point(12, 14)); path.addLine(to: point(16, 10))
        path.move(to: point(12, 14)); path.addLine(to: point(8, 10))
        return path
    }
}
