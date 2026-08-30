# State, Communication & Routing

The **distilled decision layer** for `slice.events`, `slice.context`, the router, and the two app architectures — source-verified against `Slice/Components/Structural/{EventManager,ContextManager,Router}`. For the full method-by-method depth, query the MCP (`event-manager`, `event-registry`, `context-manager`, `getting-started/routing`, `getting-started/routing-guards`, `project-architecture/*` — see SKILL.md doc_id map).

_Verified against v4.x (the `VERSION` `targets` range). On a framework **major** bump, re-verify version-specific details against the MCP or source before trusting them._

---

## Events vs Context — the decision rule

Ask **"what is this communication?"**

| Question | Tool |
| --- | --- |
| "Did something happen?" (a signal, action, notification) | **EventManager** (`slice.events`) |
| "What is the current state?" (logged-in user, theme, cart) | **ContextManager** (`slice.context`) |

| Scenario | Tool |
| --- | --- |
| Logout clicked → navbar/sidebar/modal all reset | `slice.events.emit('auth:logout')` |
| Three views display the cart total | `slice.context` `cart` |
| Toasts fired from anywhere | `slice.events.emit('toast:show', {…})` |
| Theme should persist + be readable everywhere | `slice.context` `theme` (`persist: true`) |
| Form done → parent modal closes | `slice.events.emit('form:submitted', data)` |

Internally `ContextManager.setState` emits `context:<name>` events — so Context already notifies watchers. Prefer Context for **state**, and add an Event to announce a change when **cross-domain side effects** (redirect, analytics, audio) need to react. Don't fake state with events; don't use context for one-off signals.

Both are optional structural components enabled in `sliceConfig.json`; when disabled the APIs are safe no-ops.

---

## EventManager (`slice.events`)

| Method | Signature | Notes |
| --- | --- | --- |
| `emit` | `(eventName, data?)` | fire (payload optional) |
| `subscribe` | `(eventName, cb, opts?)` → subId | listen |
| `subscribeOnce` | `(eventName, cb, opts?)` → subId | auto-removes after first emit |
| `unsubscribe` | `(eventName, subId)` → bool | manual |
| `bind` | `(component)` → `{subscribe, subscribeOnce, emit, register}` | **component-scoped, auto-cleanup** |
| `cleanupComponent` | `(sliceId)` | remove all subs for a component (called on destroy) |
| `register` | `(catalog)` or `(namespace, catalog)` | declare events (opt-in registry, 3.4.4+) |
| `loadGraph` | `(manifest)` | load the generated static emit/listen graph |

### Use `bind(this)` 99% of the time

```javascript
async init() {
  this.events = slice.events.bind(this);
  this.events.subscribe('cart:updated', ({ items, total }) => { /* … */ });
  this.events.subscribe('auth:logout', () => this.reset());
}
```

`bind(this)` tracks subscriptions against the component's `sliceId` and **unsubscribes automatically on destroy** — eliminates the most common leak. Raw `slice.events.subscribe(...)` requires manual `unsubscribe` in `beforeDestroy()`. **Emitting needs no bind:** `slice.events.emit('cart:updated', { items: 3, total: 47.5 })` from anywhere.

**Always namespace event names `domain:action`** (`cart:updated`, `auth:expired`, `modal:close`). Generic names (`change`, `update`) collide with your future events and framework events like `router:change`.

### Event Registry — declare the catalog (opt-in, 3.4.4+)

Bare event strings make pub/sub hard to trace and easy to typo. Declare a catalog with
`slice.events.register(...)` to get **dev-time validation, typed `emit`/`subscribe`, and a
documented who-emits/who-listens graph**. It is **opt-in and safe by default**: with no
`register()` call the EventManager behaves exactly as before. `register()` is **mergeable** —
call it from many modules; declare it where you wire singletons (your `Providers`/composition root).

```javascript
// flat keys, or grouped by namespace — both produce the same 'domain:action' keys
slice.events.register({ 'cart:cleared': { payload: null } });
slice.events.register('cart', {
  add:     { payload: { sku: 'string', qty: 'number' } },   // => 'cart:add'
  updated: { description: 'Totals recomputed', payload: { items: 'number', total: 'number' } },
});
```

- **`payload` mini-schema** uses the `static props` type vocabulary (`{ sku: 'string' }`) or `null` for none.
- **Validation is warn-only in dev** (never throws, never blocks delivery): emitting/subscribing an
  **undeclared** event, or one **without a namespace**, logs once and shows in the debugger. Silent in production.
- **Typed events:** `slice types generate` reads the catalog → `SliceEventRegistry`, so `emit('cart:add', …)`
  autocompletes and a wrong payload fails `tsc`. The catalog argument must be an **object literal / imported
  literal** (same rule as `static props`) for the generator to see it.
- **Tracing = two layers.** *Static* (documentation): `slice types generate` also writes
  `src/slice-events.generated.js` mapping each event to its emitter/listener call sites (`file:line` + component) —
  complete, no execution. *Runtime* (observational): while the Events panel is open, each `emit()` is attributed to
  its component (via `bind`) or a stack-trace `file:line`. The debugger's **Registry** tab shows the static graph;
  **Subscribers/History** show the live one. A computed name (`emit(\`cart:${x}\`)`) can't be typed/documented statically.

Subscribe **only in `init()`** — never in setters or the constructor.

---

## ContextManager (`slice.context`)

| Method | Signature | Notes |
| --- | --- | --- |
| `create` | `(name, initialState?, opts?)` | `opts: { persist?, storageKey? }` |
| `getState` | `(name)` | snapshot |
| `setState` | `(name, objectOrUpdater)` | **REPLACES** the whole state (`context.state = next`). A partial object **drops the other fields** — use `(prev) => ({ ...prev, … })` to merge |
| `patch` | `(name, partial)` | first-level **merge** (keeps the other fields) — the ergonomic "update one field" case |
| `watch` | `(name, component, cb, selector?)` → subId | reactive, **auto-cleanup by sliceId** |
| `use` | `(name)` → handle | handle bound to one context: `get/set/patch/watch/bind/has/destroy` without repeating the name. `bind` = `watch` + an immediate call with the current value (render-now-and-on-change in one line) |
| `has` / `destroy` / `list` | | |

`patch`, `use`, and `use().bind` are recent additions; on older framework versions use `setState((prev)=>…)` + `watch` + an explicit initial render.

Create once at app startup:

```javascript
slice.context.create('auth', { isLoggedIn: false, user: null },
  { persist: true, storageKey: 'app-auth' });   // persist → localStorage + rehydrate on load
slice.context.create('cart', { items: [], total: 0 });   // ephemeral
```

Update — `setState` **replaces** the whole state, it does NOT merge. Pass the
complete next state, or use the **function form** to merge from the previous one:

```javascript
slice.context.setState('auth', { isLoggedIn: true, user });   // OK: full next state
slice.context.setState('cart', (p) => ({ ...p, items: [...p.items, item] })); // merge

// ❌ trap: this REPLACES — `total`, `items`, etc. are now gone
slice.context.setState('cart', { discount: 0.1 });
// ✅ merge instead
slice.context.setState('cart', (p) => ({ ...p, discount: 0.1 }));
```

The most common bug: updating one field with a plain object and silently wiping
the rest of the context (e.g. setting `{ activeId }` and losing the `items` list).

Watch — **always pass `this`**; auto-unsubscribes on destroy. The optional **selector** fires the callback only when the selected value changes (shallow equality), preventing over-rendering:

```javascript
slice.context.watch('auth', this, (s) => this.toggle(s.isLoggedIn));         // whole state
slice.context.watch('cart', this,
  (count) => { this.$badge.textContent = count; },
  (s) => s.items.length);                                                     // selector
```

Return a primitive/stable ref from the selector — a fresh object literal each call defeats shallow equality. `persist: true` only for durable state (theme, auth, drafts), never ephemeral UI state.

### Canonical Events+Context pattern

```javascript
class AuthService {
  async login(email, password) {
    const data = await (await fetch('/api/login', { /* … */ })).json();
    slice.context.setState('auth', { isLoggedIn: true, user: data.user });  // state
    slice.events.emit('auth:login', data.user);                              // signal
  }
  logout() {
    slice.context.setState('auth', { isLoggedIn: false, user: null });
    slice.events.emit('auth:logout');
  }
}
```

Components that **display** auth watch the context; components that **react with side effects** listen for the event.

---

## Routing

Declared in `src/routes.js`. Dynamic params use **`${name}`** — NOT `:name` (Express/React syntax won't match in Slice). Path matching is **case-insensitive** (`/About` ≡ `/about`) in both the top-level router and `MultiRoute`; captured param values keep their original case.

```javascript
const routes = [
  { path: '/',                  component: 'HomePage' },
  { path: '/products/${id}',    component: 'ProductDetail' },
  { path: '/users/${userId}/posts/${postId}', component: 'PostView' },
  { path: '/admin', component: 'AdminPanel', metadata: { private: true, role: 'admin' } },
  { path: '/404',   component: 'NotFound' }
];
export default routes;
```

Route fields: `path` (req), `component` (req, name in `components.js`), `metadata` (free-form, read by guards), `children` (nested layouts).

Read params/query inside the matched component (params are always **strings**):

```javascript
const { id } = slice.router.activeRoute?.params ?? {};
const { query } = slice.router.activeRoute;     // /search?q=x → query.q === 'x'
```

### Navigation

```javascript
await slice.router.navigate('/profile');
await slice.router.navigate('/login', { replace: true });   // no history entry
await slice.router.navigate(`/search?q=${encodeURIComponent(term)}&page=${page}`);
```

### Guards — register **before** `slice.router.start()`

```javascript
slice.router.beforeEach(async (to, from, next) => {
  if (to.metadata?.private && !slice.context.getState('auth').isLoggedIn)
    return next({ path: '/login' });   // redirect
  if (to.metadata?.role === 'admin' && !isAdmin()) return next(false); // cancel
  next();                              // proceed
});
slice.router.afterEach((to) => { document.title = to.metadata?.title ?? 'My App'; });
await slice.router.start();
```

`next()` control: `next()` proceed · `next(false)` cancel · `next({path})` / `next('/x')` redirect · `next({path, replace:true})` redirect+replace. `afterEach` is side-effects only (analytics, title, scroll). The router emits `router:change` (`{ to, from }`) on every navigation.

### `Route` vs `MultiRoute` containers (Visual components)

- **`Route`** — renders its `component` only when the URL matches `path`, else nothing. For a single conditional slot.
- **`MultiRoute`** — the workhorse. Holds a `routes` array and swaps the matching child. Use it for the **content area** under a persistent shell.

```javascript
const content = await slice.build('MultiRoute', {
  routes: [
    { path: '/',         component: 'HomeSection' },
    { path: '/products', component: 'ProductsSection' },
    { path: '/products/${id}', component: 'ProductDetail' }
  ]
});
this.querySelector('.shell-content').appendChild(content);
```

**Caching:** `MultiRoute` caches each section instance. On navigate-back it calls the section's `update()` instead of rebuilding — so **implement `update()`** in any section with dynamic data; component-local state (drafts, scroll) survives. For always-fresh views, don't cache / destroy in the parent.

**Single source of truth:** `routes.js` is what the Router resolves on first load / refresh / deep-link. `Route`/`MultiRoute` containers do **not** register routes with the Router — they only pick which component to show for the current URL. So every path a container can show **must also be declared in `routes.js`** (in the App Shell pattern it maps to the shell), or a direct load of that URL resolves before the container mounts and falls through to `/404`.

---

## Architecture: App Shell + MultiRoute vs Single-View SPA

| Signal | Pattern |
| --- | --- |
| Multiple sections share a navbar/sidebar/footer | **App Shell + MultiRoute** |
| URL matters (deep links, back button, bookmarks) | **App Shell + MultiRoute** |
| One focused experience with internal phases (game, wizard, kiosk) | **Single-View SPA** |
| Transitions are state-machine-driven, not URL-driven | **Single-View SPA** |

Litmus test: does the user expect the URL bar to change as they navigate? → App Shell. Stay on `/` while the screen changes by interaction? → Single-View.

### Pattern A: App Shell + MultiRoute

A persistent shell wraps a `MultiRoute`. **Every section URL points to `AppShell`**; the shell renders nav/footer once and swaps content by URL.

```javascript
// routes.js — every URL → AppShell
const routes = [
  { path: '/',         component: 'AppShell' },
  { path: '/about',    component: 'AppShell' },
  { path: '/projects/${id}', component: 'AppShell' },
  { path: '/404',      component: 'NotFound' }
];
```

```javascript
// AppShell.js
async init() {
  const nav = await slice.build('Navbar', { sliceId: 'main-navbar', items: [
    { text: 'Home', path: '/' }, { text: 'About', path: '/about' }
  ]});
  this.querySelector('.shell__header').appendChild(nav);

  const content = await slice.build('MultiRoute', { sliceId: 'shell-content', routes: [
    { path: '/',      component: 'HomeSection' },
    { path: '/about', component: 'AboutSection' },
    { path: '/projects/${id}', component: 'ProjectDetail' }
  ]});
  this.querySelector('.shell__content').appendChild(content);
}
```

```html
<!-- AppShell.html -->
<div class="shell">
  <header class="shell__header"></header>
  <main class="shell__content"></main>
  <footer class="shell__footer"></footer>
</div>
```

Data flow: global state (auth, theme) → `slice.context`; cross-section signals → `slice.events`; section-local state → component state; deep-linkable state (filters, current tab) → URL. **Don't** duplicate the navbar in each section or store nav-active-state in a section.

### Pattern B: Single-View SPA

One route (`/`) renders a root that manages a state machine and swaps view components by phase.

```javascript
const routes = [ { path: '/', component: 'GameRoot' }, { path: '/404', component: 'NotFound' } ];
```

```javascript
// GameRoot.js
async renderPhase() {
  const viewMap = { setup: 'GameSetup', round: 'GameRound', summary: 'GameSummary' };
  slice.controller.destroyByContainer(this.$view);   // tear down previous view
  this.$view.innerHTML = '';
  const view = await slice.build(viewMap[this.state.phase], {
    state: this.state,
    onNext: async (patch) => { this.state = { ...this.state, ...patch }; await this.renderPhase(); }
  });
  this.$view.appendChild(view);
}
```

State options: (1) component state in the root passed via props/callbacks — start here; (2) `slice.context` when many deep components read it or persistence matters; (3) a Service when transitions are complex and you want to test logic in isolation. **Don't** create a route per phase, and **always** `destroyByContainer` before clearing `$view`.

### Migration Single-View → App Shell

Introduce `AppShell` owning persistent UI → wrap the old root as one section (`/play` + keep `/`) inside `MultiRoute` → add new sections one at a time. Move shared state to `slice.context` to avoid prop-drilling. Migrate one section at a time, verify, repeat.

For the fullest detail on architecture/data-passing, query the MCP for the `project-architecture/*` docs (`search_docs` → `get_doc_content`, or the WebFetch fallback — see SKILL.md doc_id map) — richer than this distilled summary.

---

## Anti-patterns

| Don't | Do |
| --- | --- |
| `:param` route syntax | `${param}` |
| Register guards after `start()` | before |
| Subscribe in setters/constructor | in `init()` |
| Use Events as a state store | use Context |
| Use Context for one-off signals | use Events |
| `setState` one field with a partial object | `(prev) => ({ ...prev, … })` (it replaces) |
| Skip `bind(this)` on long-lived components | always `bind(this)` |
| Watch full context when one field is needed | pass a selector |
| Persist ephemeral UI state | persist only durable state |
| Route per game phase / wizard step | internal state |
| Duplicate navbar per section | put it in the shell once |
