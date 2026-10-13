import Foundation

/// husk's version: v0.3.<build>, where <build> is the counter in husk/build-number
/// (bumped by husk/build.sh and passed to Xcode as MARKETING_VERSION).
enum HuskVersion {
    static var version: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.3.0"
    }

    static var windowTitle: String { "Husk v\(version)" }

    /// The app's name for user-facing text that Ghostty hard-codes as "Ghostty".
    static var appName: String {
        Bundle.main.infoDictionary?["CFBundleName"] as? String ?? "husk"
    }
}
