const _sliceDeprecated = new Set();
function deprecate(oldName, newName) {
  if (_sliceDeprecated.has(oldName)) return;
  _sliceDeprecated.add(oldName);
  console.warn(`[Slice] "${oldName}" is deprecated; use "${newName}" instead.`);
}

export default class Breadcrumbs extends HTMLElement {
  static props = {
    items: {
      type: 'array',
      default: [],
      required: false,
      items: {
        type: 'object',
        schema: {
          text: { type: 'string', required: true },
          path: { type: 'string', required: false }
        }
      }
    },
    children: {
      type: 'array',
      default: [],
      required: false,
      items: {
        type: 'object',
        schema: {
          path: { type: 'string', required: true },
          text: { type: 'string', required: false },
          title: { type: 'string', required: false },
          children: { type: 'array', required: false }
        }
      }
    },
    currentPath: {
      type: 'string',
      default: '',
      required: false
    },
    separator: {
      type: 'string',
      default: '/',
      required: false
    },
    includeCurrent: {
      type: 'boolean',
      default: true,
      required: false
    },
    maxItems: {
      type: 'number',
      default: 0,
      required: false
    },
    onClick: {
      type: 'function',
      default: null,
      required: false
    },
    onClickCallback: {
      type: 'function',
      default: null,
      required: false
    }
  };

  constructor(props) {
    super();
    slice.attachTemplate(this);

    this.$root = this.querySelector('.slice_breadcrumbs');
    this.$list = this.querySelector('.slice_breadcrumbs_list');

    this._items = [];
    this._separator = '/';
    this._includeCurrent = true;
    this._maxItems = 0;
    this._onClick = null;
    this._children = [];
    this._currentPath = '';

    slice.controller.setComponentProps(this, props);
  }

  init() {
    this.render();
  }

  get items() {
    return this._items;
  }

  set items(value) {
    this._items = Array.isArray(value) ? value : [];
    this.render();
  }

  get separator() {
    return this._separator;
  }

  set separator(value) {
    this._separator = typeof value === 'string' && value.trim().length > 0 ? value : '/';
    this.render();
  }

  get children() {
    return this._children;
  }

  set children(value) {
    this._children = Array.isArray(value) ? value : [];
    this.render();
  }

  get currentPath() {
    return this._currentPath;
  }

  set currentPath(value) {
    this._currentPath = typeof value === 'string' ? value : '';
    this.render();
  }

  get includeCurrent() {
    return this._includeCurrent;
  }

  set includeCurrent(value) {
    this._includeCurrent = value !== false;
    this.render();
  }

  get maxItems() {
    return this._maxItems;
  }

  set maxItems(value) {
    this._maxItems = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    this.render();
  }

  get onClick() {
    return this._onClick;
  }

  set onClick(value) {
    if (typeof value === 'function') this._onClick = value;
  }

  set onClickCallback(value) {
    if (typeof value === 'function') {
      this._onClick ??= value;
      deprecate('onClickCallback', 'onClick');
    }
  }

  _sanitizeItems(items) {
    return items
      .filter((item) => item && typeof item.text === 'string' && item.text.trim().length > 0)
      .map((item) => ({
        text: item.text,
        path: typeof item.path === 'string' ? item.path : ''
      }));
  }

  _normalizePath(path) {
    const value = String(path || '').trim();
    if (!value) return '';
    const normalized = value.startsWith('/') ? value : `/${value}`;
    return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
  }

  _joinPath(parentPath, childPath) {
    const parent = this._normalizePath(parentPath);
    const child = this._normalizePath(childPath);
    if (!child) return parent;
    if (!parent) return child;
    if (child === parent || child.startsWith(`${parent}/`)) return child;
    return this._normalizePath(`${parent}/${child.replace(/^\//, '')}`);
  }

  _resolveItemsFromChildren() {
    const rootChildren = Array.isArray(this._children) ? this._children : [];
    if (!rootChildren.length) return [];

    const targetPath = this._normalizePath(this._currentPath || window.location.pathname || '');
    if (!targetPath) return [];

    const makeLabel = (node, fallbackPath) => {
      const rawLabel = node?.text || node?.title || '';
      if (typeof rawLabel === 'string' && rawLabel.trim().length > 0) {
        return rawLabel;
      }
      const segment = fallbackPath.split('/').filter(Boolean).pop() || '';
      return segment.replace(/[-_]/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase()) || 'Page';
    };

    const findTrail = (nodes, parentPath = '', trail = []) => {
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;

        const resolvedPath = this._joinPath(parentPath, node.path);
        if (!resolvedPath) continue;

        const nextTrail = [...trail, {
          text: makeLabel(node, resolvedPath),
          path: resolvedPath
        }];

        if (resolvedPath === targetPath) {
          return nextTrail;
        }

        const children = Array.isArray(node.children) ? node.children : [];
        if (children.length) {
          const childTrail = findTrail(children, resolvedPath, nextTrail);
          if (childTrail.length) {
            return childTrail;
          }
        }
      }

      return [];
    };

    return findTrail(rootChildren);
  }

  _applyMaxItems(items) {
    if (!this._maxItems || items.length <= this._maxItems) {
      return items;
    }

    if (this._maxItems === 1) {
      return [items[items.length - 1]];
    }

    if (this._maxItems === 2) {
      return [items[0], items[items.length - 1]];
    }

    const head = items[0];
    const tailCount = this._maxItems - 2;
    const tail = items.slice(items.length - tailCount);
    return [head, { text: '...', path: '' }, ...tail];
  }

  _renderSeparator() {
    const separator = document.createElement('span');
    separator.className = 'slice_breadcrumbs_separator';
    separator.setAttribute('aria-hidden', 'true');
    separator.textContent = this._separator;
    return separator;
  }

  _renderLink(item, isCurrent) {
    const isNavigable = !isCurrent && item.path && item.text !== '...';

    if (isNavigable) {
      const link = document.createElement('a');
      link.className = 'slice_breadcrumbs_link';
      link.href = item.path;
      link.textContent = item.text;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        if (typeof this._onClick === 'function') {
          this._onClick(item);
        }
        if (typeof slice?.router?.navigate === 'function') {
          slice.router.navigate(item.path);
        }
      });
      return link;
    }

    const current = document.createElement('span');
    current.className = isCurrent ? 'slice_breadcrumbs_current' : 'slice_breadcrumbs_link';
    current.textContent = item.text;
    if (isCurrent) {
      current.setAttribute('aria-current', 'page');
    }
    return current;
  }

  render() {
    if (!this.$list || !this.$root) return;

    this.$list.innerHTML = '';

    const fromChildren = this._resolveItemsFromChildren();
    const sanitized = this._sanitizeItems(this._items);
    const sourceItems = fromChildren.length ? fromChildren : sanitized;

    if (sourceItems.length === 0) {
      this.$root.setAttribute('aria-hidden', 'true');
      return;
    }
    this.$root.removeAttribute('aria-hidden');

    const baseItems = this._includeCurrent ? sourceItems : sourceItems.slice(0, -1);
    const itemsToRender = this._applyMaxItems(baseItems);
    if (itemsToRender.length === 0) {
      this.$root.setAttribute('aria-hidden', 'true');
      return;
    }

    itemsToRender.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'slice_breadcrumbs_item';

      const isLast = index === itemsToRender.length - 1;
      const isCurrent = this._includeCurrent && isLast;
      li.appendChild(this._renderLink(item, isCurrent));

      if (!isLast) {
        li.appendChild(this._renderSeparator());
      }

      this.$list.appendChild(li);
    });
  }
}

customElements.define('slice-breadcrumbs', Breadcrumbs);
