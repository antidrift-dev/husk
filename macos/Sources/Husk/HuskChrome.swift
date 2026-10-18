import AppKit
import SwiftUI

/// Wraps Ghostty's terminal view with Husk's sidebar (left), status bar (bottom) and the Specs
/// drawer, which slides up over the bottom of the terminal.
/// Both are painted with the terminal theme's background so they match it.
struct HuskChrome<Content: View>: View {
    @ObservedObject private var model = HuskModel.shared
    weak var controller: TerminalController?
    @ViewBuilder let content: Content

    var body: some View {
        let background = controller?.ghostty.config.backgroundColor ?? Color(NSColor.windowBackgroundColor)
        let scheme: ColorScheme = Self.isDark(background) ? .dark : .light
        HStack(spacing: 0) {
            if model.showSidebar {
                HuskSidebar(controller: controller)
                    .frame(width: 130)
                    .background(background.overlay(Color.black.opacity(scheme == .dark ? 0.18 : 0.05)))
                Divider()
            }
            VStack(spacing: 0) {
                content
                    .overlay {
                        if let controller {
                            HuskSpecsOverlay(controller: controller, state: controller.husk.specs, background: background)
                        }
                    }
                Divider()
                HuskStatusBar(controller: controller)
                    .background(background)
            }
        }
        .environment(\.colorScheme, scheme)
    }

    static func isDark(_ color: Color) -> Bool {
        guard let rgb = NSColor(color).usingColorSpace(.sRGB) else { return true }
        let luminance = 0.2126 * rgb.redComponent + 0.7152 * rgb.greenComponent + 0.0722 * rgb.blueComponent
        return luminance < 0.5
    }
}
