# Husk — Company Brain

Part of the [Antidrift.dev](/) family — AI amnesia. MCP hell. Agents running blind. Three MIT fixes.

Electron + React terminal app. node-pty for pty, xterm.js for rendering.

## Build

```bash
# Build TypeScript (main + renderer) and bump build number
npm run build

# Build + package as unpacked .app (fastest, no DMG)
npm run pack
# Output: release/mac-arm64/Husk.app
open release/mac-arm64/Husk.app

# Build + package as DMG + zip (for distribution)
npm run dist
# Output: release/
```

## Dev

```bash
npm run dev       # hot-reload dev mode
npm run start     # build then launch Electron
```

## Test

```bash
npm test                    # unit tests (vitest)
npm run test:e2e            # all Playwright e2e tests (builds first)
npm run test:e2e:launch     # single e2e suite, e.g. app-launch
```

## Key paths

| Path | Purpose |
|------|---------|
| `src/main/main.ts` | Electron main process, IPC handlers |
| `src/main/sessions.ts` | PTY session management |
| `src/main/claude-context.ts` | Reads Claude Code session jsonl for context token usage |
| `src/main/profiles.ts` | Shell profile detection |
| `src/renderer/App.tsx` | Root renderer component, status bar |
| `src/renderer/SplitPaneContainer.tsx` | Pane splitting UI |
| `src/renderer/TerminalLeaf.tsx` | Individual xterm.js pane |
| `src/renderer/pane-tree.ts` | Pane tree data structure |
| `src/renderer/themes.ts` | Theme definitions |
| `themes/` | External YAML theme files |
| `release/` | Build output (gitignored) |

## Versioning

Version format: `v0.2.<buildNumber>` (e.g. `v0.2.76`).

The build number is the single source of truth. `scripts/bump-build.ts` increments it and syncs it into:
- `build-number.json` — `.build`
- `package.json` — `.version` (as `0.2.<build>`) and `.build.buildVersion`

Do not append the build number again when displaying — version already contains it.

## Signing / notarization

Codesigning uses Developer ID: `Reloop Labs, LLC (MV45NBJTQP)`.
Notarization is disabled (`"notarize": false` in package.json build config).
