// DataGridEngine — a stateful, headless data engine for tables/lists.
//
// It owns the view state (data, search, filters, sort, page, pageSize) and
// exposes derived data (filteredRows, sortedRows, pageRows, totalPages,
// pageRange) + mutators (setData, setSearch, setFilters, toggleSort, setPage).
// No DOM, no rendering — consumers bring the UI (Table, custom lists, the
// Pagination component).
//
// The pipeline is   data → search → filters → sort → page   and every stage is
// memoized on a version counter, so asking for the same page twice (a virtual
// list scrolling, a re-render that changed nothing) never re-filters or
// re-sorts.
//
// Built per consumer via slice.build('DataGridEngine', { sliceId, data, ... });
// the owner destroys it in beforeDestroy(). Pure one-off math is also available
// as static helpers so callers that don't need state can skip the instance.

/**
 * @typedef {object} GridFilter
 * @property {string|number} key       column key the filter applies to
 * @property {'text'|'number'|'boolean'|'date'|'select'} [type]  defaults to 'text'
 * @property {string} [op]             operator; see DataGridEngine.OPERATORS
 * @property {any} [value]             operand: a string, number, boolean, date,
 *           `[from, to]` for `between`, or an array of values for `in`/`notIn`
 * @property {(row: any) => any} [accessor]  reads the value to test from a row
 *           (defaults to `row[key]`)
 */

export default class DataGridEngine {
  /**
   * Operators per filter type. The first entry is the default.
   * `empty` / `notEmpty` exist for every type: they need no operand.
   */
  static OPERATORS = {
    text: ['contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith', 'empty', 'notEmpty'],
    number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'notEmpty'],
    boolean: ['is', 'empty', 'notEmpty'],
    date: ['on', 'before', 'after', 'between', 'empty', 'notEmpty'],
    select: ['in', 'notIn', 'empty', 'notEmpty']
  };

  constructor(props = {}) {
    this._data = Array.isArray(props.data) ? props.data : [];
    this._pageSize = props.pageSize > 0 ? props.pageSize : 10;
    this._page = 1;
    this._sort = props.sort && props.sort.key ? { ...props.sort } : null;
    // Manual mode: the data is already the current page (filtered, sorted and
    // sliced elsewhere, e.g. a server). The engine then only TRACKS
    // page/sort/filter state and computes totals from an externally supplied
    // totalItems — it does not filter, sort or slice the data itself.
    this._manual = props.manual === true;
    this._totalItemsOverride = Number.isFinite(props.totalItems) ? props.totalItems : null;
    this._filters = DataGridEngine.normalizeFilters(props.filters);
    this._search = { query: '', accessors: [] };
    // Memo: bumped by every mutation that can change which rows exist or their
    // order; the derived arrays are rebuilt only when it moved.
    this._version = 0;
    this._memo = { filteredAt: -1, filtered: null, sortedAt: -1, sorted: null };
    this._clampPage();
  }

  // --- state mutators (chainable) ---
  setData(data) {
    this._data = Array.isArray(data) ? data : [];
    this._touch();
    this._clampPage();
    return this;
  }

  setPageSize(size) {
    if (size > 0) {
      this._pageSize = size;
      this._clampPage();
    }
    return this;
  }

  setPage(page) {
    this._page = this._clamp(page);
    return this;
  }

  setSort(sort) {
    this._sort = this._normalizeSort(sort);
    this._page = 1;
    this._touch();
    return this;
  }

  // Externally-known total (manual mode). Drives totalPages when set.
  setTotalItems(total) {
    this._totalItemsOverride = Number.isFinite(total) ? total : null;
    this._clampPage();
    return this;
  }

  /**
   * Replace the column filters. Incomplete filters (a `contains` with an empty
   * string, a `between` with no bounds…) are dropped, so a half-typed editor
   * never empties the grid. Resets to page 1.
   * @param {GridFilter[]} filters
   */
  setFilters(filters) {
    this._filters = DataGridEngine.normalizeFilters(filters);
    this._page = 1;
    this._touch();
    this._clampPage();
    return this;
  }

  /**
   * Global search. Every whitespace-separated term must appear in at least one
   * of the `accessors`' values (AND of terms, OR of columns), ignoring case and
   * accents. Resets to page 1.
   * @param {string} query
   * @param {Array<(row: any) => any>} [accessors]  defaults to every own value of the row
   */
  setSearch(query, accessors) {
    this._search = {
      query: typeof query === 'string' ? query : '',
      accessors: Array.isArray(accessors) ? accessors.filter((fn) => typeof fn === 'function') : []
    };
    this._page = 1;
    this._touch();
    this._clampPage();
    return this;
  }

  // Cycles a column through asc → desc → unsorted.
  //
  // `options` may carry the column's own `accessor` / `comparator` (a nested key
  // path, a custom compare). They are part of the sort STATE, so they have to
  // survive every toggle: rebuilding `{ key, direction }` and dropping them is why
  // per-column sorting used to silently fall back to `row[key]`.
  //
  // The key is compared loosely (as a string) because DOM-derived keys arrive as
  // strings while a consumer's `defaultSort` may pass the numeric index a legacy
  // column uses.
  toggleSort(key, options = {}) {
    if (!this._sort || String(this._sort.key) !== String(key)) {
      this._sort = this._normalizeSort({ key, direction: 'asc' }, options);
    } else if (this._sort.direction === 'asc') {
      this._sort = this._normalizeSort({ key, direction: 'desc' }, options);
    } else {
      this._sort = null;
    }
    this._page = 1;
    this._touch();
    return this;
  }

  // --- derived state ---
  get page() { return this._page; }
  get pageSize() { return this._pageSize; }
  get sort() { return this._sort ? { ...this._sort } : null; }
  get search() { return this._search.query; }
  /** Active filters, without their accessor functions (safe to emit or store). */
  get filters() {
    return this._filters.map(({ key, type, op, value }) => ({ key, type, op, value }));
  }
  /** Rows before any search/filter. */
  get totalUnfiltered() {
    if (this._manual && this._totalItemsOverride !== null) return this._totalItemsOverride;
    return this._data.length;
  }
  get totalItems() {
    if (this._manual && this._totalItemsOverride !== null) return this._totalItemsOverride;
    return this.filteredRows().length;
  }
  get totalPages() { return Math.max(1, Math.ceil(this.totalItems / this._pageSize)); }
  /** True when a search query or at least one filter narrows the data. */
  get isFiltered() {
    return this._filters.length > 0 || DataGridEngine._terms(this._search.query).length > 0;
  }

  /** Every row that passes the search and the filters, in data order. */
  filteredRows() {
    if (this._manual) return this._data;
    if (this._memo.filteredAt !== this._version) {
      const terms = DataGridEngine._terms(this._search.query);
      const accessors = this._search.accessors;
      const filters = this._filters;
      this._memo.filtered = (terms.length === 0 && filters.length === 0)
        ? this._data
        : this._data.filter((row) =>
            DataGridEngine.matchSearch(row, terms, accessors) &&
            filters.every((filter) => DataGridEngine.matchFilter(DataGridEngine._read(row, filter), filter))
          );
      this._memo.filteredAt = this._version;
    }
    return this._memo.filtered;
  }

  /** Filtered rows in sort order — everything a virtual list scrolls through. */
  sortedRows() {
    if (this._manual) return this._data;
    if (this._memo.sortedAt !== this._version) {
      const filtered = this.filteredRows();
      this._memo.sorted = this._sort ? DataGridEngine.sortItems(filtered, this._sort) : filtered;
      this._memo.sortedAt = this._version;
    }
    return this._memo.sorted;
  }

  // Rows for the current page. In manual mode the data IS the page, so it is
  // returned as-is; otherwise it is filtered, sorted and sliced locally.
  pageRows() {
    if (this._manual) return this._data;
    const start = (this._page - 1) * this._pageSize;
    return this.sortedRows().slice(start, start + this._pageSize);
  }

  // Page-button layout for the current page, e.g. [1, '…', 4, 5, 6, '…', 20].
  pageRange(options = {}) {
    return DataGridEngine.pageRange(this._page, this.totalPages, options);
  }

  // --- internals ---
  _touch() {
    this._version += 1;
  }

  // A sort is `{ key, direction }` plus, optionally, the per-column accessor and
  // comparator. `key === 0` is a legitimate column (the index a legacy
  // `headers`-only table uses), so the guard is `undefined`, not falsiness.
  _normalizeSort(sort, options = {}) {
    if (!sort || sort.key === undefined || sort.key === null) return null;
    const next = { key: sort.key, direction: sort.direction === 'desc' ? 'desc' : 'asc' };
    const accessor = sort.accessor !== undefined ? sort.accessor : options.accessor;
    const comparator = sort.comparator !== undefined ? sort.comparator : options.comparator;
    if (typeof accessor === 'function') next.accessor = accessor;
    if (typeof comparator === 'function') next.comparator = comparator;
    return next;
  }

  _clamp(page) {
    const p = Number.isFinite(page) ? Math.trunc(page) : 1;
    return Math.min(Math.max(1, p), this.totalPages);
  }

  _clampPage() {
    this._page = this._clamp(this._page);
  }

  // --- pure static helpers (no instance / no state) ---
  static sortItems(items, options = {}) {
    if (!Array.isArray(items)) return [];
    const { key, accessor, comparator } = options;
    const get = accessor || ((row) => (Array.isArray(row) ? row[key] : row == null ? undefined : row[key]));
    const cmp = comparator || DataGridEngine._defaultComparator;
    const dir = options.direction === 'desc' ? -1 : 1;
    // Stable sort: decorate with original index, break ties by it.
    return items
      .map((row, index) => ({ row, index }))
      .sort((a, b) => cmp(get(a.row), get(b.row)) * dir || a.index - b.index)
      .map((entry) => entry.row);
  }

  static paginate(items, page, pageSize) {
    const list = Array.isArray(items) ? items : [];
    const size = pageSize > 0 ? pageSize : 10;
    const totalItems = list.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / size));
    const p = Math.min(Math.max(1, Number.isFinite(page) ? Math.trunc(page) : 1), totalPages);
    const start = (p - 1) * size;
    const end = Math.min(start + size, totalItems);
    return { items: list.slice(start, end), page: p, pageSize: size, totalItems, totalPages, start, end };
  }

  static pageRange(current, totalPages, { siblings = 1, boundaries = 1 } = {}) {
    const total = Math.max(1, Number.isFinite(totalPages) ? Math.trunc(totalPages) : 1);
    const cur = Math.min(Math.max(1, Number.isFinite(current) ? Math.trunc(current) : 1), total);
    const range = (start, end) =>
      start > end ? [] : Array.from({ length: end - start + 1 }, (_, i) => start + i);

    const totalSlots = boundaries * 2 + siblings * 2 + 3;
    if (total <= totalSlots) return range(1, total);

    const startPages = range(1, boundaries);
    const endPages = range(total - boundaries + 1, total);

    const siblingsStart = Math.max(
      Math.min(cur - siblings, total - boundaries - siblings * 2 - 1),
      boundaries + 2
    );
    const siblingsEnd = Math.min(
      Math.max(cur + siblings, boundaries + siblings * 2 + 2),
      total - boundaries - 1
    );

    return [
      ...startPages,
      siblingsStart > boundaries + 2 ? '…' : boundaries + 1 < total - boundaries ? boundaries + 1 : null,
      ...range(siblingsStart, siblingsEnd),
      siblingsEnd < total - boundaries - 1 ? '…' : total - boundaries > boundaries ? total - boundaries : null,
      ...endPages
    ].filter((item) => item !== null);
  }

  static _defaultComparator(a, b) {
    const aNull = a == null;
    const bNull = b == null;
    if (aNull && bNull) return 0; // both nullish → tie (stable index keeps order)
    if (aNull) return -1;
    if (bNull) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  // ------------------------------------------------------------- filtering

  /** Lower-case, accent-free text: "José" and "jose" compare equal. */
  static normalizeText(value) {
    if (value === null || value === undefined) return '';
    return String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  static _terms(query) {
    const text = DataGridEngine.normalizeText(query);
    return text ? text.split(/\s+/) : [];
  }

  static _read(row, filter) {
    if (typeof filter.accessor === 'function') return filter.accessor(row);
    if (row === null || row === undefined) return undefined;
    if (typeof row !== 'object') return row;
    return row[filter.key];
  }

  /** The searchable text of one value; objects and DOM nodes are not searched. */
  static _searchable(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return DataGridEngine.normalizeText(value.toISOString().slice(0, 10));
    if (typeof value === 'object') return '';
    return DataGridEngine.normalizeText(value);
  }

  /**
   * True when every term appears in at least one accessor's value. With no
   * accessors, every own value of the row (or the row itself) is searched.
   */
  static matchSearch(row, terms, accessors = []) {
    if (!terms || terms.length === 0) return true;
    let haystack;
    if (accessors.length > 0) {
      haystack = accessors.map((read) => DataGridEngine._searchable(read(row)));
    } else if (row && typeof row === 'object') {
      haystack = Object.values(row).map((value) => DataGridEngine._searchable(value));
    } else {
      haystack = [DataGridEngine._searchable(row)];
    }
    return terms.every((term) => haystack.some((text) => text.includes(term)));
  }

  static _isEmptyValue(value) {
    return value === null || value === undefined || value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'number' && Number.isNaN(value));
  }

  static _toNumber(value) {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return NaN;
    return Number(value);
  }

  static _toBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === 'true' || value === 'yes' || value === '1') return true;
    if (value === 0 || value === 'false' || value === 'no' || value === '0') return false;
    return null;
  }

  /**
   * A calendar day as a sortable integer (YYYYMMDD), or null. A bare
   * `YYYY-MM-DD` string is read as that LOCAL day (not UTC midnight, which is
   * the previous day west of Greenwich); anything else goes through Date.
   */
  static toDay(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'string') {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
      if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
    }
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    if (!Number.isFinite(time)) return null;
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  }

  static _pair(value) {
    return Array.isArray(value) ? [value[0], value[1]] : [value, undefined];
  }

  /**
   * Does `filter` need nothing more to apply? An incomplete one (an empty text,
   * a `between` with no bounds, an empty selection) is not active and is
   * dropped by setFilters, so it never empties the grid while being typed.
   * @param {GridFilter} filter
   */
  static isActive(filter) {
    if (!filter || filter.key === undefined || filter.key === null) return false;
    const op = filter.op;
    if (op === 'empty' || op === 'notEmpty') return true;
    const value = filter.value;
    switch (filter.type) {
      case 'number': {
        if (op === 'between') {
          const [lo, hi] = DataGridEngine._pair(value);
          return Number.isFinite(DataGridEngine._toNumber(lo)) || Number.isFinite(DataGridEngine._toNumber(hi));
        }
        return Number.isFinite(DataGridEngine._toNumber(value));
      }
      case 'boolean':
        return DataGridEngine._toBoolean(value) !== null;
      case 'date': {
        if (op === 'between') {
          const [from, to] = DataGridEngine._pair(value);
          return DataGridEngine.toDay(from) !== null || DataGridEngine.toDay(to) !== null;
        }
        return DataGridEngine.toDay(value) !== null;
      }
      case 'select':
        return Array.isArray(value) ? value.length > 0 : !DataGridEngine._isEmptyValue(value);
      default:
        return DataGridEngine.normalizeText(value) !== '';
    }
  }

  /** Fill in the default type/operator and drop inactive filters. */
  static normalizeFilters(filters) {
    if (!Array.isArray(filters)) return [];
    const out = [];
    for (const raw of filters) {
      if (!raw || typeof raw !== 'object') continue;
      const type = DataGridEngine.OPERATORS[raw.type] ? raw.type : 'text';
      const ops = DataGridEngine.OPERATORS[type];
      const op = ops.includes(raw.op) ? raw.op : ops[0];
      const filter = { key: raw.key, type, op, value: raw.value };
      if (typeof raw.accessor === 'function') filter.accessor = raw.accessor;
      if (DataGridEngine.isActive(filter)) out.push(filter);
    }
    return out;
  }

  /**
   * Test one value against one filter.
   * @param {any} raw
   * @param {GridFilter} filter
   */
  static matchFilter(raw, filter) {
    const op = filter.op;
    const empty = DataGridEngine._isEmptyValue(raw);
    if (op === 'empty') return empty;
    if (op === 'notEmpty') return !empty;
    const value = filter.value;

    switch (filter.type) {
      case 'number': {
        const n = DataGridEngine._toNumber(raw);
        if (!Number.isFinite(n)) return false;
        if (op === 'between') {
          const [lo, hi] = DataGridEngine._pair(value).map((v) => DataGridEngine._toNumber(v));
          return (!Number.isFinite(lo) || n >= lo) && (!Number.isFinite(hi) || n <= hi);
        }
        const v = DataGridEngine._toNumber(value);
        switch (op) {
          case 'neq': return n !== v;
          case 'gt': return n > v;
          case 'gte': return n >= v;
          case 'lt': return n < v;
          case 'lte': return n <= v;
          default: return n === v;
        }
      }
      case 'boolean': {
        const b = DataGridEngine._toBoolean(raw);
        return b !== null && b === DataGridEngine._toBoolean(value);
      }
      case 'date': {
        const day = DataGridEngine.toDay(raw);
        if (day === null) return false;
        if (op === 'between') {
          const [from, to] = DataGridEngine._pair(value).map((v) => DataGridEngine.toDay(v));
          return (from === null || day >= from) && (to === null || day <= to);
        }
        const target = DataGridEngine.toDay(value);
        if (op === 'before') return day < target;
        if (op === 'after') return day > target;
        return day === target;
      }
      case 'select': {
        const list = Array.isArray(value) ? value : [value];
        const values = Array.isArray(raw) ? raw : [raw];
        // Loose on purpose: an option's value may be the number 2 while the
        // data holds '2', and a multi-valued cell (tags) matches on any value.
        const hit = values.some((item) => list.some((candidate) => String(candidate) === String(item)));
        return op === 'notIn' ? !hit : hit;
      }
      default: {
        const hay = DataGridEngine._searchable(raw);
        const needle = DataGridEngine.normalizeText(value);
        switch (op) {
          case 'notContains': return !hay.includes(needle);
          case 'equals': return hay === needle;
          case 'notEquals': return hay !== needle;
          case 'startsWith': return hay.startsWith(needle);
          case 'endsWith': return hay.endsWith(needle);
          default: return hay.includes(needle);
        }
      }
    }
  }

  /**
   * Guess a filter type from sample values: all numbers → number, all
   * booleans → boolean, all dates / ISO date strings → date, a few repeated
   * strings → select, anything else → text.
   * @param {any[]} values
   */
  static inferType(values) {
    const present = (values || []).filter((v) => !DataGridEngine._isEmptyValue(v)).slice(0, 200);
    if (present.length === 0) return 'text';
    if (present.every((v) => typeof v === 'number' && Number.isFinite(v))) return 'number';
    if (present.every((v) => typeof v === 'boolean')) return 'boolean';
    if (present.every((v) => v instanceof Date || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)))) {
      return 'date';
    }
    if (present.every((v) => typeof v === 'string' || typeof v === 'number')) {
      const distinct = new Set(present.map((v) => String(v)));
      if (distinct.size >= 2 && distinct.size <= 12 && distinct.size * 2 <= present.length) return 'select';
    }
    return 'text';
  }
}