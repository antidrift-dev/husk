import { useRef } from "react";
import { PaneNode } from "./pane-tree";
import TerminalLeaf from "./TerminalLeaf";
import { useTheme } from "./ThemeContext";
import type { SettingsData } from "./Settings";

interface Props {
  node: PaneNode;
  sessionId: string;
  focusedPaneId: string;
  settings: SettingsData;
  onFocus: (paneId: string) => void;
  onRatioChange: (splitId: string, ratio: number) => void;
  isSplit?: boolean;
}

export default function SplitPaneContainer({ node, sessionId, focusedPaneId, settings, onFocus, onRatioChange, isSplit = false }: Props) {
  const { theme } = useTheme();
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  if (node.type === "leaf") {
    return (
      <TerminalLeaf
        key={node.id}
        sessionId={sessionId}
        paneId={node.id}
        focused={node.id === focusedPaneId}
        showFocusBorder={isSplit}
        settings={settings}
        onFocus={() => onFocus(node.id)}
      />
    );
  }

  const isVertical = node.direction === "vertical";

  const handleMouseDown = () => { dragging.current = true; };

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const ratio = isVertical
      ? Math.max(0.15, Math.min(0.85, (e.clientX - rect.left) / rect.width))
      : Math.max(0.15, Math.min(0.85, (e.clientY - rect.top) / rect.height));
    onRatioChange(node.id, ratio);
  };

  const handleMouseUp = () => { dragging.current = false; };

  return (
    <div
      ref={containerRef}
      onMouseMove={(e) => { if (dragging.current) handleMouseMove(e.nativeEvent); }}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        display: "flex",
        flexDirection: isVertical ? "row" : "column",
        flex: 1,
        overflow: "hidden",
        userSelect: dragging.current ? "none" : "auto",
      }}
    >
      <div style={{ flex: `0 0 ${node.ratio * 100}%`, display: "flex", overflow: "hidden" }}>
        <SplitPaneContainer
          node={node.children[0]}
          sessionId={sessionId}
          focusedPaneId={focusedPaneId}
          settings={settings}
          onFocus={onFocus}
          onRatioChange={onRatioChange}
          isSplit={true}
        />
      </div>
      <div
        onMouseDown={handleMouseDown}
        style={{
          flexShrink: 0,
          width: isVertical ? 4 : undefined,
          height: isVertical ? undefined : 4,
          cursor: isVertical ? "col-resize" : "row-resize",
          background: theme.ui.border,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = theme.ui.textFaint)}
        onMouseLeave={(e) => { if (!dragging.current) e.currentTarget.style.background = theme.ui.border; }}
      />
      <div style={{ flex: `0 0 ${(1 - node.ratio) * 100}%`, display: "flex", overflow: "hidden" }}>
        <SplitPaneContainer
          node={node.children[1]}
          sessionId={sessionId}
          focusedPaneId={focusedPaneId}
          settings={settings}
          onFocus={onFocus}
          onRatioChange={onRatioChange}
          isSplit={true}
        />
      </div>
    </div>
  );
}
