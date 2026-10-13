import Darwin
import Foundation

/// Process lookups for the status bar and sidebar, using libproc/sysctl directly
/// (Husk shelled out to `ps`/`pgrep`/`lsof` for these).
enum HuskProcess {
    /// Apps Husk recognises by name, in priority order (husk/src/main/sessions.ts KNOWN_APPS).
    static let knownApps = ["claude", "codex", "gemini", "aider", "copilot", "vim", "nvim",
                            "emacs", "nano", "htop", "top", "docker", "ssh", "git"]

    /// Full command line of a process, from KERN_PROCARGS2.
    static func commandLine(pid: pid_t) -> [String]? {
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 0
        guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > 0 else { return nil }
        var buf = [UInt8](repeating: 0, count: size)
        guard sysctl(&mib, 3, &buf, &size, nil, 0) == 0, size > MemoryLayout<Int32>.size else { return nil }

        let argc = buf.withUnsafeBytes { $0.load(as: Int32.self) }
        var i = MemoryLayout<Int32>.size
        // Skip the executable path and the NUL padding after it.
        while i < size && buf[i] != 0 { i += 1 }
        while i < size && buf[i] == 0 { i += 1 }

        var args: [String] = []
        while args.count < argc && i < size {
            let start = i
            while i < size && buf[i] != 0 { i += 1 }
            args.append(String(decoding: buf[start..<i], as: UTF8.self))
            i += 1
        }
        return args.isEmpty ? nil : args
    }

    /// Executable name of a process.
    static func name(pid: pid_t) -> String? {
        var buf = [CChar](repeating: 0, count: 256)
        guard proc_name(pid, &buf, UInt32(buf.count)) > 0 else { return nil }
        return String(cString: buf)
    }

    /// Short name for what a pid is running: a known app if the command line mentions one
    /// (so `node …/claude` reads as `claude`), otherwise the executable's basename.
    static func displayName(pid: pid_t) -> String? {
        if let args = commandLine(pid: pid) {
            let joined = args.joined(separator: " ").lowercased()
            for app in knownApps where joined.hasPrefix(app) || joined.contains("/\(app)") || joined.contains(" \(app)") {
                return app
            }
            if let first = args.first {
                let base = (first as NSString).lastPathComponent
                return base.hasPrefix("-") ? String(base.dropFirst()) : base
            }
        }
        return name(pid: pid)
    }

    static func children(of pid: pid_t) -> [pid_t] {
        let count = proc_listchildpids(pid, nil, 0)
        guard count > 0 else { return [] }
        var pids = [pid_t](repeating: 0, count: Int(count) * 2)
        let n = proc_listchildpids(pid, &pids, Int32(pids.count * MemoryLayout<pid_t>.size))
        guard n > 0 else { return [] }
        return Array(pids.prefix(Int(n)))
    }

    static func descendants(of pid: pid_t) -> [pid_t] {
        var result: [pid_t] = []
        var queue = [pid]
        while let next = queue.popLast() {
            for child in children(of: next) where !result.contains(child) {
                result.append(child)
                queue.append(child)
            }
        }
        return result
    }

    static func residentBytes(pid: pid_t) -> UInt64 {
        var info = proc_taskinfo()
        let size = Int32(MemoryLayout<proc_taskinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &info, size) == size else { return 0 }
        return info.pti_resident_size
    }

    /// Resident memory of a process and everything under it.
    static func treeResidentBytes(root: pid_t) -> UInt64 {
        ([root] + descendants(of: root)).reduce(0) { $0 + residentBytes(pid: $1) }
    }

    struct Entry: Identifiable {
        let pid: pid_t
        let name: String
        let bytes: UInt64
        var id: pid_t { pid }
    }

    /// Every process under the given roots (roots included), largest first.
    static func breakdown(roots: [pid_t]) -> [Entry] {
        roots.flatMap { [$0] + descendants(of: $0) }
            .map { Entry(pid: $0, name: displayName(pid: $0) ?? "?", bytes: residentBytes(pid: $0)) }
            .filter { $0.bytes > 0 }
            .sorted { $0.bytes > $1.bytes }
    }

    /// Whether `caffeinate` is running anywhere under this process.
    static func hasCaffeinate(under root: pid_t) -> Bool {
        descendants(of: root).contains { name(pid: $0) == "caffeinate" }
    }
}
