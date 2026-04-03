import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { SerializeAddon } from "@xterm/addon-serialize";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import "@xterm/xterm/css/xterm.css";
import "./fonts.css";
import { useTheme } from "./ThemeContext";

function scrollbarCss(border: string, faint: string) {
  return `
  .xterm-viewport::-webkit-scrollbar { width: 6px; }
  .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
  .xterm-viewport::-webkit-scrollbar-thumb { background: ${border}; border-radius: 3px; }
  .xterm-viewport::-webkit-scrollbar-thumb:hover { background: ${faint}; }
`;
}


interface SessionTerminal {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  serialize: SerializeAddon;
  el: HTMLDivElement;
  cleanup: (() => void) | null;
}

interface Props {
  sessionId: string | null;
  settings: import("./Settings").SettingsData;
}

export default function TerminalPane({ sessionId, settings }: Props) {
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const subContainerRef = useRef<HTMLDivElement>(null);
  const terminalsRef = useRef<Map<string, SessionTerminal>>(new Map());
  const subTerminalsRef = useRef<Map<string, SessionTerminal>>(new Map());
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const [cwd, setCwd] = useState<string | null>(null);
  const [fgProcess, setFgProcess] = useState<string | null>(null);
  const [sessionMem, setSessionMem] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Track sub-terminal state with a simple counter to trigger re-renders
  const [subVersion, setSubVersion] = useState(0);
  const subCollapsedRef = useRef<Record<string, boolean>>({});
  const [splitRatio, setSplitRatio] = useState(0.6);
  const draggingSplit = useRef(false);
  const paneRef = useRef<HTMLDivElement>(null);

  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  const getXtermTheme = () => ({
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
  });

  const makeXterm = (container: HTMLElement, onData: (data: string) => void, onResize: (cols: number, rows: number) => void): SessionTerminal => {
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;inset:0;padding:8px 0 0 6px;display:none;`;
    container.appendChild(el);

    const s = settings;
    const term = new Terminal({
      cursorBlink: s.cursorBlink,
      cursorStyle: s.cursorStyle,
      fontSize: s.fontSize,
      fontFamily: s.fontFamily,
      scrollback: s.scrollback,
      theme: getXtermTheme(),
      allowProposedApi: true,
      smoothScrollDuration: s.smoothScrolling ? 150 : 0,
      linkHandler: {
        activate: (_e: MouseEvent, uri: string) => {
          window.open(uri, "_blank");
        },
      },
    });

    const fit = new FitAddon();
    const search = new SearchAddon();
    const serialize = new SerializeAddon();
    const unicode11 = new Unicode11Addon();
    const clipboard = new ClipboardAddon();

    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(serialize);
    term.loadAddon(unicode11);
    term.loadAddon(clipboard);
    term.unicode.activeVersion = "11";
    term.open(el);

    // Font ligatures (only if enabled — slows terminal creation)
    if (settings.fontLigatures) {
      try { term.loadAddon(new LigaturesAddon()); } catch {}
    }

    // Use GPU-accelerated rendering (same as VS Code)
    let webgl: WebglAddon | null = null;
    const webglState = { addon: null as WebglAddon | null };
    const loadWebgl = () => {
      try {
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          addon.dispose();
          webglState.addon = null;
          setTimeout(loadWebgl, 100);
        });
        term.loadAddon(addon);
        webglState.addon = addon;
      } catch {}
    };
    loadWebgl();

    const style = document.createElement("style");
    style.textContent = scrollbarCss(themeRef.current.ui.border, themeRef.current.ui.textFaint);
    el.appendChild(style);

    fit.fit();
    term.onData(onData);
    term.onResize(({ cols, rows }) => onResize(cols, rows));

    return { term, fit, search, serialize, el, cleanup: null };
  };

  const createTerminal = (id: string): SessionTerminal | null => {
    if (!mainContainerRef.current) return null;
    const st = makeXterm(
      mainContainerRef.current,
      (data) => { if (sessionIdRef.current === id) window.husk.inputSession(id, data); },
      (cols, rows) => window.husk.resizeSession(id, cols, rows),
    );
    st.cleanup = window.husk.onPtyOutput((srcId, data) => {
      if (srcId === id) st.term.write(data);
    });
    terminalsRef.current.set(id, st);
    return st;
  };

  const createSubTerminal = (id: string): SessionTerminal => {
    if (!subContainerRef.current) return null;
    const st = makeXterm(
      subContainerRef.current,
      (data) => window.husk.inputSubPty(id, data),
      (cols, rows) => window.husk.resizeSubPty(id, cols, rows),
    );
    st.cleanup = window.husk.onSubPtyOutput((srcId, data) => {
      if (srcId === id) st.term.write(data);
    });
    subTerminalsRef.current.set(id, st);
    return st;
  };

  const destroySubTerminal = (id: string) => {
    const st = subTerminalsRef.current.get(id);
    if (st) {
      st.cleanup?.();
      st.term.dispose();
      st.el.remove();
      subTerminalsRef.current.delete(id);
    }
  };

  // Destroy terminals on session:exited event
  useEffect(() => {
    const cleanup = window.husk.onSessionExited((id) => {
      const st = terminalsRef.current.get(id);
      if (st) {
        st.cleanup?.();
        st.term.dispose();
        st.el.remove();
        terminalsRef.current.delete(id);
      }
      destroySubTerminal(id);
    });
    return cleanup;
  }, []);

  // Apply settings changes to all terminals
  useEffect(() => {
    const apply = (st: SessionTerminal) => {
      st.term.options.fontSize = settings.fontSize;
      st.term.options.fontFamily = settings.fontFamily;
      st.term.options.cursorBlink = settings.cursorBlink;
      st.term.options.cursorStyle = settings.cursorStyle;
      st.term.options.scrollback = settings.scrollback;
      st.term.options.smoothScrollDuration = settings.smoothScrolling ? 150 : 0;
      st.fit.fit();
    };
    for (const st of terminalsRef.current.values()) apply(st);
    for (const st of subTerminalsRef.current.values()) apply(st);
  }, [settings]);

  // Update all terminals when theme changes
  useEffect(() => {
    const xtermTheme = getXtermTheme();
    for (const st of terminalsRef.current.values()) st.term.options.theme = xtermTheme;
    for (const st of subTerminalsRef.current.values()) st.term.options.theme = xtermTheme;
  }, [theme]);

  // Show/hide terminals based on active session, create on demand
  useEffect(() => {
    // Create terminal if it doesn't exist yet
    if (sessionId && !terminalsRef.current.has(sessionId) && mainContainerRef.current) {
      createTerminal(sessionId);
    }

    for (const [id, st] of terminalsRef.current) {
      if (id === sessionId) {
        st.el.style.display = "block";
        st.fit.fit();
        st.term.focus();
      } else {
        st.el.style.display = "none";
      }
    }
    for (const [id, st] of subTerminalsRef.current) {
      const visible = id === sessionId && !subCollapsedRef.current[id];
      st.el.style.display = visible ? "block" : "none";
      if (visible) st.fit.fit();
    }

    if (!sessionId) {
      setCwd(null);
      setFgProcess(null);
    }

    const refocus = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, button, [role='menu']")) return;
      if (e.type === "click" && paneRef.current && !paneRef.current.contains(target)) return;
      if (sessionId) {
        const subSt = subTerminalsRef.current.get(sessionId);
        if (subSt && subContainerRef.current?.contains(target)) {
          subSt.term.focus();
        } else {
          terminalsRef.current.get(sessionId)?.term.focus();
        }
      }
    };
    window.addEventListener("focus", refocus);
    window.addEventListener("click", refocus);
    return () => {
      window.removeEventListener("focus", refocus);
      window.removeEventListener("click", refocus);
    };
  }, [sessionId, subVersion]);

  // Fit terminals on container resize
  useEffect(() => {
    if (!mainContainerRef.current) return;
    const obs = new ResizeObserver(() => {
      if (!sessionId) return;
      terminalsRef.current.get(sessionId)?.fit.fit();
      const subSt = subTerminalsRef.current.get(sessionId);
      if (subSt && !subCollapsedRef.current[sessionId]) subSt.fit.fit();
    });
    obs.observe(mainContainerRef.current);
    if (subContainerRef.current) obs.observe(subContainerRef.current);
    return () => obs.disconnect();
  }, [sessionId, subVersion]);

  // Cmd+D toggle
  useEffect(() => {
    const cleanup = window.husk.onToggleSub(async () => {
      const id = sessionIdRef.current;
      if (!id) return;
      const hasSub = subTerminalsRef.current.has(id);
      if (hasSub) {
        if (subCollapsedRef.current[id]) {
          subCollapsedRef.current[id] = false;
          setSubVersion((v) => v + 1);
        } else {
          await window.husk.closeSubPty(id);
          destroySubTerminal(id);
          delete subCollapsedRef.current[id];
          setSubVersion((v) => v + 1);
        }
      } else {
        const ok = await window.husk.createSubPty(id);
        if (ok) {
          subCollapsedRef.current[id] = false;
          setSubVersion((v) => v + 1);
          requestAnimationFrame(() => {
            if (!subTerminalsRef.current.has(id)) {
              createSubTerminal(id);
              const st = subTerminalsRef.current.get(id);
              if (st) {
                st.el.style.display = "block";
                st.fit.fit();
                st.term.focus();
              }
            }
          });
        }
      }
    });
    return cleanup;
  }, []);

  // Sub PTY exit
  useEffect(() => {
    const cleanup = window.husk.onSubPtyExited((id) => {
      destroySubTerminal(id);
      delete subCollapsedRef.current[id];
      setSubVersion((v) => v + 1);
    });
    return cleanup;
  }, []);

  // Cmd+F search
  useEffect(() => {
    const cleanup = window.husk.onSearchTerminal(() => {
      setSearchOpen((open) => {
        if (!open) {
          setTimeout(() => searchInputRef.current?.focus(), 50);
          return true;
        }
        // Close and clear
        const id = sessionIdRef.current;
        if (id) {
          const st = terminalsRef.current.get(id);
          st?.search.clearDecorations();
        }
        setSearchQuery("");
        return false;
      });
    });
    return cleanup;
  }, []);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    const id = sessionIdRef.current;
    if (!id) return;
    const st = terminalsRef.current.get(id);
    if (!st) return;
    if (query) {
      st.search.findNext(query, { caseSensitive: false });
    } else {
      st.search.clearDecorations();
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      const id = sessionIdRef.current;
      const st = id ? terminalsRef.current.get(id) : null;
      if (st && searchQuery) {
        if (e.shiftKey) st.search.findPrevious(searchQuery, { caseSensitive: false });
        else st.search.findNext(searchQuery, { caseSensitive: false });
      }
    }
    if (e.key === "Escape") {
      const id = sessionIdRef.current;
      const st = id ? terminalsRef.current.get(id) : null;
      st?.search.clearDecorations();
      setSearchOpen(false);
      setSearchQuery("");
      if (id) terminalsRef.current.get(id)?.term.focus();
    }
  };

  // Split drag
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingSplit.current || !paneRef.current) return;
      const rect = paneRef.current.getBoundingClientRect();
      const ratio = Math.max(0.2, Math.min(0.8, (e.clientY - rect.top) / rect.height));
      setSplitRatio(ratio);
    };
    const onMouseUp = () => { draggingSplit.current = false; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Refit after split ratio changes
  useEffect(() => {
    if (!sessionId) return;
    requestAnimationFrame(() => {
      terminalsRef.current.get(sessionId)?.fit.fit();
      subTerminalsRef.current.get(sessionId)?.fit.fit();
    });
  }, [splitRatio]);

  // Poll cwd + foreground process
  useEffect(() => {
    if (!sessionId) {
      setCwd(null);
      setFgProcess(null);
      setSessionMem(null);
      return;
    }
    const pollStatus = async () => {
      const [dir, proc, mem] = await Promise.all([
        window.husk.getCwd(sessionId),
        window.husk.getForegroundProcess(sessionId),
        window.husk.getSessionMemory(sessionId),
      ]);
      setCwd(dir);
      setFgProcess(proc);
      setSessionMem(mem);
    };
    const poll = setInterval(pollStatus, 2000);
    pollStatus();
    return () => clearInterval(poll);
  }, [sessionId]);

  const hasSubOpen = sessionId ? subTerminalsRef.current.has(sessionId) : false;
  const isSubCollapsed = sessionId ? !!subCollapsedRef.current[sessionId] : true;

  return (
    <div ref={paneRef} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: theme.ui.bg, overflow: "hidden" }}>
      {/* Search bar */}
      {searchOpen && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 8px",
          background: theme.ui.bgAlt,
          borderBottom: `1px solid ${theme.ui.border}`,
        }}>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search..."
            style={{
              flex: 1,
              background: theme.ui.bg,
              color: theme.ui.text,
              border: `1px solid ${theme.ui.border}`,
              borderRadius: 4,
              padding: "4px 8px",
              fontSize: 12,
              fontFamily: "monospace",
              outline: "none",
            }}
          />
          <span style={{ fontSize: 11, color: theme.ui.textFaint }}>
            Enter/Shift+Enter &middot; Esc to close
          </span>
        </div>
      )}
      {/* Main terminal */}
      <div
        ref={mainContainerRef}
        style={{
          flex: hasSubOpen && !isSubCollapsed ? `0 0 ${splitRatio * 100}%` : "1",
          overflow: "hidden",
          position: "relative",
        }}
      />

      {/* Split drag handle */}
      {hasSubOpen && !isSubCollapsed && (
        <div
          onMouseDown={() => { draggingSplit.current = true; }}
          style={{
            height: 4,
            cursor: "row-resize",
            background: theme.ui.border,
            flexShrink: 0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = theme.ui.textFaint)}
          onMouseLeave={(e) => { if (!draggingSplit.current) e.currentTarget.style.background = theme.ui.border; }}
        />
      )}

      {/* Sub terminal collapse bar */}
      {hasSubOpen && (
        <div
          onClick={() => { subCollapsedRef.current[sessionId!] = !isSubCollapsed; setSubVersion((v) => v + 1); }}
          style={{
            height: 22,
            padding: "0 8px",
            background: theme.ui.bgAlt,
            borderTop: `1px solid ${theme.ui.border}`,
            color: theme.ui.textMuted,
            fontSize: 11,
            fontFamily: "monospace",
            display: "flex",
            alignItems: "center",
            cursor: "pointer",
            userSelect: "none",
            gap: 6,
          }}
        >
          <span>{isSubCollapsed ? "▶" : "▼"}</span>
          <span>split terminal</span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              if (sessionId) {
                window.husk.closeSubPty(sessionId);
                destroySubTerminal(sessionId);
                delete subCollapsedRef.current[sessionId];
                setSubVersion((v) => v + 1);
              }
            }}
            style={{ marginLeft: "auto", cursor: "pointer", color: theme.ui.textFaint }}
            onMouseEnter={(e) => (e.currentTarget.style.color = theme.ui.text)}
            onMouseLeave={(e) => (e.currentTarget.style.color = theme.ui.textFaint)}
          >
            ✕
          </span>
        </div>
      )}

      {/* Sub terminal — always in DOM so ref is available */}
      <div
        ref={subContainerRef}
        style={{
          flex: hasSubOpen && !isSubCollapsed ? `0 0 ${(1 - splitRatio) * 100}%` : "0 0 0px",
          overflow: "hidden",
          position: "relative",
        }}
      />

      {/* Status bar */}
      <div
        style={{
          height: 26,
          padding: "0 10px",
          borderTop: `1px solid ${theme.ui.border}`,
          background: theme.ui.bg,
          color: theme.ui.textMuted,
          fontSize: 12,
          fontFamily: "monospace",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{cwd || "\u00a0"}</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {sessionMem != null && <span>session memory: {sessionMem} MB</span>}
          <span style={{ width: 1, height: 12, background: theme.ui.border }} />
          {fgProcess || "terminal"}
        </span>
      </div>
    </div>
  );
}
