import DataGridEngine from '../../Service/DataGridEngine/DataGridEngine.js';
import { applySize, SIZE_VALUES } from '../../shared/props.js';
import { texts } from '../../shared/text/texts.js';
// Pagination — moves through pages of a list, a table or search results.
//
//   [«] [‹ Previous] [1] … [4] [5] [6] … [20] [Next ›] [»]    21–40 of 400   Rows per page [20 ▾]
//
// What it shows:
//   mode 'pages'    numbered pages with ellipses (DataGridEngine.pageRange)
//   mode 'compact'  "Page 5 of 20" between previous and next
//   mode 'dots'     one dot per page, for a few pages (a carousel, onboarding)
// In a narrow container, 'pages' turns into 'compact' by itself.
//
// Around it, optionally: the range on screen ("21–40 of 400", from
// totalItems and pageSize), a page-size picker (pageSizes), and a box to jump
// to a page.
//
// By default it moves to the page that was picked and reports it with
// onPageChange. `controlled: true` only reports, and waits for `currentPage`
// to be set — for when the page lives somewhere else (a router, a Table).
// `hrefTemplate` ("?page={page}") renders real links, so pages can be opened
// in a new tab and crawled.

const VARIANTS = ['outlined', 'soft', 'ghost', 'segmented', 'underline'];
const MODES = ['pages', 'compact', 'dots'];
const SHAPES = ['rounded', 'circle'];
const ALIGNS = ['start', 'center', 'end', 'between'];

const TEXTS = {
   label: 'Pagination',
   previous: 'Previous',
   next: 'Next',
   first: 'First page',
   last: 'Last page',
   previousPage: 'Previous page',
   nextPage: 'Next page',
   page: 'Page {page}',
   pageOf: 'Page {page} of {total}',
   info: '{from}–{to} of {total}',
   empty: 'No results',
   perPage: 'Rows per page',
   goTo: 'Go to page',
};

// Spanish mirrors TEXTS key by key; the app can override any of them with its dictionary.
const ES = {
   label: 'Paginación',
   previous: 'Anterior',
   next: 'Siguiente',
   first: 'Primera página',
   last: 'Última página',
   previousPage: 'Página anterior',
   nextPage: 'Página siguiente',
   page: 'Página {page}',
   pageOf: 'Página {page} de {total}',
   info: '{from}–{to} de {total}',
   empty: 'Sin resultados',
   perPage: 'Filas por página',
   goTo: 'Ir a la página',
};

const t = texts('slice.pagination', { en: TEXTS, es: ES });

const ICONS = {
   previous: '<path d="m15 18-6-6 6-6"/>',
   next: '<path d="m9 18 6-6-6-6"/>',
   first: '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>',
   last: '<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

function fill(template, values) {
   return String(template).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

export default class Pagination extends HTMLElement {
   static props = {
      currentPage: { type: 'number', default: 1 },
      totalPages: { type: 'number', default: 1 },
      totalItems: { type: 'number', default: null },
      pageSize: { type: 'number', default: 10 },
      pageSizes: { type: 'array', default: [] },
      siblingCount: { type: 'number', default: 1 },
      boundaryCount: { type: 'number', default: 1 },
      showFirstLast: { type: 'boolean', default: false },
      // false hides Previous and Next, for dots under a carousel that has its own arrows.
      showPrevNext: { type: 'boolean', default: true },
      showLabels: { type: 'boolean', default: false },
      showInfo: { type: 'boolean', default: false },
      showJump: { type: 'boolean', default: false },
      mode: { type: 'string', default: 'pages', allowedValues: MODES },
      variant: { type: 'string', default: 'outlined', allowedValues: VARIANTS },
      shape: { type: 'string', default: 'rounded', allowedValues: SHAPES },
      size: { type: 'string', default: 'md', allowedValues: SIZE_VALUES },
      align: { type: 'string', default: 'start', allowedValues: ALIGNS },
      hrefTemplate: { type: 'string', default: '' },
      controlled: { type: 'boolean', default: false },
      disabled: { type: 'boolean', default: false },
      texts: { type: 'object', default: null },
      onPageChange: { type: 'function', default: null },
      onPageSizeChange: { type: 'function', default: null },
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$nav = this.querySelector('.slice-pagination');
      this.$info = this.querySelector('.slice-pagination__info');
      this.$bar = this.querySelector('.slice-pagination__bar');
      this.$tools = this.querySelector('.slice-pagination__tools');

      this._currentPage = 1;
      this._totalPages = 1;
      this._totalItems = null;
      this._pageSize = 10;
      this._pageSizes = [];
      this._siblingCount = 1;
      this._boundaryCount = 1;
      this._showFirstLast = false;
      this._showPrevNext = true;
      this._showLabels = false;
      this._showInfo = false;
      this._showJump = false;
      this._mode = 'pages';
      this._variant = 'outlined';
      this._shape = 'rounded';
      this._size = 'md';
      this._align = 'start';
      this._hrefTemplate = '';
      this._controlled = false;
      this._disabled = false;
      this._texts = {};
      this._onPageChange = null;
      this._onPageSizeChange = null;

      this._ready = false;
      this._sizeSelect = null;
      this._toolsKey = '';
      this._handleClick = this._handleClick.bind(this);
      this._handleJump = this._handleJump.bind(this);

      slice.controller.setComponentProps(this, props || {});
   }

   async init() {
      this._ready = true;
      this.$bar.addEventListener('click', this._handleClick);
      this.$tools.addEventListener('keydown', this._handleJump);
      this.variant = this._variant;
      this.shape = this._shape;
      this.size = this._size;
      this.align = this._align;
      this.dataset.mode = this._mode;
      this.$nav?.setAttribute('aria-label', this._t('label'));
      slice.translator?.watch?.(this, () => {
         this.$nav?.setAttribute('aria-label', this._t('label'));
         this._render();
         this._toolsKey = '';
         this._renderTools();
      });
      this._render();
      await this._renderTools();
   }

   beforeDestroy() {
      this._ready = false;
      this.$bar.removeEventListener('click', this._handleClick);
      this.$tools.removeEventListener('keydown', this._handleJump);
      if (this._sizeSelect) slice.controller.destroyComponent(this._sizeSelect);
      this._sizeSelect = null;
   }

   // ── Props ──────────────────────────────────────────────────────

   get currentPage() { return this._currentPage; }
   set currentPage(value) {
      this._currentPage = Number.isFinite(Number(value)) ? Math.max(1, Math.trunc(Number(value))) : 1;
      this._render();
   }

   /** Pages: from totalItems and pageSize when totalItems is set. */
   get totalPages() {
      if (this._totalItems != null) return Math.max(1, Math.ceil(this._totalItems / this._pageSize));
      return this._totalPages;
   }
   set totalPages(value) {
      this._totalPages = Math.max(1, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 1);
      this._render();
   }

   get totalItems() { return this._totalItems; }
   set totalItems(value) {
      this._totalItems = value === null || value === undefined || value === '' ? null : Math.max(0, Math.trunc(Number(value)) || 0);
      this._render();
   }

   get pageSize() { return this._pageSize; }
   set pageSize(value) {
      this._pageSize = Number(value) > 0 ? Math.trunc(Number(value)) : 10;
      if (this._sizeSelect) this._sizeSelect.selected = String(this._pageSize);
      this._render();
   }

   get pageSizes() { return this._pageSizes; }
   set pageSizes(value) {
      this._pageSizes = Array.isArray(value) ? value.map(Number).filter((n) => n > 0) : [];
      this._ready && this._renderTools();
   }

   get siblingCount() { return this._siblingCount; }
   set siblingCount(value) { this._siblingCount = Math.max(0, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 1); this._render(); }

   get boundaryCount() { return this._boundaryCount; }
   set boundaryCount(value) { this._boundaryCount = Math.max(1, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 1); this._render(); }

   get showFirstLast() { return this._showFirstLast; }
   set showFirstLast(value) { this._showFirstLast = value === true; this._render(); }

   get showPrevNext() { return this._showPrevNext; }
   set showPrevNext(value) { this._showPrevNext = value !== false; this._render(); }

   get showLabels() { return this._showLabels; }
   set showLabels(value) { this._showLabels = value === true; this._render(); }

   get showInfo() { return this._showInfo; }
   set showInfo(value) { this._showInfo = value === true; this._render(); }

   get showJump() { return this._showJump; }
   set showJump(value) { this._showJump = value === true; this._ready && this._renderTools(); }

   get mode() { return this._mode; }
   set mode(value) {
      this._mode = MODES.includes(value) ? value : 'pages';
      this.dataset.mode = this._mode;
      this._render();
   }

   get variant() { return this._variant; }
   set variant(value) {
      this._variant = VARIANTS.includes(value) ? value : 'outlined';
      for (const v of VARIANTS) this.classList.remove(`slice-pagination--${v}`);
      this.classList.add(`slice-pagination--${this._variant}`);
   }

   get shape() { return this._shape; }
   set shape(value) { this._shape = SHAPES.includes(value) ? value : 'rounded'; this.dataset.shape = this._shape; }

   get size() { return this._size; }
   set size(value) { this._size = applySize(this, value, 'md'); }

   get align() { return this._align; }
   set align(value) { this._align = ALIGNS.includes(value) ? value : 'start'; this.dataset.align = this._align; }

   get hrefTemplate() { return this._hrefTemplate; }
   set hrefTemplate(value) { this._hrefTemplate = value ? String(value) : ''; this._render(); }

   get controlled() { return this._controlled; }
   set controlled(value) { this._controlled = value === true; }

   get disabled() { return this._disabled; }
   set disabled(value) {
      this._disabled = value === true;
      this.classList.toggle('is-disabled', this._disabled);
      this._render();
      if (this._sizeSelect) this._sizeSelect.disabled = this._disabled;
      const jump = this.$tools.querySelector('input');
      if (jump) jump.disabled = this._disabled;
   }

   get texts() { return this._texts; }
   set texts(value) {
      this._texts = value && typeof value === 'object' ? { ...value } : {};
      this.$nav?.setAttribute('aria-label', this._t('label'));
      this._render();
      if (this._ready) {
         this._toolsKey = '';
         this._renderTools();
      }
   }

   get onPageChange() { return this._onPageChange; }
   set onPageChange(value) { this._onPageChange = typeof value === 'function' ? value : null; }

   get onPageSizeChange() { return this._onPageSizeChange; }
   set onPageSizeChange(value) { this._onPageSizeChange = typeof value === 'function' ? value : null; }

   // ── Methods ────────────────────────────────────────────────────

   /** Go to a page (clamped). Reports it, and moves unless controlled. */
   goTo(page, event = null) {
      const next = this._normalize(page);
      if (next === this._page()) return;
      const previous = this._page();
      if (!this._controlled) this.currentPage = next;
      this._onPageChange?.(next, { previous, event, pagination: this });
      this.dispatchEvent(new CustomEvent('page-change', { bubbles: true, detail: { page: next, previous } }));
   }

   next() { this.goTo(this._page() + 1); }
   previous() { this.goTo(this._page() - 1); }

   /** The items on screen, from totalItems and pageSize: { from, to, total }. */
   get range() {
      const total = this._totalItems ?? 0;
      if (!total) return { from: 0, to: 0, total: 0 };
      const from = (this._page() - 1) * this._pageSize + 1;
      return { from, to: Math.min(total, from + this._pageSize - 1), total };
   }

   // ── Rendering ──────────────────────────────────────────────────

   _t(key, values = {}) {
      return fill(this._texts[key] ?? t(key), values);
   }

   _page() {
      return Math.min(Math.max(1, this._currentPage), this.totalPages);
   }

   _normalize(value) {
      const p = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 1;
      return Math.min(Math.max(1, p), this.totalPages);
   }

   _render() {
      if (!this.$bar) return;
      const cur = this._page();
      const total = this.totalPages;
      const atStart = cur <= 1;
      const atEnd = cur >= total;
      const nodes = [];

      if (this._showFirstLast) nodes.push(this._control({ page: 1, icon: 'first', aria: this._t('first'), disabled: atStart, edge: true }));
      if (this._showPrevNext) nodes.push(this._control({ page: cur - 1, icon: 'previous', text: this._showLabels ? this._t('previous') : '', aria: this._t('previousPage'), disabled: atStart, edge: true, rel: 'prev' }));

      if (this._mode === 'dots') {
         const dots = document.createElement('span');
         dots.className = 'slice-pagination__dots';
         for (let page = 1; page <= total; page++) {
            dots.appendChild(this._control({ page, aria: this._t('page', { page }), current: page === cur, dot: true }));
         }
         nodes.push(dots);
      } else {
         const pages = document.createElement('span');
         pages.className = 'slice-pagination__pages';
         if (this._mode === 'compact') pages.hidden = true;
         for (const page of DataGridEngine.pageRange(cur, total, { siblings: this._siblingCount, boundaries: this._boundaryCount })) {
            pages.appendChild(page === '…'
               ? this._ellipsis()
               : this._control({ page, text: String(page), aria: this._t('page', { page }), current: page === cur }));
         }
         nodes.push(pages);
         // Shown in compact mode, and in 'pages' mode when the container is too narrow.
         const compact = document.createElement('span');
         compact.className = 'slice-pagination__compact';
         compact.textContent = this._t('pageOf', { page: cur, total });
         nodes.push(compact);
      }

      if (this._showPrevNext) nodes.push(this._control({ page: cur + 1, icon: 'next', text: this._showLabels ? this._t('next') : '', aria: this._t('nextPage'), disabled: atEnd, edge: true, rel: 'next', iconAfter: true }));
      if (this._showFirstLast) nodes.push(this._control({ page: total, icon: 'last', aria: this._t('last'), disabled: atEnd, edge: true }));

      // Keep the focus on the same control across the re-render.
      const focused = this.$bar.contains(document.activeElement) ? document.activeElement : null;
      const focusKey = focused ? (focused.dataset.rel || `p${focused.dataset.page}`) : '';
      this.$bar.replaceChildren(...nodes);
      if (focusKey) {
         const again = this.$bar.querySelector(focusKey.startsWith('p') ? `[data-page="${focusKey.slice(1)}"]:not([data-rel])` : `[data-rel="${focusKey}"]`);
         (again && !again.hasAttribute('disabled') ? again : this.$bar.querySelector('[aria-current="page"]'))?.focus();
      }

      const showInfo = this._showInfo;
      this.$info.hidden = !showInfo;
      if (showInfo) {
         const { from, to, total: items } = this.range;
         this.$info.textContent = this._totalItems == null
            ? this._t('pageOf', { page: cur, total })
            : items ? this._t('info', { from: from.toLocaleString(), to: to.toLocaleString(), total: items.toLocaleString() }) : this._t('empty');
      }
      const jump = this.$tools.querySelector('input');
      if (jump) jump.max = String(total);
   }

   _control({ page, text = '', icon = '', aria, current = false, disabled = false, edge = false, dot = false, rel = '', iconAfter = false }) {
      const link = this._hrefTemplate && !disabled && !current && !this._disabled;
      const el = document.createElement(link ? 'a' : 'button');
      if (link) el.href = slice.href(fill(this._hrefTemplate, { page }));
      else el.type = 'button';
      el.className = 'slice-pagination__item';
      if (edge) el.classList.add('slice-pagination__item--edge');
      if (dot) el.classList.add('slice-pagination__item--dot');
      el.dataset.page = String(page);
      if (rel) {
         el.dataset.rel = rel;
         if (link) el.rel = rel;
      }
      el.setAttribute('aria-label', aria);
      if (icon && !iconAfter) el.insertAdjacentHTML('beforeend', svg(icon));
      if (text) {
         const span = document.createElement('span');
         span.className = 'slice-pagination__text';
         span.textContent = text;
         el.appendChild(span);
      }
      if (icon && iconAfter) el.insertAdjacentHTML('beforeend', svg(icon));
      if (current) {
         el.classList.add('slice-pagination__item--current');
         el.setAttribute('aria-current', 'page');
      }
      if (disabled || this._disabled) {
         if (link) el.removeAttribute('href');
         else el.setAttribute('disabled', '');
         el.setAttribute('aria-disabled', 'true');
      }
      return el;
   }

   _ellipsis() {
      const span = document.createElement('span');
      span.className = 'slice-pagination__ellipsis';
      span.textContent = '…';
      span.setAttribute('aria-hidden', 'true');
      return span;
   }

   async _renderTools() {
      const key = JSON.stringify([this._pageSizes, this._showJump]);
      if (key === this._toolsKey) return;
      this._toolsKey = key;
      if (this._sizeSelect) slice.controller.destroyComponent(this._sizeSelect);
      this._sizeSelect = null;
      this.$tools.replaceChildren();

      if (this._pageSizes.length) {
         const label = document.createElement('span');
         label.className = 'slice-pagination__tool-label';
         label.textContent = this._t('perPage');
         const sizes = this._pageSizes.includes(this._pageSize) ? this._pageSizes : [...this._pageSizes, this._pageSize].sort((a, b) => a - b);
         const select = await slice.build('Select', {
            options: sizes.map(String),
            selected: String(this._pageSize),
            size: 'sm',
            disabled: this._disabled,
            onChange: (value) => {
               const size = Number(Array.isArray(value) ? value[0] : value);
               if (!size || size === this._pageSize) return;
               // Keep the first item on screen in view: page 3 of 10 rows is page 2 of 20.
               const firstItem = (this._page() - 1) * this._pageSize;
               this.pageSize = size;
               this._onPageSizeChange?.(size, { pagination: this });
               this.dispatchEvent(new CustomEvent('page-size-change', { bubbles: true, detail: { pageSize: size } }));
               this.goTo(Math.floor(firstItem / size) + 1);
            },
         });
         if (!this._ready || key !== this._toolsKey) {
            if (select) slice.controller.destroyComponent(select);
            return;
         }
         this._sizeSelect = select;
         const group = document.createElement('label');
         group.className = 'slice-pagination__tool';
         group.append(label, select);
         this.$tools.appendChild(group);
      }

      if (this._showJump) {
         const group = document.createElement('label');
         group.className = 'slice-pagination__tool';
         const label = document.createElement('span');
         label.className = 'slice-pagination__tool-label';
         label.textContent = this._t('goTo');
         const input = document.createElement('input');
         input.type = 'number';
         input.className = 'slice-pagination__jump';
         input.min = '1';
         input.max = String(this.totalPages);
         input.inputMode = 'numeric';
         input.disabled = this._disabled;
         group.append(label, input);
         this.$tools.appendChild(group);
      }
      this.$tools.hidden = !this.$tools.childElementCount;
   }

   // ── Events ─────────────────────────────────────────────────────

   _handleClick(event) {
      const control = event.target.closest('[data-page]');
      if (!control || this._disabled || control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true') {
         if (control?.tagName === 'A') event.preventDefault();
         return;
      }
      const page = Number(control.dataset.page);
      if (!Number.isFinite(page) || page === this._page()) {
         if (control.tagName === 'A') event.preventDefault();
         return;
      }
      // A link stays a link (Ctrl/⌘-click, middle click open a tab); a plain
      // click is reported, and onPageChange can call event.preventDefault()
      // to keep the page from navigating.
      if (control.tagName === 'A' && (event.ctrlKey || event.metaKey || event.shiftKey || event.button === 1)) return;
      this.goTo(page, event);
   }

   _handleJump(event) {
      if (event.key !== 'Enter' || !event.target.matches('.slice-pagination__jump')) return;
      event.preventDefault();
      const value = Number(event.target.value);
      if (Number.isFinite(value) && value >= 1) this.goTo(value, event);
      event.target.value = '';
   }
}

customElements.define('slice-pagination', Pagination);