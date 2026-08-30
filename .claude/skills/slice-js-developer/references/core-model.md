# Core Model — Anatomy, `slice.build()`, and Lifecycle

The single most important reference — the **distilled mental model**, verified against the framework source (`Slice/Slice.js`, `Slice/Components/Visual/Button/Button.js`, `Slice/Controller`). When this contradicts your React/Vue intuition, trust this. For the fuller walkthroughs behind each topic here, query the MCP (`api-reference`, `getting-started/component-anatomy`, `build-method`, `lifecycle-overview`, … — see SKILL.md doc_id map); for a component's exact current API, read its source under `src/Components/`.

_Verified against v4.x (the `VERSION` `targets` range). On a framework **major** bump, re-verify version-specific details against the MCP or source before trusting them._

---

## The three component categories

| Category | Files | Purpose | Lives in |
| --- | --- | --- | --- |
| **Visual** | `.js` + `.html` + `.css` | UI element with template + styles | `src/Components/Visual/<Name>/` (registry) or `src/Components/AppComponents/<Name>/` (app-specific) |
| **Service** | `.js` only | Reusable logic, no UI (fetchers, persistence, domain) | `src/Components/Service/<Name>/` |
| **Structural** | framework only | Router, EventManager, ContextManager, Logger, Debugger… | inside the framework — you do NOT create or `build` these |

Rule of thumb: if the user sees it → Visual. A class with no DOM → Service. **AppComponent** = a Visual that lives under `AppComponents/` (app-specific UI like `AppShell`, `HomeSection`); same anatomy as Visual.

---

## What `slice.build()` actually does (source-verified)

`slice.build(componentName, props)` is the **only** way to instantiate a component. Signature:

```typescript
slice.build(componentName: string, props?: object): Promise<HTMLElement | Object | null>
```

Internally (`Slice/Slice.js`):

1. Validate `componentName` is a non-empty string → else log error, return `null`.
2. Resolve category from `components.js` (falls back to `AppComponents` if only the class is known). Refuse **Structural** components.
3. In parallel (`Promise.all`): fetch `.html` template, dynamically `import()` the class, fetch `.css`. Results are **cached** in the controller — building 100 Buttons loads assets once.
4. Pull `id` and `sliceId` out of `props` (handled specially), then `new ComponentClass(remainingProps)` → **your constructor runs here**.
5. Assign `id`/`sliceId`, verify uniqueness.
6. `await componentInstance.init()` if it exists. **init() is awaited.**
7. Register the instance under its `sliceId` in `slice.controller.activeComponents`; recurse for children.
8. Return the instance (or `null` on any failure — always logged via `slice.logger`).

**Key fact:** `slice.build()` does **not** attach the template itself — it only caches it. The component's **constructor** must call `slice.attachTemplate(this)`. (`attachTemplate` → `controller.loadTemplateToComponent` → `this.innerHTML = template.innerHTML`.)

Always `await` it:

```javascript
// ❌ button is a Promise, not a node
const button = slice.build('Button', { value: 'Save' });
container.appendChild(button);          // throws

// ✅
const button = await slice.build('Button', { value: 'Save' });
container.appendChild(button);
```

---

## The construction order (this is the crux)

The constructor of every Visual component does three things, **in this order**:

```javascript
constructor(props) {
  super();
  slice.attachTemplate(this);                       // 1. inject .html as light-DOM children
  // ... (optional) capture DOM refs + bind listeners — see Pattern A below
  slice.controller.setComponentProps(this, props);  // 2. apply props (fires setters) — LAST
}
```

- **Before** `slice.attachTemplate(this)` the element has no children → `querySelector` returns `null`.
- **After** `slice.attachTemplate(this)` the template DOM is present → `querySelector` works **inside the constructor**.
- `setComponentProps` goes **last** so that, if you captured DOM refs earlier in the constructor, your setters can already touch the DOM (see Pattern A).

> The old skill rule "never query the DOM in the constructor" was **wrong**. The real rule is **ordering relative to `attachTemplate`**. The framework's own components (Button, Input, Link) query the DOM in the constructor.

### How `setComponentProps` works (source-verified)

`slice.controller.setComponentProps(this, props)`:

1. Applies defaults from `static props` for any prop not passed.
2. Runs validation in development (warns on unknown, errors on missing `required`). Production skips it.
3. For every prop: `this['_'+prop] = null; this[prop] = value;` — **this fires your setter.** Defaults fire setters too.

So **your setter is the only place props get applied.** Side effects (rendering) belong in setters, not scattered `render()` calls.

**Build vs refresh — auto-detected (3.4.4+).** The same `setComponentProps` serves the initial build *and* refreshing a live component; it detects the mode by whether the instance is already registered:
- **Build** (in the constructor, not yet registered): applies `static props` defaults + validates `required` + fires every setter.
- **Refresh** (already registered): applies **only the props you pass** — no defaults re-applied, no `required` check, and it does **not** reset the backing field, so a setter diff-guard (`if (v === this._x) return`) can short-circuit. Omitted props keep their current value (refreshing one prop never resets the others).

Exposed on the facade as `slice.setComponentProps(comp, props)`. `slice.isComponentAlive(comp)` tells you a component is still the live registered instance (false after destroy/replace).

---

## The two construction patterns (document both; pick by need)

### Pattern A — refs in the constructor (the framework's own style) ✅ default

Capture DOM refs and bind listeners in the constructor (after `attachTemplate`, before `setComponentProps`). Setters can then touch the DOM immediately — **no `?.()` guards, no double render.** This is what `Button`/`Input`/`Link` do.

```javascript
export default class UserCard extends HTMLElement {
  static props = {
    userId:   { type: 'string',   default: null },
    name:     { type: 'string',   default: '' },
    onSelect: { type: 'function', default: null }
  };

  constructor(props) {
    super();
    slice.attachTemplate(this);
    // refs available now — template is attached
    this.$name = this.querySelector('.user-card__name');
    this.$root = this.querySelector('.user-card');
    this.$root.addEventListener('click', () => this._onSelect?.(this._userId));
    slice.controller.setComponentProps(this, props);   // last → setters fire with refs ready
  }

  // init() only if you need ASYNC work (build children, fetch)
  async init() {
    this.user = await this.fetchUser(this._userId);
  }

  set name(v)     { this._name = v || ''; this.$name.textContent = this._name; } // no ?. needed
  set userId(v)   { this._userId = v; }
  set onSelect(f) { this._onSelect = typeof f === 'function' ? f : null; }
}
customElements.define('slice-user-card', UserCard);
```

### Pattern B — refs in `init()`

Minimal constructor (`attachTemplate` + `setComponentProps`); cache refs and bind in `init()`. Because `setComponentProps` runs in the constructor (before `init()`), setters fire **before** refs exist → **guard render helpers with `?.()`** and re-render in `init()`.

```javascript
constructor(props) {
  super();
  slice.attachTemplate(this);
  slice.controller.setComponentProps(this, props);
}
async init() {
  this.$name = this.querySelector('.user-card__name');
  this.renderName();                       // render once refs exist
}
set name(v) { this._name = v || ''; this.renderName?.(); }   // ?. → setter may run pre-init
renderName() { if (this.$name) this.$name.textContent = this._name; }
```

### When to use which

| Use **Pattern A** (refs in constructor) | Use **Pattern B** (refs in init) |
| --- | --- |
| Setters need to touch the DOM (most UI components) | `init()` is purely async (fetch, build children) and setters only store values |
| You want to avoid `?.()` guards and a second render | You prefer a tiny constructor / heavy async setup |
| Matches the official Visual components | Fine when no setter renders before init |

Both are valid. Pattern A is the **default** for the scaffold because most components have rendering setters.

---

## The `.html` and `.css` files

```html
<!-- UserCard.html — INNER markup only. No <template>, no root matching the tag. -->
<div class="user-card">
  <p class="user-card__name"></p>
</div>
```

Slice injects this as **light-DOM children** (no Shadow DOM — never call `attachShadow()`). Use BEM-ish class names (`block__element--modifier`) to scope styles. In CSS use `var(--token)` only — **never hardcode colors** or theming breaks (see `config-theming-cli.md`).

---

## Service components

Plain ES classes — no `HTMLElement`, no `static props`, no lifecycle, no `customElements.define`. Built via `slice.build('AuthService', { sliceId: 'AuthService' })`, returns the instance.

```javascript
export default class AuthService {
  constructor(props = {}) { this.token = null; this.user = null; }
  async login(email, password) {
    const res = await fetch('/api/login', { method: 'POST', /* … */ });
    if (!res.ok) { slice.logger.logError('AuthService', 'Login failed', res.statusText); return false; }
    const data = await res.json();
    this.token = data.token; this.user = data.user;
    return true;
  }
  isAuthenticated() { return this.token !== null; }
}
```

**Singletons — two patterns:**
- **Default — build once + recover.** Create it in one place (the composition root, below) with a stable `sliceId`, and everywhere else **recover** it with `slice.getComponent('AuthService')` (shortcut for `slice.controller.getComponent`; `sliceId` defaults to the component name). Explicit and readable: one owner creates, consumers only read. Use this for services created in a single place.
- **`slice.build('X', { singleton: true })` — get-or-create.** For **Service** components only. Returns the existing instance or creates it (concurrency-safe, no duplicate-`sliceId` race). Use it when a service can be built from **more than one entry point** (e.g. an `AuthService` needed both by the composition root *and* by a standalone `/login` route) — it removes the manual `slice.getComponent(x) || slice.build(x)` guard. `props` apply only on the first (creating) call. For app-wide **UI** you still build a Provider Service that manages the Visual (a DOM node lives in one place) — `singleton: true` is rejected for non-Service.

Note: `slice.build` **awaits `init()`** if the class defines it — building a service already initialized it; don't call `init()` again (see gotcha #11). With `singleton: true`, `init()` runs only on the creating call.

### App-scale composition (verified building real apps)

As an app grows, three conventions keep services clean:

- **Custom category for app-domain services.** Categories are data-driven: add a key to `sliceConfig.json` → `paths.components` and register components under it in `components.js`. Keep your generic reusable Services in `Service/` and put app-specific singletons (chat service, stores, auth) in their own category, e.g.:
  ```jsonc
  "paths": { "components": {
    "AppServices": { "path": "/Components/AppServices", "type": "Service" }
  }}
  ```
  `type: "Service"` loads only `.js`. Then `"ChatService": "AppServices"` in `components.js`.

- **A composition root, not `App/index.js`.** Keep `App/index.js` (almost) empty. Put app bootstrap in a single **initializer Service** (e.g. `Providers`) that creates the contexts and builds every singleton **in order**, and call it once from the App Shell's `init()`. It holds no business logic — it just composes:
  ```javascript
  // Providers.init(), called from AppShell.init()
  if (!slice.context.has('settings')) slice.context.create('settings', { … });
  await slice.build('ChatService', { sliceId: 'ChatService' });   // recover via slice.getComponent('ChatService')
  await slice.build('ConversationStore', { sliceId: 'ConversationStore' });
  ```
  Use `App/index.js` only for router **guards** (`slice.router.beforeEach`) — registered synchronously, the auto-start picks them up.

- **Pluggable adapters behind one service.** When a service talks to a swappable backend (LLM provider, payments, storage), make it a thin core with a **registry of providers** selected by config (`slice.getEnv('SLICE_PUBLIC_X')`), each provider a small object implementing one method. The UI calls the service; swapping backends is an `.env` change, never a UI change.

---

## `static props` — the public contract

```javascript
static props = {
  value:    { type: 'string',   default: 'Click me' },
  count:    { type: 'number',   default: 0 },
  disabled: { type: 'boolean',  default: false },
  items:    { type: 'array',    default: [] },
  config:   { type: 'object',   default: {} },
  onClick:  { type: 'function', default: null },
  name:     { type: 'string',   required: true }   // no default → required
};
```

Types: `'string' | 'number' | 'boolean' | 'array' | 'object' | 'function'`. Props are the **contract** with the caller — keep internal state (cached data, timers) on `this`, not in props.

---

## The lifecycle — three hooks

| Method | When | Awaited? | Purpose |
| --- | --- | --- | --- |
| constructor | at `new` inside `build()` | n/a (sync) | `attachTemplate`, refs/listeners (Pattern A), `setComponentProps` |
| `async init()` | once, after construction | **yes** | async setup: fetch, build child components, subscribe to events/context |
| `async update()` | in-place refresh — Router (cached revisit), parent, self, or watcher | **yes** | refresh in place (setter / reuse by `sliceId`); framework-wrapped (serialized + liveness); OPTIONAL |
| `beforeDestroy()` | right before destruction | **no — fire & forget** | cleanup of things that outlive the DOM subtree |

### `init()` — one-time async setup

```javascript
async init() {
  this.userData = await this.fetchUser(this._userId);          // fetch
  const editBtn = await slice.build('Button', {                // build children (await!)
    sliceId: 'edit-btn', value: 'Edit', onClickCallback: () => this.edit()
  });
  this.appendChild(editBtn);
  this.events = slice.events.bind(this);                        // auto-cleanup subscriptions
  this.events.subscribe('user:updated', (u) => this.refresh(u));
  slice.context.watch('auth', this, (s) => this.toggle(s.isLoggedIn));  // auto-cleanup watcher
}
```

Build children in parallel when order doesn't matter: `await Promise.all(items.map(i => slice.build('Item', i)))`.

### `update()` — universal in-place refresh

`update()` is the post-init refresh hook. It's called by the **Router** (cached `MultiRoute`/route revisit), a **parent**, the **component itself**, or a **`context.watch` callback**. It's **optional**: most components refresh through their setters (assigning a prop mutates the DOM). Define `update()` only when a refresh needs **async or custom** logic.

The framework **wraps your `update()`** at registration: it **serializes + coalesces** rapid calls (streaming / fast revisits → no overlap, last wins) and **skips the commit if the component was destroyed mid-refresh** — so write it plainly, no tokens/queues/liveness guards.

Two semantics, same method:
- **Route view (Router):** called with no args → read params from `this.props` and fetch your own data.
- **Child (parent):** the parent passes the data as the argument.

**Refresh a list in place** — reuse by stable `sliceId`, never recreate survivors (no flicker; scroll/focus preserved):

```javascript
async update(state = {}) {
  const alive = new Set();
  for (const it of state.items || []) {
    const sliceId = `item-${it.id}`;
    alive.add(sliceId);
    const row = slice.getComponent(sliceId);
    if (row) slice.setComponentProps(row, { title: it.title });            // refresh in place
    else this.$list.appendChild(await slice.build('Item', { sliceId, ...it }));
  }
  for (const el of [...this.$list.children]) {                             // prune the gone
    const id = el.getAttribute('slice-id');
    if (id && !alive.has(id)) slice.controller.destroyComponent(id);
  }
}
```

**Total replacement** (new data shares no ids) → **build-then-swap** (no empty frame, no leak):

```javascript
async update(state = {}) {
  const old = [...this.$slot.children].map((el) => el.getAttribute('slice-id')).filter(Boolean);
  const frag = document.createDocumentFragment();
  for (const it of state.items) frag.appendChild(await slice.build('Card', { sliceId: `card-${it.id}`, ...it }));
  this.$slot.replaceChildren(frag);                       // atomic swap
  if (old.length) slice.controller.destroyComponent(old); // clean up old instances
}
```

The older destroy-everything-then-rebuild (`destroyByContainer` + `innerHTML=''` + rebuild) still works and is fine for a wholesale refresh, but reuse-by-`sliceId` is preferred when entities persist.

### `beforeDestroy()` — synchronous cleanup

```javascript
beforeDestroy() {
  clearInterval(this._pollId);
  this._abort?.abort();
  window.removeEventListener('resize', this.onResize);   // globals you added
  this.chart?.destroy();                                  // third-party libs
}
```

You do **NOT** clean up: `slice.events.bind(this)` subscriptions, `slice.context.watch(name, this, …)` watchers, child components built+appended inside this one, or DOM listeners on `this`/descendants — all auto-cleaned. Only clean up what **outlives** the subtree (globals, timers, external handles). It is **not awaited**; async work won't finish — use fire-and-forget if unavoidable.

---

## Destruction, `sliceId`, recovery

```javascript
slice.controller.destroyComponent(refOrSliceId | [array]);   // → count destroyed; calls beforeDestroy recursively
slice.controller.destroyByContainer(this.$list);             // destroy all Slice components inside a node
slice.controller.destroyByPattern(/^todo-item-/);            // by sliceId regex

slice.controller.getComponent('main-navbar');                // recover an instance by sliceId
```

**The destroy-before-clear rule (most common Slice bug):** `innerHTML = ''` removes DOM but does **not** call `beforeDestroy()` — listeners stay bound, subscriptions keep firing, memory leaks. Always `destroyByContainer(...)` **then** clear.

Pass a stable `sliceId` only for components you'll retrieve later; let Slice auto-generate it for one-off list items.

---

## Registering in `components.js`

Every Visual/Service component must appear in `src/Components/components.js`:

```javascript
const components = {
  AppComponents: ['UserCard', 'AppShell', 'HomeSection'],
  Visual:        ['Button', 'Card', 'Grid', 'Navbar' /* … */],
  Service:       ['AuthService', 'FetchManager']
};
export default components;
```

`slice component list` rewrites it by scanning folders. If missing, `slice.build('X')` returns `null` and logs *"Component X not found in components.js file"*. Within one conversation, edit it manually.

`customElements.define('slice-user-card', UserCard)` — tag must contain a hyphen, prefix to avoid collisions, one call per class. You rarely write the tag in HTML; `slice.build` instantiates it.

---

## Common mistakes (constructor/lifecycle)

- Forgetting `slice.attachTemplate(this)` → component renders empty.
- Querying the DOM **before** `attachTemplate` in the constructor → `null`.
- Pattern B setter without `?.()` → "X is not a function" when defaults run pre-`init()`.
- `await`-ing `slice.build` missing → Promise where a node is expected + race (init not finished).
- `innerHTML = ''` without `destroyByContainer` first → leak.
- `attachShadow()` → Slice uses light DOM; don't.
- Cached route component without `update()` → stale data on revisit.
- Inventing a `render()` method → not the Slice standard; mutate the DOM in setters (and `update()` for async/custom refresh).
- Destroy+rebuilding a whole list when the entities persist → reuse by stable `sliceId` (build new / update existing / prune gone) to avoid flicker and lost scroll/focus.
- `slice.build`-ing children then clearing with `innerHTML=''` / `replaceChildren` without `destroyComponent`/`destroyByContainer` first → **silent leak** (the built children stay in `activeComponents`). Same for `window`/`document` listeners, timers, and observers not released in `beforeDestroy()`.
