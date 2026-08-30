# Visual Component Catalog

Official registry components installed by `slice init` into `src/Components/Visual/`. **Check here before building from scratch** — use `await slice.build('Name', props)` if one fits.

The names + intent are below. For the **exact, current prop list** of any component, use one of (in order of freshness): `slice browse` / read its source in `src/Components/Visual/<Name>/`, or query the MCP for `getting-started/visual-components` (see SKILL.md doc_id map). Prop lists drift between versions — **don't trust memory or this table for them** (this table is intentionally names + intent only, no prop enumerations).

_Verified against v4.x (the `VERSION` `targets` range). On a framework **major** bump, re-verify the component set and props against `slice browse` or source._

| Component | Intent |
| --- | --- |
| **Layout** | Top-level page layout; often the root in a shell |
| **Grid** | Responsive grid container; `setItem(component)` adds cells |
| **Card** | Content card with a title, body text, and optional icon |
| **Details** | Expandable summary/details (click-to-toggle) |
| **Button** | Clickable button with optional icon and a click callback |
| **Input** | Text field with label and validation |
| **Checkbox** | Boolean checkbox |
| **Switch** | Binary on/off toggle (visually distinct from Checkbox) |
| **Select** | Dropdown selector over a list of options |
| **DropDown** | Generic dropdown menu for arbitrary content |
| **Navbar** | Top nav with a brand and navigable items (uses `slice.router.navigate`) |
| **Route / MultiRoute** | Routing containers — see `state-and-routing.md` |
| **NotFound** | Default 404 page (map `/404` → `NotFound` in routes) |
| **Loading** | Loading indicator; usually built once at init (`loading.enabled`) |
| **Icon** | Icon renderer |
| **CodeVisualizer** | Syntax-highlighted code blocks |
| **TreeView / TreeItem** | Hierarchical tree (container + node) |

**Registry Services** (install with `slice get <Name> --service`):

| Service | Intent |
| --- | --- |
| **FetchManager** | `fetch` wrapper: error handling, timeouts, auth headers |
| **IndexedDbManager** | IndexedDB helper (open, CRUD, cursors) |
| **LocalStorageManager** | typed get/set over `localStorage` with JSON serialization |
| **Link** | programmatic navigation helper used by Slice's own components |

**Registry vs build-your-own:** use the registry component if its props cover your need (style adjusts via CSS variables/theme). Build your own when the interaction model differs fundamentally, you need tight markup control (a11y/animation), or behavior the component doesn't expose.

Discover/install: `slice browse` (full current catalog) · `slice get <Name>` (install) · `slice get <Name> --service` (install a Service).
