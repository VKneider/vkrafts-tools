# Gotchas, Best Practices & Diagnostics

The opinionated layer: the rules that prevent the common bugs, plus how to inspect a running app. Read this for code review and debugging. This is distilled mistake-prevention — for the full guides behind it query the MCP (`logger`, `getting-started/devtools`, `getting-started/leak-inspector` — see SKILL.md doc_id map).

_Verified against v4.x (the `VERSION` `targets` range). On a framework **major** bump, re-verify version-specific details against the MCP or source before trusting them._

---

## The rules

### 1. One responsibility per component
If a `Card` also fetches its own data, split into `Card` (presentation) + `CardLoader` (data). Mixed concerns are hard to test, reuse, debug.

### 2. Respect the construction order — not "no DOM in the constructor"
The real rule is **ordering relative to `slice.attachTemplate(this)`**, not constructor-vs-init. After `attachTemplate` (first line of the constructor), `querySelector` works **in the constructor** — the official Button/Input/Link components do exactly that. Two valid patterns (see `core-model.md`):
- **Pattern A (default):** capture refs + bind listeners in the constructor after `attachTemplate`, call `setComponentProps` last → setters touch the DOM with no `?.()` guards.
- **Pattern B:** refs in `init()`; then guard setter render helpers with `?.()` because setters fire (via `setComponentProps`) before `init()`.

```javascript
// ✅ Pattern A — refs in constructor (after attachTemplate, before setComponentProps)
constructor(props) {
  super();
  slice.attachTemplate(this);
  this.$root = this.querySelector('.card');
  this.$root.addEventListener('click', this.handleClick);
  slice.controller.setComponentProps(this, props);
}
```

The only true mistake is querying **before** `attachTemplate` (→ `null`).

### 3. Side effects belong in setters
Defaults from `static props` fire setters; later prop changes (programmatic or via the Debugger) fire them again. Put render logic in the setter so **assignment is all the rest of the code does** — no scattered `render()` calls.

```javascript
set value(v) { this._value = v; this.renderValue?.(); }   // ?. only needed in Pattern B
```

### 4. Always `await slice.build()`
It's async; without `await` you get a Promise (not a node) and a race (init not finished). Build many children with `Promise.all(items.map(i => slice.build('Item', i)))`.

### 5. Bind events with `slice.events.bind(this)`
Auto-unsubscribes on destroy — eliminates the top leak source. Raw `subscribe` needs manual `unsubscribe` in `beforeDestroy()`.

### 6. Context for state, Events for signals
"What is?" → `slice.context`. "What just happened?" → `slice.events`. Don't fake state with events; don't use context for one-off signals. (Details in `state-and-routing.md`.)

### 7. `destroyByContainer` before `innerHTML = ''` — the #1 bug
`innerHTML = ''` removes DOM nodes but does **not** call `beforeDestroy()`; listeners stay bound, subscriptions keep firing, memory leaks. Always destroy first, then clear. Do this on every list re-render.

### 8. CSS variables, never hardcoded colors
Theme switching only works if components reference `var(--token)`. Hardcoded hex looks fine in the default theme, breaks in others.

### 9. Namespace event names `domain:action`
`cart:updated`, `auth:expired`, `toast:show` — not `change`/`update`/`notify`. Avoids collisions with your own and framework events; greppable; shows cleanly in the events panel.

### 10. `slice.logger` instead of `console.log`
Respects config level filters, stays quiet in production, tagged + searchable (`getLogsByComponent('UserCard')`). `console.log` always prints.

```javascript
slice.logger.logInfo('UserCard', `User ${user.id} loaded`);
slice.logger.logError('UserCard', 'Failed to load user', err);
```

### 11. `slice.build()` already calls `init()` — don't call it twice
`slice.build` runs the constructor **and awaits `init()`**. If a service exposes `init()` and you also call it after building, it runs twice — and a second build with the same `sliceId` (e.g. an IndexedDbManager built inside it) throws "already registered", returns `null`, and the next call crashes (`null.method`). Build, then use — don't re-init. Make `init()` idempotent as a backstop: `if (this._ready) return this;`.

```javascript
const store = await slice.build('ConversationStore', { sliceId: 'ConversationStore' }); // init() ran
// ❌ store.init();   // runs it again
```

### 12. `slice.build(<computed name>)` isn't bundled — use a literal or a resolvable constant
The bundler links a component into its route/critical bundle by statically reading the name passed to `slice.build`. A **string literal**, a template with no expressions, or an **identifier/config member that resolves to one** (imported const, `const NAME = 'Card'`, `viewMap[key]` where the map is a literal object) are all resolved and bundled. A **truly dynamic** name (`slice.build(props.name)`, a function param) can't be resolved — `slice build` prints a `⚠️ Dynamic slice.build(...)` warning and the component still works but loads **individually at runtime** (no bundle optimization). Prefer a literal or a resolvable constant so it bundles.

### 13. `setState` REPLACES state — merge with `patch` or the function form
`slice.context.setState(name, obj)` overwrites the whole state with `obj`; a partial object silently drops the other fields. Update one field with `slice.context.patch(name, { discount })` (recent versions) or the function form `setState('cart', (p) => ({ ...p, discount }))`. (Full detail in `state-and-routing.md`.)

### More guidelines
- Stable `sliceId` only for components you'll retrieve later; auto-generate for one-off list items.
- Recover a singleton with **`slice.getComponent(sliceId)`** (shortcut for `slice.controller.getComponent`); `sliceId === component name` is the common convention.
- `beforeDestroy()` is synchronous — not awaited; fire-and-forget any unavoidable async.
- Implement `update()` for any cached (MultiRoute) route component, or it shows stale data.
- **No Shadow DOM** — never `attachShadow()`; templates are light-DOM children. Scope with BEM-ish names (`block__element--modifier`).
- **Don't `import` the framework** — `slice` is a global (`window.slice`). Just use `slice.build`, `slice.events`, etc.
- Keep `static props` to public inputs; internal state goes on `this`.
- Don't guess version-specific behavior — read `core-model.md` / WebFetch the doc.

---

## Layout & platform traps

These bite once and are non-obvious — verified building real apps.

- **Custom elements are `display: inline` by default.** A layout wrapper you build (a `MultiRoute`, a route view host) won't propagate height until you give it `display: block; height: 100%`. Symptom: content grows the page instead of scrolling inside its pane.
- **Constrain CSS grid/flex so an inner pane scrolls.** Grid rows default to `auto` (content-sized) and grid/flex items to `min-height: auto` (can't shrink). For an inner scroll area: `grid-template-rows: minmax(0, 1fr)` on the grid (or `flex: 1` on the item) **plus** `min-height: 0` on the item, and `overflow-y: auto` on the scroller. Without this the whole app grows.
- **Don't wrap an interactive component in `<label>`.** A `<label>` forwards clicks to the control inside it, so a custom component (e.g. a `Select`) gets the click **twice** — it opens then instantly closes. Use a `<div>`/`<span>` for the caption container.
- **`navigator.clipboard` needs a secure context** (https or localhost). Over plain http (e.g. a dev server reached by IP) it's `undefined` and `writeText` throws synchronously. Fall back to a hidden `<textarea>` + `document.execCommand('copy')`.
- **Per-theme CSS.** Recent versions set `data-slice-theme="<name>"` on `<html>` when a theme applies, so you can write `[data-slice-theme="Dark"] .logo { … }` — no JS theme detection. (Older versions exposed no marker; there, prefer `fill="currentColor"` + `color: var(--token)` or a per-theme CSS variable like `--logo-filter`.) Either way, plain colors should use `var(--token)`, which already swaps.

---

## Anti-patterns checklist (for code review)

- [ ] DOM query **before** `attachTemplate` in the constructor → move after it
- [ ] Pattern B setter render helper without `?.()` → add it (or switch to Pattern A)
- [ ] Missing `await` before `slice.build` → add it
- [ ] `innerHTML = ''` without prior `destroyByContainer` → add destruction
- [ ] Hardcoded hex colors in component CSS → `var(--*)`
- [ ] Event name without namespace → `domain:` prefix
- [ ] `console.log` for traces → `slice.logger`
- [ ] Manual subscribe + unsubscribe → `slice.events.bind(this)`
- [ ] `static props` holding internal state → move to `this`
- [ ] Cached route component without `update()` → implement it
- [ ] Component not in `components.js` → run `slice component list` (or edit manually)
- [ ] Missing `slice.attachTemplate(this)` → renders empty
- [ ] Bare import (`import x from 'pkg'`) → works; just `pnpm add <pkg>` first (resolved from node_modules)
- [ ] `themeManager.enabled` without `defaultTheme` → set the default
- [ ] `context.enabled: true` with `events.enabled: false` → `slice build` hard-fails (context reactivity runs through EventManager); enable events
- [ ] Vendored file imported by absolute path but not under `src/public/` → move it there
- [ ] Calling `init()` after `slice.build` → already ran; remove (make `init()` idempotent)
- [ ] `setState` with a **partial** object → use `(prev) => ({ ...prev, … })` to merge
- [ ] Interactive component wrapped in `<label>` → use a `<div>` (double-click bug)
- [ ] Inner pane grows the page instead of scrolling → constrain grid/flex (`minmax(0,1fr)` + `min-height:0`) and give custom-element wrappers `display:block; height:100%`

---

## Logger (`slice.logger`)

In-memory buffer routed to the console by `sliceConfig.json` level filters. No-op when `logger.enabled: false`.

| Method | Notes |
| --- | --- |
| `logInfo(idOrClass, msg)` / `logWarning(...)` / `logError(idOrClass, msg, error?)` | first arg is the component identifier (class name or sliceId) |
| `getLogs()` / `clearLogs()` | full buffer |
| `getLogsByLogType('error'|'warning'|'info')` | |
| `getLogsByComponent(sliceId)` / `getLogsByComponentCategory(cat)` | |

The buffer is always built even when console output is filtered, so `getLogs()` works in production for post-mortems.

---

## Debugger & debug panels

**Component inspector** (`debugger: { enabled: true, click: "right" }`): click a component to open a draggable panel.
- **Props tab** — all `static props` with current values, **editable** (edit → setter fires → UI updates live). String/number/boolean inline; array/object/function open a modal editor. Fastest way to test "does my setter update the UI?".
- **Info tab** — `sliceId`, class, category, connected status, child count.

**Events panel** — `alt+shift+e` (config `events.ui`). Live subscriptions (event → components), counts, recent emits. Use for "listener not firing" / "firing twice".

**Context panel** — `alt+shift+c` (config `context.ui`). Registered contexts + current state, watchers per context (by sliceId), recent changes. Use for "watcher not firing" / "persisted state lost on refresh".

**Leak Inspector** — `alt+shift+k` (config `debugger.leakInspector`, dev-only, 3.4.4+). Lists components registered but **detached** from the DOM (the `innerHTML=''`-without-`destroyComponent` leak), with retain chain + a per-row destroy probe, and a `growing ▲` trend when `activeComponents` accumulates across navigations. Cached `Route`/`MultiRoute` views are excluded; mark your own off-DOM caches via `slice.controller.registerLeakExclusion(fn)` or `component.__sliceCached = true`. Programmatic: `slice.controller.findOrphans()`.

---

## Diagnostic checklist

| Symptom | First thing to try |
| --- | --- |
| Component doesn't render | Console for `logError`; is it in `components.js`? path/category correct? `attachTemplate` called? |
| Prop not applied | Right-click → Props tab. Value present? Then the bug is in your setter |
| Setter fires, UI doesn't update | Is `this.$x` defined when the setter runs? (Pattern B → add `?.()` + render in init) |
| Memory keeps climbing | Leak Inspector (`alt+shift+k`) / `slice.controller.findOrphans()` — orphans? `growing ▲` trend? Missing `destroyByContainer`? |
| Listener not firing / fires twice | Events panel (`alt+shift+e`) — subscribed? Re-subscribed in `update()` without `bind`? |
| State lost on refresh | Context panel (`alt+shift+c`) — `persist: true`? Check localStorage |
| `slice.build` returns null | Not in `components.js`; wrong path; Structural; class throws on import (check `slice.logger`); name not a string |
| Console spammed in prod | Tighten `logger.showLogs.console` |
| Anything structural off | `slice doctor` |

Common lifecycle bugs map: `Cannot read 'querySelector' of null` → query ran before `attachTemplate`. `X is not a function` on default → Pattern B setter missing `?.()`. Stale data after back-navigation → no `update()`. Subscription fires twice after revisit → re-subscribed in `update()` instead of `init()`/`bind`.

---

## Testing (no official harness)

Slice has **no official test harness** — the scaffold's `test` script is a stub and the framework ships no test utilities. Don't invent a framework testing API; instead design for testability and use standard tools:

- **Keep logic in Services (rule #1).** A Service is plain JS (no `HTMLElement`, no lifecycle, no DOM), so its methods **unit-test in isolation** with any runner (Vitest/Jest/node:test) — as long as they don't reach into `slice.*`. If a Service calls a few `slice` APIs, stub a minimal `global.slice = { logger: {...}, context: {...} }` for the test. The more behavior lives in Services, the more of the app is testable without a browser.
- **Visual components need a real DOM + the `slice` global.** They only work after `slice.attachTemplate`/`slice.build`, which assume the framework is bootstrapped in a page. The reliable path is **browser / E2E**: run `slice dev` and drive it with Playwright (or similar) — assert rendered output, clicks, navigation. jsdom can work for trivial cases but you must bootstrap the `slice` global yourself, which is brittle.
- **Pure helpers** (formatters, reducers, the provider/adapter objects behind a Service) are ordinary modules — unit-test them directly.
- Adding a test runner is a **dependency change** → needs the user's confirmation and the package-manager workflow (`pnpm add -D vitest`), never a manual `package.json` edit.

Rule of thumb: push logic down into Services/helpers (unit-testable), keep Visual components thin (E2E-testable), and don't fake a harness the framework doesn't provide.
