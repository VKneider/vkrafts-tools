---
name: slice-js-developer
description: Build, debug, and modify applications using the Slice.js component framework (slicejs-web-framework v4.x). Use this skill whenever the user mentions Slice.js, slicejs, slice components, slice.build, slice.events, slice.context, slice.router, sliceConfig.json, or asks to write code inside a Slice.js project — even if they don't name the framework. Also trigger on custom elements with extends HTMLElement plus init/update/beforeDestroy, slice.attachTemplate, the three-file Visual pattern (.js + .html + .css), the slice CLI (init, dev, build, component create, get), the src/public/ folder for static assets, npm packages via bare imports, or App Shell + MultiRoute / Single-View SPA architectures. Slice has very specific conventions (DOM is only available after slice.attachTemplate, props go through setters, slice.build is async, route params use ${param} not :param, npm packages are imported by bare specifier from node_modules, components must be registered in components.js) that don't match React/Vue/Svelte intuitions — this skill prevents the common mistakes.
---

# Slice.js Developer

Slice.js is a component-based frontend framework built on native Web Components. It runs without a build step in development, uses ES modules directly in the browser, and has an explicit three-method lifecycle. This skill targets `slicejs-web-framework@^4.0.x` + `slicejs-cli@^4.0.x` — recent additions include **in-place reactive refresh** (framework-wrapped `update()` + auto-detecting `setComponentProps`), **npm packages via bare imports** (`import x from 'pkg'`, resolved from `node_modules`), and **reproducible builds** (`SOURCE_DATE_EPOCH`). Skill version + changelog live in the `VERSION` file next to this SKILL.md.

## How to use this skill

Read this SKILL.md fully — it carries the **complete mental model** and decision rules, so most tasks need nothing else. Two depth layers sit behind it:

- **`references/` — the distilled offline layer.** Source-verified notes that carry the *mistake-preventing* detail (traps, decision rules, canonical snippets). **Not a mirror of the docs** — deliberately thin. Enough to work common tasks with no network.
- **`slicejs-mcp` — the live, authoritative docs.** It exposes both the Slice.js framework catalog and the Slice.js Components catalog when configured. **Your primary tool for depth** when it's configured — especially anything version-specific (full prop lists, every CLI flag, config fields, complete guides, and component examples). Don't reproduce it here; query it.

Rule of thumb: reach for a **reference** at the *decision / trap* level; query the **MCP** at the *exhaustive / authoritative* level. Never answer a version-specific detail from memory — confirm it via the MCP (or the offline fallbacks). Use the framework catalog for framework behavior and the Components catalog for Visual/Service APIs and examples. See "Developing with the MCP" below.

Common tasks: create a Visual/Service component · add routes/guards/pages · wire inter-component communication (Events vs Context) · configure themes/persistence/debug panels · diagnose a non-rendering/leaking/stale component · set up a new project · integrate an external library.

---

## Critical mental model — read before writing any code

Slice looks like Web Components but has rules that violate React/Vue/standard-WC muscle memory. These are **verified against the framework source**. If only three things stick:

1. **The DOM/template is not available until you call `slice.attachTemplate(this)`.** It is the first statement of the constructor (after `super()`). *After* that call, `querySelector` and listener binding work **inside the constructor** — the official Button/Input/Link components do exactly this. *Before* it, the element has no children. So the rule is **ordering relative to `attachTemplate`**, not "constructor vs init". `slice.build()` does **not** attach the template for you — the constructor must.

2. **Props go through setters, not direct assignment.** `slice.controller.setComponentProps(this, props)` does `this[prop] = value` for each prop (and for `static props` defaults), which **fires your setter**. So **side effects (rendering) belong in setters.** Call `setComponentProps` **last** in the constructor.

3. **`slice.build()` is async — always `await` it.** It loads template + class + CSS, runs the constructor, awaits `init()`, registers the instance, and returns it (or `null` on failure). No `await` → you get a Promise instead of a node, plus a race because `init()` hasn't run.

### The canonical constructor + lifecycle

```javascript
export default class UserCard extends HTMLElement {
  static props = { name: { type: 'string', default: '' }, onSelect: { type: 'function', default: null } };

  constructor(props) {
    super();
    slice.attachTemplate(this);                          // 1. template now attached
    this.$name = this.querySelector('.user-card__name'); // 2. refs work here (Pattern A)
    this.$root = this.querySelector('.user-card');
    this.$root.addEventListener('click', () => this._onSelect?.());
    slice.controller.setComponentProps(this, props);     // 3. LAST → setters fire with refs ready
  }

  async init()         { /* async only: fetch, await slice.build(child), subscribe in init */ }
  async update()       { /* OPTIONAL in-place refresh; framework-wrapped (serialized + liveness). Only for async/custom refresh */ }
  beforeDestroy()      { /* sync cleanup of things that OUTLIVE the subtree: timers, globals, libs */ }

  set name(v)     { this._name = v || ''; this.$name.textContent = this._name; }
  set onSelect(f) { this._onSelect = typeof f === 'function' ? f : null; }
}
customElements.define('slice-user-card', UserCard);
```

Two construction patterns exist (both valid, detailed in `references/core-model.md`):
- **Pattern A (default, above):** refs in the constructor → setters touch the DOM with no guards.
- **Pattern B:** minimal constructor, refs in `init()` → setters need `?.()` guards because they fire before `init()`.

Lifecycle at a glance: constructor (sync) → `await init()` (once) → live (setters fire on prop changes) → `await update()` (in-place refresh — called by the Router, a parent, the component itself, or a `context.watch` callback) → `beforeDestroy()` (sync). **Most components don't need `update()`** — assigning a prop runs its setter, which refreshes the DOM in place; define `update()` only for refresh that needs **async/custom** logic. The framework **wraps `update()`** (serializes + coalesces rapid calls, and skips the commit if the component was destroyed mid-refresh), so write it plainly — no tokens/queues/guards. Subscriptions made via `slice.events.bind(this)` and `slice.context.watch(name, this, …)` and child components built inside this one are **auto-cleaned** — don't clean them in `beforeDestroy()`.

---

## Decision rules (inline — no reference needed)

- **Visual vs Service vs AppComponent:** user sees it → **Visual** (`.js`+`.html`+`.css`). Pure logic, no DOM → **Service** (`.js`). App-specific UI (AppShell, sections) → **AppComponent** (a Visual under `AppComponents/`). Never create **Structural** (Router/Event/Context/Logger/Debugger).
- **Events vs Context:** "Did something happen?" → `slice.events.emit('domain:action', …)`. "What is the current state?" → `slice.context`. Prefer Context for state and add an Event when cross-domain side effects must react. Optionally declare events with `slice.events.register(...)` (opt-in registry, 3.4.4+) for typed `emit`/`subscribe`, dev validation, and pub/sub tracing — details in `references/state-and-routing.md`.
- **App Shell + MultiRoute vs Single-View SPA:** URL changes as the user navigates (deep links, back button) → **App Shell + MultiRoute**. User stays on `/` and the screen changes by interaction (game, wizard, kiosk) → **Single-View SPA**.
- **Route vs MultiRoute:** one conditional slot → `Route`. Swappable content area under a persistent shell → `MultiRoute` (caches instances → implement `update()`).
- **How to refresh after data changes (in place):** assign a prop — the setter mutates the DOM (the default, no rebuild) → for several props at once, `slice.setComponentProps(comp, props)` (auto-detects refresh: no defaults re-applied, omitted props kept, diff-guards honored) → `update()` only when the refresh needs async/custom logic. For **lists**, reuse by stable `sliceId` (build new / update existing / `destroyComponent` the gone) — never destroy+rebuild survivors. **Total replacement** (no shared ids) → **build-then-swap** (build off-DOM → `replaceChildren` → `destroyComponent` old). Never invent a `render()` method — setters/`update()` are the Slice standard.
- **Where singletons + bootstrap live:** keep `App/index.js` (almost) empty — only router **guards** go there. Put services + state setup in a **composition-root** initializer Service (e.g. `Providers`) built once from `AppShell.init()`; it creates contexts and builds the singletons in order. App-domain services go in their own data-driven category (`AppServices`), recovered via `slice.getComponent(sliceId)`. (Details in `core-model.md` → "App-scale composition".)
- **Reuse before building:** check `references/visual-catalog.md` / `slice browse` — Button, Card, Grid, Navbar, Modal, Select, etc. likely already exist.
- **Translated app:** text in a template is *marked* (`data-t`), never written from JS; text passed as a prop is `slice.t.ref('key')`; text read at the moment of use is `slice.t()`. A dictionary list is `t.list(key)` (or `t.ref.list(key)` for a prop). Content records (experience, courses, projects) use a `copy: { en, es }` document read with `await t.content(name)`; `t.localized(value)` is the primitive. Do not add a `localeChanged()` hook — the framework refreshes marks, marker props and route metadata itself; content sections re-render from `watch()`/their own setter. Locale in the URL is opt-in (`translator.localePrefix`); read `slice.path` and build anchors with `slice.href()` (the router shortcuts), never `window.location.pathname`. `slice translator check` is the key gate (it also validates `t.list` keys and `content` copies); native SEO prerenders per locale when routing is on.

---

## Developing with the MCP (`slicejs-mcp`)

The MCP provides live access to two documentation catalogs. It is the **authoritative source for depth**: when a reference is too thin, or the fact is version-specific (a full prop list, every CLI flag, a config field, a complete guide, or a component example), **query the MCP instead of guessing or reproducing docs here.**

**Framework catalog tools:**
- `slice_framework_list_docs()` — lists framework and CLI documentation.
- `slice_framework_search_docs(query, max_results?, snippets_per_doc?)` — searches framework docs by API symbol, concept, or error string.
- `slice_framework_get_doc(doc_id | [doc_ids], include_metadata?)` — retrieves authored framework Markdown with provenance.

**Slice.js Components catalog tools:**
- `slice_components_list_docs()` — lists Visual and Service component documentation.
- `slice_components_search_docs(query, max_results?, snippets_per_doc?)` — searches component docs and examples.
- `slice_components_get_doc(doc_id | [doc_ids], include_metadata?)` — retrieves authored component Markdown with version and revision metadata.

**Compatibility tools:**
- `list_docs()`, `search_docs()`, and `get_doc_content()` remain available for the framework catalog.
- `get_llm_full_context()` returns the framework corpus and is expensive. **Ask the user before calling it.**

**The development loop:** select the catalog → `*_search_docs("<symbol / concept / error text>")` → pick the top `doc_id` → `*_get_doc(doc_id)` → apply. Results are cached in-session, so repeated reads are cheap.

### Orientation protocol — first thing on a Slice task (when the MCP is available)

Don't jump straight to a blind `search_docs`. Orient first, so recommendations fit *this* project:

1. **List the relevant catalog** — use `slice_framework_list_docs()` for framework questions and `slice_components_list_docs()` for Visual/Service questions. This prevents guessing doc ids.
2. **Read the project** to know what's relevant and what to recommend — the installed source is ground truth:
   - `sliceConfig.json` → which managers are on (`events`/`context`/`themeManager`/`debugger`/`logger`), the `defaultTheme`, the component **categories** (`paths.components`), the server/port. This tells you what's enabled before you suggest using it.
   - `src/Components/components.js` → which components already exist (reuse before building).
   - `src/routes.js` → the app's routing shape (App Shell + MultiRoute vs Single-View).
   - `package.json` / `node_modules/slicejs-web-framework` → the framework version (so version-specific advice matches).
3. **Offer the full docs for big/unfamiliar work.** If the task is large or the user is new to Slice, *ask*: "Want me to pull the full Slice.js docs into context (`get_llm_full_context`, ~2500 lines) for this, or stay targeted?" Only call it on a yes. For focused tasks, skip it and use the search→read loop.
4. **Then** use the targeted search → get loop for each specific question.

Tailor advice to what you found: don't suggest `slice.context.watch` if `context.enabled` is false — flag that it must be enabled first (and that `context` needs `events`); recommend the existing theme/components rather than inventing new ones.

**New / empty project?** If `slice init` hasn't run yet there is nothing to read at step 2 — this is the one case where a single `get_llm_full_context()` (still ask first) earns its cost. Then `slice init` to scaffold, and continue from the actual project files.

**When to use which layer:**
- **Reference** (`references/*.md`) → the decision, the trap, the canonical snippet. Fastest, offline, mistake-focused.
- **MCP** → the exhaustive/authoritative version, and **anything version-specific** (prop lists, flags, config fields, and component examples drift between versions — never trust memory). Choose the framework or Components catalog explicitly.
- **CLI docs fallback** → `slice docs search ... --source framework|components` and `slice docs get ... --source framework|components` when MCP is unavailable.
- **Live project / offline fallbacks** → the ground truth for *this* project: `slice --help`, `sliceConfig.schema.json`, `slice browse`, and reading a component's source under `src/Components/Visual/<Name>/`. The installed source outranks any doc for the project in front of you.

**Graceful degradation (MCP not configured):** use the CLI docs commands first: `slice docs search "<query>" --source framework|components` and `slice docs get <id> --source framework|components --stdout`. If the CLI is unavailable, WebFetch the corresponding raw Markdown URL. Then use the local reference and offline fallbacks. For *this project's* specifics the live source always wins.

### Where each topic lives (references + doc_id map)

`doc_id` = the markdown path relative to `markdown/` without `.md` (works as both the MCP `doc_id` and the WebFetch URL path). Every id below is served by the MCP.

| Task area | Distilled reference (offline) | doc_id (MCP / WebFetch, for depth) |
| --- | --- | --- |
| New project: what `slice init` scaffolds (App Shell + MultiRoute starter), project structure, your first page, the dev loop | `references/config-theming-cli.md` + architecture in `references/state-and-routing.md` | `getting-started/project-anatomy`, `getting-started/first-page`, `getting-started/development-workflow` |
| Component anatomy, `slice.build`, lifecycle, setters, `static props`, destruction | `references/core-model.md` | `api-reference`, `getting-started/component-anatomy`, `getting-started/build-method`, `getting-started/lifecycle-overview`, `getting-started/init-method`, `getting-started/update-method`, `getting-started/before-destroy`, `getting-started/static-props`, `getting-started/visual-components`, `getting-started/services` |
| Events, Context, routing, guards, Route/MultiRoute, architecture patterns | `references/state-and-routing.md` | `event-manager`, `event-registry`, `context-manager`, `getting-started/routing`, `getting-started/routing-guards`, `project-architecture/*` |
| Translation, locales, `data-t`, `t.ref()` props, locale in the URL | `references/translator.md` | `translator`, `slice-config`, `getting-started/routing` |
| `sliceConfig.json`, theming, CLI, external libs, env vars | `references/config-theming-cli.md` | `slice-config`, `themes`, `cli-commands`, `external-dependencies`, `getting-started/environment-variables` |
| Best practices, anti-patterns, Logger, Debugger, debug panels, leak inspector, troubleshooting | `references/gotchas-and-diagnostics.md` | `logger`, `getting-started/devtools`, `getting-started/leak-inspector` |
| Which official Visual/Service components exist | `references/visual-catalog.md` | `slice_components_search_docs` / `slice_components_get_doc` |
| Server entrypoint, middleware order, SPA fallback, 404s | — | `project-architecture/server-entrypoint` |
| SEO manifest, per-route head, sitemap, client titles | — | `project-architecture/seo`, `slice-config` (`router.updateTitles`) |
| The MCP itself (tools, usage) | — | `slicejs-mcp` |

When a reference contradicts your prior knowledge of "how component frameworks work", **trust the reference** — it's verified against the source. When the user says "but framework X does it like this", clarify Slice has its own conventions.

---

## Server and SEO — what the framework owns

`api/index.js` is the app's server, and the framework does not listen on its own: it returns the app
so you can add middleware before the terminal fallback.

```javascript title="api/index.js — the shape"
import { createSliceServer } from 'slicejs-web-framework/api/framework/server.js';

const { app, start } = createSliceServer({ seo: { manifest: './seo.json' } });

app.use('/api/hooks', hooks);   // ordinary Express middleware
await start();                  // mounts the terminal fallback, then listens
```

Rules that bite:

- **Middleware added after `start()` never runs.** `start()` mounts the only catch-all, so it must be
  the last line. If you have no `start()` (serverless, supertest), mount `sliceFallback()` and then
  `sliceErrorHandler()` yourself.
- **Never copy the framework server into the app.** A copy stops receiving fixes; a 700-line fork in
  `slicejs-components` had to be migrated back for exactly that reason.
- **`api/framework/seo.js` is the whole SEO surface.** It reads a `seo.json` manifest, resolves the
  origin once (`SLICE_ORIGIN` → option → manifest → `http://localhost:<port>` in development → hard
  error in production), prerenders each route, and answers `200` / `404` / `noindex`. Without it every
  path answers the shell with `200` (a soft 404).
- **The sitemap is a committed file.** `slice seo sitemap` writes it from the manifest and never
  overwrites silently; `slice seo check` fails CI when it drifts.
- **Social cards are generated, not authored.** `slice seo images` captures each indexable route and
  writes `public/og/manifest.json`, which the server consumes via `seo.images`. It never edits
  `seo.json` (that file is generated by the app pipeline). Playwright must be in the project.
- **`slice doctor` has an SEO row** (`checkSeoConfiguration`): not configured is a warning because
  SEO is opt-in, malformed input fails, and the verdicts come from the same validator as
  `slice seo check`, so the two cannot disagree.
- **Build and doctor share one validation pass.** `slice doctor`'s Configuration and Components &
  Routes rows classify with the same helper as `slice build`, and doctor exits 1 when a row fails —
  so `slice doctor && slice lint && slice typecheck && slice build` is a real gate. See the table
  below for what each one actually proves.
- **Router titles come from the `metadata` field on `routes.js`**, on by default. It writes only what
  the route declares, never `canonical`/`robots` (crawlers do not run JavaScript), a `router:change`
  listener still wins, and a disagreement between `routes.js` and `seo.json` is a `slice doctor` /
  `slice seo check` warning.
- **Crawlers still do not see the body.** The head, the status code and the sitemap are server-side;
  the article itself is client-rendered.

---

## Doctor vs build — what each one proves

Never use `slice doctor` as a substitute for `slice build`. Doctor is a fast static check (≈1 s);
build compiles, bundles and emits `dist/`.

| Check | `slice doctor` | `slice build` |
|---|---|---|
| `sliceConfig` rules (`context.enabled` needs `events.enabled`) | blocks | blocks |
| `sliceConfig` against the published JSON Schema (types, required) | blocks | — |
| Component file: syntax error, missing `default export`, unresolved relative import, registered name with no file | blocks | blocks |
| Component registered under a category with no `paths.components` entry, or in a missing category folder | blocks | blocks |
| Component prop definitions (`type`, `schema`, `items`, `allowedValues`), including `id`/`sliceId`/`singleton` declared as a prop | blocks | blocks |
| `api/index.js` syntax | blocks | blocks |
| `src/routes.js`: syntax error, unresolved relative import | blocks | blocks |
| Declared `slicejs-web-framework` range rejects the installed version (or the CLI requires another) | warns | — |
| Route `component` not in `components.js` | warns | warns |
| Route written `:id` instead of `${id}` (never matches) | warns | warns |
| Component CSS selectors not scoped under the component tag (CSS is global; `/* slice:unscoped */` opts out) | warns | — |
| `destroy()`/`dispose()`/`teardown()` never called, global listener without `removeEventListener`, `async beforeDestroy` | warns | warns |
| `type: "any"`, `required` without default, `slice.build()` of an unregistered name, folder without `<Name>.js` | warns | warns |
| Prop metadata written as an expression (`type: TYPE_STRING`, `allowedValues: SIZES`, `static props = SHARED`): `types generate` falls back to `any` | warns | warns |
| Installed npm packages, structure, port, lockfiles, SEO, package manager | reports | — |
| **esbuild resolves the whole graph; bundles are valid; `dist/` is complete** | — | **only build** |
| **`api/index.js` runs correctly** | — | — (neither; see below) |
| **Framework behavior (router, lifecycle, server, SEO)** | — | — (neither) |

Rules that follow from it:

- `routes.js` is **served as-is**, not bundled (the router imports it in the browser). An unresolved
  import there breaks navigation even though the bundle builds — that is why it is checked statically
  by both commands.
- `api/index.js` is not a build artifact and neither command executes it. If the server is the suspect,
  boot the app: `slice dev`, or the workspace `pnpm verify:conclave` / `node scripts/verify-app.mjs`.
- "Nothing is broken at framework level" cannot be proven statically. That claim needs a boot of a
  real app, which is what the framework CI job (Conclave build + boot) does.
- Correct order in CI: `slice doctor && slice lint && slice typecheck && slice build`, then a runtime
  smoke test. Lint is the fast environment check, typecheck is the compiler step (components against
  the generated declarations), and build blocks anything that would ship a broken bundle.

---

## Workflows

**Orient first (MCP available):** before any workflow below, run the **Orientation protocol** above — list the relevant catalog and read `sliceConfig.json` / `components.js` / `routes.js` / the framework version — so every choice fits the actual project (enabled managers, existing components, routing style).

**Component creation:** (1) decide category; (2) check `references/visual-catalog.md` — reuse if it exists; (3) read `references/core-model.md` (+ `state-and-routing.md` if it needs events/routing/context, `config-theming-cli.md` if it needs an external lib); (4) scaffold the files non-interactively — `slice component create <Name> --category <Visual|Service|AppComponents>` (this also registers it in `components.js`); fill the logic using `assets/` as the content reference (don't write boilerplate from memory); (5) if you created files by hand instead, register them with `slice component list` (or edit `components.js` within one conversation); (6) walk the lifecycle/construction-order checklist in `core-model.md`.

**Project setup:** `slice init` scaffolds an **App Shell + MultiRoute** starter (an `AppShell` with a persistent navbar + a `MultiRoute` content area, plus `HomeSection`/`AboutSection`), installing only a lean set of Visual components — add more with `slice get <Name>`. Read `references/config-theming-cli.md` (CLI, config) and the architecture section of `references/state-and-routing.md`; the docs `getting-started/project-anatomy`, `getting-started/first-page`, and `getting-started/development-workflow` walk the post-init path file by file. Use `assets/sliceConfig.json` and `assets/routes.js` as starting templates. For a new large project you may WebFetch `.../master/llm.txt` (or `get_llm_full_context`) once for broad context.

**Debugging:** start with the checklist in `references/gotchas-and-diagnostics.md` (most bugs are there — query before `attachTemplate`, missing `await`, `innerHTML=''` without `destroyByContainer`, missing `update()`); enable the debug panels (`alt+shift+e` events, `alt+shift+c` context); for rendering issues focus on `core-model.md`.

**Testing:** Slice ships **no official test harness** (the `test` script is a stub; no framework test utilities). See `references/gotchas-and-diagnostics.md` → "Testing" for the pragmatic approach — keep logic in Services so it unit-tests as plain JS, and drive `slice dev` with a browser/E2E tool for Visual components (which need a live DOM + the `slice` global).

---

## Templates in `assets/`

Scaffolds with `SLICE_TEMPLATE:` placeholders — copy and adapt, don't hand-write boilerplate.
- `assets/visual-component/Component.{js,html,css}` — Visual component (Pattern A by default)
- `assets/service-component/Service.js` — Service component
- `assets/routes.js` — multi-route config with guards
- `assets/sliceConfig.json` — recommended dev config with all managers enabled

---

## Out of scope

Framework internals (bundler/hydration/Slice source organization — use it as documented, don't hack it); React/Vue/Svelte interop; SSR (Slice runs in the browser; `api/` is just an Express dev/prod server). If asked, note the official docs don't support that path and offer the closest supported workflow.

## Accuracy note

The references and the mental model above are extracted from the Slice.js source and docs. The framework's own components are the ground truth for conventions. If you're ever unsure about a version-specific detail (a prop list, a CLI flag, a config field), confirm via the MCP (or its WebFetch fallback) or the offline fallbacks rather than guessing — see "Developing with the MCP".
