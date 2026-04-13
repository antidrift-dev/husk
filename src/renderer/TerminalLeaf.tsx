import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { ImageAddon } from "@xterm/addon-image";
import "@xterm/xterm/css/xterm.css";
import { useTheme } from "./ThemeContext";
import type { SettingsData } from "./Settings";

function scrollbarCss(border: string, faint: string) {
  return `
  .xterm-viewport::-webkit-scrollbar { width: 6px; }
  .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
  .xterm-viewport::-webkit-scrollbar-thumb { background: ${border}; border-radius: 3px; }
  .xterm-viewport::-webkit-scrollbar-thumb:hover { background: ${faint}; }
`;
}

// Global cache of xterm instances — survives React unmount/remount
interface CachedTerminal {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  wrapper: HTMLDivElement;
  cleanupOutput: (() => void) | null;
  obs: ResizeObserver | null;
}

const terminalCache = new Map<string, CachedTerminal>();

// Clean up a pane's cached terminal (call when pane is permanently closed)
export function disposeCachedTerminal(paneId: string) {
  const cached = terminalCache.get(paneId);
  if (cached) {
    cached.obs?.disconnect();
    cached.cleanupOutput?.();
    cached.term.dispose();
    cached.wrapper.remove();
    terminalCache.delete(paneId);
  }
}

interface Props {
  sessionId: string;
  paneId: string;
  focused: boolean;
  showFocusBorder: boolean;
  settings: SettingsData;
  onFocus: () => void;
}

export default function TerminalLeaf({ sessionId, paneId, focused, showFocusBorder, settings, onFocus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // Mount/reparent xterm
  useEffect(() => {
    if (!containerRef.current) return;

    const cached = terminalCache.get(paneId);

    if (cached) {
      // Reparent existing xterm into this container
      containerRef.current.appendChild(cached.wrapper);
      cached.fit.fit();
      if (focused) { cached.term.focus(); cached.term.scrollToBottom(); }
      return () => {
        // Detach but don't destroy — keep in cache
        if (cached.wrapper.parentElement === containerRef.current) {
          containerRef.current?.removeChild(cached.wrapper);
        }
      };
    }

    // First time — create new xterm
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "width:100%;height:100%;";
    containerRef.current.appendChild(wrapper);

    let entry: CachedTerminal | null = null;

    const init = async () => {
      await document.fonts.ready;
      if (!containerRef.current) return;

      const s = settings;
      const term = new Terminal({
        cursorBlink: s.cursorBlink,
        cursorStyle: s.cursorStyle,
        fontSize: s.fontSize,
        fontFamily: s.fontFamily,
        scrollback: s.scrollback,
        theme: {
          background: themeRef.current.terminal.background,
          foreground: themeRef.current.terminal.foreground,
          cursor: themeRef.current.terminal.cursor,
          selectionBackground: themeRef.current.terminal.selectionBackground,
          black: themeRef.current.terminal.black,
          red: themeRef.current.terminal.red,
          green: themeRef.current.terminal.green,
          yellow: themeRef.current.terminal.yellow,
          blue: themeRef.current.terminal.blue,
          magenta: themeRef.current.terminal.magenta,
          cyan: themeRef.current.terminal.cyan,
          white: themeRef.current.terminal.white,
          brightBlack: themeRef.current.terminal.brightBlack,
          brightRed: themeRef.current.terminal.brightRed,
          brightGreen: themeRef.current.terminal.brightGreen,
          brightYellow: themeRef.current.terminal.brightYellow,
          brightBlue: themeRef.current.terminal.brightBlue,
          brightMagenta: themeRef.current.terminal.brightMagenta,
          brightCyan: themeRef.current.terminal.brightCyan,
          brightWhite: themeRef.current.terminal.brightWhite,
        },
        allowProposedApi: true,
        smoothScrollDuration: s.smoothScrolling ? 150 : 0,
        linkHandler: {
          activate: (_e: MouseEvent, uri: string) => { window.open(uri, "_blank"); },
        },
      });

      const fit = new FitAddon();
      const search = new SearchAddon();
      const unicode11 = new Unicode11Addon();
      const clipboard = new ClipboardAddon();

      term.loadAddon(fit);
      term.loadAddon(search);
      term.loadAddon(unicode11);
      term.loadAddon(clipboard);
      term.unicode.activeVersion = "11";

      if (s.fontLigatures) { try { term.loadAddon(new LigaturesAddon()); } catch {} }
      if (s.inlineImages) { try { term.loadAddon(new ImageAddon()); } catch {} }

      term.open(wrapper);

      // WebGL with auto-restore
      const loadWebgl = () => {
        try {
          const addon = new WebglAddon();
          addon.onContextLoss(() => { addon.dispose(); setTimeout(loadWebgl, 100); });
          term.loadAddon(addon);
        } catch {}
      };
      loadWebgl();

      const style = document.createElement("style");
      style.textContent = scrollbarCss(themeRef.current.ui.border, themeRef.current.ui.textFaint);
      wrapper.appendChild(style);

      fit.fit();

      term.onData((data) => window.husk.inputPane(sessionId, paneId, data));
      term.onResize(({ cols, rows }) => window.husk.resizePane(sessionId, paneId, cols, rows));

      // Shift+Enter → send kitty CSI u sequence so Claude Code handles it natively
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === "keydown" && e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          window.husk.inputPane(sessionId, paneId, "\x1b[13;2u");
          return false;
        }
        return true;
      });

      // Output listener
      const cleanupOutput = window.husk.onPaneOutput((sid, pid, data) => {
        if (sid === sessionId && pid === paneId) term.write(data);
      });

      const isFirstTime = await window.husk.subscribePane(sessionId, paneId);

      // Fit observer
      const obs = new ResizeObserver(() => fit.fit());
      obs.observe(wrapper);

      if (isFirstTime) {
        // New pane — clear hold buffer artifacts and nudge shell for clean prompt
        setTimeout(() => {
          term.write("\x1b[2J\x1b[H");
          const dims = fit.proposeDimensions();
          if (dims) {
            window.husk.resizePane(sessionId, paneId, dims.cols - 1, dims.rows);
            setTimeout(() => {
              if (dims) window.husk.resizePane(sessionId, paneId, dims.cols, dims.rows);
            }, 50);
          }
        }, 150);
      }

      entry = { term, fit, search, wrapper, cleanupOutput, obs };
      terminalCache.set(paneId, entry);

      if (focused) term.focus();
    };

    init();

    return () => {
      // Detach wrapper but don't destroy — keep in cache
      if (wrapper.parentElement === containerRef.current) {
        containerRef.current?.removeChild(wrapper);
      }
    };
  }, [sessionId, paneId]);

  // Focus
  useEffect(() => {
    if (!focused) return;
    const focusTerm = (term: Terminal) => {
      term.focus();
      // Prevent scroll-to-top on focus — ensure viewport stays at bottom
      term.scrollToBottom();
    };
    const cached = terminalCache.get(paneId);
    if (cached) {
      focusTerm(cached.term);
    } else {
      const timer = setInterval(() => {
        const c = terminalCache.get(paneId);
        if (c) { focusTerm(c.term); clearInterval(timer); }
      }, 50);
      return () => clearInterval(timer);
    }
  }, [focused, paneId]);

  // Theme update
  useEffect(() => {
    const cached = terminalCache.get(paneId);
    if (!cached) return;
    cached.term.options.theme = {
      background: theme.terminal.background,
      foreground: theme.terminal.foreground,
      cursor: theme.terminal.cursor,
      selectionBackground: theme.terminal.selectionBackground,
      black: theme.terminal.black,
      red: theme.terminal.red,
      green: theme.terminal.green,
      yellow: theme.terminal.yellow,
      blue: theme.terminal.blue,
      magenta: theme.terminal.magenta,
      cyan: theme.terminal.cyan,
      white: theme.terminal.white,
      brightBlack: theme.terminal.brightBlack,
      brightRed: theme.terminal.brightRed,
      brightGreen: theme.terminal.brightGreen,
      brightYellow: theme.terminal.brightYellow,
      brightBlue: theme.terminal.brightBlue,
      brightMagenta: theme.terminal.brightMagenta,
      brightCyan: theme.terminal.brightCyan,
      brightWhite: theme.terminal.brightWhite,
    };
  }, [theme, paneId]);

  // Settings update
  useEffect(() => {
    const cached = terminalCache.get(paneId);
    if (!cached) return;
    cached.term.options.fontSize = settings.fontSize;
    cached.term.options.fontFamily = settings.fontFamily;
    cached.term.options.cursorBlink = settings.cursorBlink;
    cached.term.options.cursorStyle = settings.cursorStyle;
    cached.term.options.scrollback = settings.scrollback;
    cached.term.options.smoothScrollDuration = settings.smoothScrolling ? 150 : 0;
    cached.fit.fit();
  }, [settings, paneId]);

  return (
    <div
      ref={containerRef}
      onClick={onFocus}
      style={{
        flex: 1,
        overflow: "hidden",
        position: "relative",
        paddingTop: 8,
        paddingBottom: 8,
        background: theme.terminal.background,
        borderLeft: showFocusBorder && focused ? `2px solid ${theme.ui.accent}` : showFocusBorder ? `2px solid transparent` : "none",
        transition: "border-color 0.15s ease",
      }}
    />
  );
}
