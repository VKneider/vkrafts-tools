# Config, Theming, CLI & External Libraries

The setup/tooling layer — the **distilled essentials** for common tasks. For **exhaustive flag/field enumerations** don't rely on this or on memory: query the MCP (`cli-commands`, `slice-config`, `themes`, `external-dependencies` — see SKILL.md doc_id map) or the offline fallbacks (`slice --help`, `sliceConfig.schema.json`, `slice browse`), which reflect the installed version.

_Verified against v4.x (the `VERSION` `targets` range). On a framework **major** bump, re-verify version-specific details against the MCP or source before trusting them._

---

## `sliceConfig.json`

Fetched at startup; initializes structural components, registers paths, toggles features. A recommended **dev** config:

```jsonc
{
  "debugger": { "enabled": true, "click": "right" },           // "right" | "left"
  "stylesManager": { "requestedStyles": ["sliceStyles"] },     // files in /Styles, no .css ext
  "themeManager": {
    "enabled": true, "defaultTheme": "Slice",                  // defaultTheme REQUIRED when enabled
    "saveThemeLocally": true, "useBrowserTheme": false
  },
  "logger": { "enabled": true,
    "showLogs": { "console": { "error": true, "warning": true, "info": true } } },
  "events":  { "enabled": true, "ui": { "enabled": true, "shortcut": "alt+shift+e" } },
  "context": { "enabled": true, "ui": { "enabled": true, "shortcut": "alt+shift+c" } },
  "paths": {
    "components": {
      "AppComponents": { "path": "/Components/AppComponents", "type": "Visual" },
      "Visual":        { "path": "/Components/Visual",        "type": "Visual" },
      "Service":       { "path": "/Components/Service",        "type": "Service" }
    },
    "themes": "/Themes", "styles": "/Styles", "routesFile": "/routes.js"
  },
  "router":  { "defaultRoute": "/" },
  "loading": { "enabled": true },                              // builds the Loading component on init
  "server":  { "port": 3000, "host": "localhost" }
}
```

Field notes:
- **`debugger`** — runtime component inspector; `click` chooses right/left mouse to open.
- **`events`/`context`** — `enabled` turns on `slice.events`/`slice.context` (no-op when false); `ui.enabled` + `ui.shortcut` add the live debug panels.
- **`paths.components`** — category → `{ path, type }`. `type: "Visual"` loads `.html`/`.css`; `"Service"` loads only `.js`. A wrong `path`/`type` makes `slice.build` return `null` with a misleading "not found".
- **`logger.showLogs.console.<level>`** — which levels reach the console. The buffer is always built (`slice.logger.getLogs()` works regardless).
- **Static assets** — there is **no** `publicFolders` setting. Put static files under `src/public/`; everything there is served at the root URL and copied into the build. `Themes`, `Styles` and `images` live under `src/public/` (URLs `/Themes`, `/Styles`, `/images` unchanged).

**Production overrides** — keep app managers on, turn off dev panels + verbose logs:

```jsonc
{
  "debugger": { "enabled": false },
  "events":   { "enabled": true, "ui": { "enabled": false } },
  "context":  { "enabled": true, "ui": { "enabled": false } },
  "logger":   { "enabled": true, "showLogs": { "console": { "error": true, "warning": false, "info": false } } }
}
```

Common config bugs: missing `defaultTheme` when `themeManager.enabled` → unstyled app; a vendored file imported by an absolute path but not placed under `src/public/` → works in dev, breaks in prod; `paths.routesFile` mismatch → router won't start.

**`context.enabled` requires `events.enabled` (build-breaking).** ContextManager reactivity (`setState` → `watch`/`bind`) is delivered through EventManager, so `context: { enabled: true }` with `events: { enabled: false }` would ship a bundle where every context watcher is silently dead. `slice build` **hard-fails** on this combination (with a clear message) instead of producing the broken bundle. Keep `events.enabled: true` whenever `context.enabled: true`.

### Public env vars

Only vars prefixed `SLICE_PUBLIC_` reach the browser (loaded from `.env`). Read with `slice.getEnv('SLICE_PUBLIC_API_URL', fallback)` (or `slice.getPublicEnv()`). Everything without the prefix stays server-side. The framework serves them at `/slice-env.json` (re-read each request in dev). Full detail: query the MCP for `getting-started/environment-variables`.

**Typed accessors (recent versions):** `slice.env` parses common shapes so you stop re-writing string splits / boolean checks — `slice.env.bool('SLICE_PUBLIC_AUTH_ENABLED')`, `slice.env.list('SLICE_PUBLIC_MODELS')` (csv → array), `slice.env.int('X', 5000)`, `slice.env.get('X', fb)`, `slice.env.has('X')`, `slice.env.all()`. Missing/empty values return the fallback.

---

## Theming

ThemeManager swaps CSS custom properties at runtime by loading a `.css` file from `src/public/Themes/`. `slice init` ships `Slice.css`, `Light.css`, `Dark.css`. Each defines variables on `:root`:

```css
/* src/public/Themes/Dark.css */
:root {
  --primary-color: #F97316;  --primary-color-rgb: 249,115,22;  --primary-color-contrast: #fff;
  --secondary-color: #FDBA74;
  --primary-background-color: #0D1B2A;  --secondary-background-color: #13243A;
  --font-primary-color: #fff;  --font-secondary-color: #A5B4FC;
  --success-color:#22C55E; --warning-color:#F59E0B; --error-color:#EF4444; --info-color:#3B82F6;
  --border-color: rgba(255,255,255,.1);  --border-radius: 8px;
}
```

The `-rgb` companions enable translucency: `background: rgba(var(--primary-color-rgb), .1)`.

Switch at runtime (async — fetches the file; `var(--*)` repaints automatically):

```javascript
await slice.setTheme('Dark');
console.log(slice.theme);   // → 'Dark' | null  (getter)
```

Applying a theme also sets `data-slice-theme="<name>"` on `<html>` (recent versions), so CSS can vary per theme without JS: `[data-slice-theme="Dark"] .logo { filter: none; }`. Prefer `var(--token)` for plain colors (they swap automatically); use the marker only for things a variable can't express.

A **custom theme**: create `src/public/Themes/MyBrand.css` defining at least the variables the official Visual components reference (`--primary-color`, `--primary-color-rgb`, `--primary-color-contrast`, `--secondary-color`, `--primary-background-color`, `--secondary-background-color`, `--font-primary-color`, `--font-secondary-color`, `--success/warning/error-color`, `--border-color`, `--border-radius`); set `defaultTheme: 'MyBrand'`. Define variables on `:root` (not `body`). **Never hardcode hex** in component CSS — use `var(--name)` everywhere (hardcoding ok only for things that must never change, e.g. a brand logo fill). `useBrowserTheme: true` reads `prefers-color-scheme` on first visit; a saved choice (`saveThemeLocally`) overrides it after.

---

## External libraries — npm packages (bare imports)

Slice resolves npm packages from `node_modules` with esbuild — the **same resolver in dev and in production** — so a bare import just works, like in a React/Vite project. **No configuration.**

```javascript
import dayjs from 'dayjs';          // default (CommonJS interop)
import { marked } from 'marked';    // named (ESM)
import gsap from 'gsap';            // then gsap.to(el, {...})
```

- Install the package first (`pnpm add dayjs`) — the same rule as any Node project.
- CommonJS, ESM and UMD packages, `exports` maps, scoped packages, subpaths, transitive deps, and dynamic `import('pkg')` all work. A package's CSS is bundled and injected; WASM/images/fonts are inlined.
- **Dev**: no app bundling — the dev server rewrites bare specifiers to `/@slice-modules/<pkg>` and pre-bundles each package on demand (cached under `node_modules/.slice-deps`, keyed by installed version and pruned on upgrade). **Build**: each package is bundled once into the production bundle (packages shared across routes go into `slice-bundle.vendor-shared.js`).
- The package must be **browser-compatible**. One that needs Node built-ins (`fs`, `os`, `Buffer`, streams, …) fails the build with a clear resolution error — there is no Node polyfill layer (only `process.env.NODE_ENV`/`global` plus a minimal runtime `process`/`global` shim). `slice doctor` lists bare imports missing from `node_modules`; `slice build --strict-external` fails the build on any unresolved package.
- A **relative helper module** a component imports can itself import and **re-export**, including `export * from './x'` and `export { y } from './x'` / `export { z } from 'pkg'` — the bundler inlines the helper graph and wires the re-exports. (Absolute/URL re-exports are not supported.)
- **JSON**: `import cfg from './data.json'` works — the default import is the whole document and named imports (`import { version } from './pkg.json'`) map to top-level keys.
- Dispose libs that hold resources in `beforeDestroy()` (`this.chart?.destroy()`).

> Per the user's global rules, adding a dependency needs explicit confirmation and the package-manager workflow (`pnpm add <pkg>`) — ask before installing.

## Static / vendored files — the `public/` folder

For files you don't install via npm (a pre-built script, a polyfill, an image, a font), put them under **`src/public/`**. Everything there is served at the root URL and copied verbatim into the build — no config. So `src/public/libs/widget.min.js` is importable as `/libs/widget.min.js`:

```javascript
import '/libs/widget.min.js';   // absolute path; file must exist under src/public/
```

Absolute imports are kept only when the file exists under `src/public/`; otherwise the CLI warns and strips them. For external CSS you vendor, drop it under `src/public/Styles/` and register it via `stylesManager.requestedStyles` (filename without `.css`).

## Build validation

`slice build` validates every component's `static props` (the same checks as `slice doctor`) **before** building and **blocks** on definition errors — unknown `type`, `schema` on a non-`object` prop, `items` on a non-`array` prop, or `allowedValues` that don't match the `type`. Style issues (`type: "any"`, a `required` prop without a default) warn but don't block. Bypass with `slice build --no-validate` (not recommended).

## Reproducible builds

Set the `SOURCE_DATE_EPOCH` env var (integer seconds since the Unix epoch — the reproducible-builds convention) so the timestamps embedded in the bundle metadata/config are deterministic and a clean rebuild is byte-identical: `SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) slice build`. Unset, the current time is used.

## Precompression

`slice build --compress` writes a `.gz` and a max-quality `.br` (brotli) next to every text asset in `dist/` (js/css/html/json/svg/…). The production server (`slice start`) serves the precompressed variant when the client's `Accept-Encoding` allows it (brotli preferred), with `Content-Encoding` + `Vary: Accept-Encoding`, instead of compressing on every request. Big JS bundles shrink dramatically over the wire (a 900 KB bundle → ~100 KB brotli). It's opt-in because max-quality brotli is slow — enable it for release builds. Runtime bundle loading is idle-preloaded (only the `critical` bundle blocks first paint), so transfer size is the main cost this addresses.

---

## CLI (`slicejs-cli`)

Node ≥ 20. Use `npx slicejs-cli <cmd>` or the `npm run` scripts `slice init` sets up. `slice --help` is the source of truth for flags.

| Command (alias) | Purpose |
| --- | --- |
| `slice init` | Scaffold project: installs framework, creates `api/` + `src/`, installs registry Visual components, sets up scripts |
| `slice dev` (`start`) | Dev server + HMR (`-p <port>`, `--no-hmr`) |
| `slice build` | Production bundle → `dist/`; many flags (analyze, `--sourcemap`, `--hash-filenames`, `--compress`, `--strict-external`, `--no-validate`, …) — see `slice --help`; subcmds `clean`, `info` |
| `slice start` | Production server from `dist/` |
| `slice component create [name]` (`comp new`) | Scaffold a component + register in `components.js`. **Non-interactive:** `--category <Cat>` (`-c`); omit args to be prompted. Service → only `.js` |
| `slice component list` (`comp ls`) | Rescan folders and rewrite `components.js` |
| `slice component delete [name]` (`comp remove`) | Remove a component + update `components.js`. **Non-interactive:** `--category <Cat> --yes` (`-c`/`-y`) |
| `slice get <Names…>` | Install registry components (`-s` as Service, `-f` force) |
| `slice browse` | List registry components (Visual/Service) |
| `slice sync` | Update local Visual components from registry (`-f`). Services NOT updated — use `slice get <Name> --service --force` |
| `slice skill add` | Install the Slice.js Claude Code skill into `.claude/skills/` (also `update` / `status`) |
| `slice doctor` (`diagnose`) | Project diagnostics (structure, config, deps, components + `static props`, missing npm imports, port) |
| `slice version` / `slice update` | Versions / update CLI+framework |
| `slice types generate` | Generate a `.d.ts` from `static props` for `slice.build` autocomplete (`-o <path>`) |

Project layout after `slice init`: `api/index.js` (Express server) · `src/Components/{Visual,Service,AppComponents,components.js}` · `src/public/{Themes,Styles,images}` (static assets, served at the root URL) · `src/routes.js` · `src/sliceConfig.json` · `src/App/index.html`.

Typical loop: `slice init` → `slice dev` → `slice component create` (or `slice browse` + `slice get <Name>`) → edit → `slice component list` if you added folders manually → `slice doctor` when stuck → `slice build` + `slice start` for prod.
