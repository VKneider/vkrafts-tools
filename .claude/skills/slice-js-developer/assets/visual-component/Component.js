/**
 * SLICE_TEMPLATE: Visual Component
 *
 * Replace `MyComponent` with your component class name (PascalCase).
 * Replace `slice-my-component` with your custom element tag (must contain a hyphen).
 * Update `static props` to match your component's public API.
 *
 * The three rules (see references/core-model.md):
 * 1. The template/DOM is only available AFTER `slice.attachTemplate(this)`. Call it first in
 *    the constructor; then querySelector and listener binding work IN the constructor.
 * 2. Side effects belong in setters. `setComponentProps` (called LAST in the constructor)
 *    fires every setter, including `static props` defaults.
 * 3. Always `await slice.build()` when constructing children.
 *
 * This scaffold uses Pattern A (refs captured in the constructor, like the official
 * Button/Input/Link components): setters can touch the DOM directly, no `?.()` guards.
 * For Pattern B (refs in init() — useful when init is purely async), see core-model.md.
 */

export default class MyComponent extends HTMLElement {
  // SLICE_TEMPLATE: declare every public prop with type and default.
  // Types: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'function'
  // Use `required: true` for props without defaults that must be passed.
  static props = {
    title:    { type: 'string',   default: '' },
    items:    { type: 'array',    default: [] },
    onSelect: { type: 'function', default: null }
  };

  constructor(props) {
    super();
    slice.attachTemplate(this);                        // 1. inject .html as children

    // 2. Cache DOM refs + bind listeners — template is attached, so this works here
    this.$root  = this.querySelector('.my-component');
    this.$title = this.querySelector('.my-component__title');
    this.$list  = this.querySelector('.my-component__list');
    this.$root.addEventListener('click', this.handleRootClick);

    // 3. Subscribe to events with auto-cleanup (optional)
    this.events = slice.events.bind(this);
    // this.events.subscribe('some:event', (data) => this.handleEvent(data));

    slice.controller.setComponentProps(this, props);   // 4. LAST → setters fire with refs ready
  }

  // ──────────────────────────────────────────────────────────────────
  // Lifecycle — init() is for ASYNC work only (fetch, building children)
  // ──────────────────────────────────────────────────────────────────

  async init() {
    // Example: build child components (always await). Sync rendering already happened
    // in the setters during construction.
    await this.renderItems();
  }

  // OPTIONAL — most components don't need update(): assigning a prop runs its setter,
  // which already refreshes the DOM. Keep this ONLY for a cached MultiRoute view (called
  // on revisit) or refresh that needs async/custom logic; otherwise delete it.
  async update() {
    await this.renderItems();
  }

  beforeDestroy() {
    // Synchronous cleanup of things that OUTLIVE this component's DOM subtree.
    // events.bind(this) subscriptions, context watchers, and child components are auto-cleaned.
    clearInterval(this._pollingId);
    this._abortController?.abort();
    // window.removeEventListener('resize', this.onResize);
  }

  // ──────────────────────────────────────────────────────────────────
  // Setters — side effects live here. Pattern A: refs exist, no `?.()` needed.
  // ──────────────────────────────────────────────────────────────────

  set title(value) {
    this._title = value || '';
    this.$title.textContent = this._title;
  }

  set items(value) {
    this._items = Array.isArray(value) ? value : [];
    // Async re-render is fire-and-forget from a (sync) setter:
    this.renderItems();
  }

  set onSelect(fn) {
    this._onSelect = typeof fn === 'function' ? fn : null;
  }

  // ──────────────────────────────────────────────────────────────────
  // Render helpers
  // ──────────────────────────────────────────────────────────────────

  async renderItems() {
    if (!this.$list) return;
    // Destroy child Slice components BEFORE clearing the DOM (avoids leaks)
    slice.controller.destroyByContainer(this.$list);
    this.$list.innerHTML = '';

    for (const item of this._items ?? []) {
      // Example: build a child component for each item
      // const node = await slice.build('SomeChildComponent', { ...item });
      // this.$list.appendChild(node);

      const li = document.createElement('li');
      li.textContent = item.label ?? String(item);
      this.$list.appendChild(li);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Handlers (arrow methods to keep `this` bound)
  // ──────────────────────────────────────────────────────────────────

  handleRootClick = (event) => {
    if (this._onSelect) this._onSelect(event);
  };
}

// SLICE_TEMPLATE: tag must contain a hyphen and be unique
customElements.define('slice-my-component', MyComponent);
