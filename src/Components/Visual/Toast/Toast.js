const TOAST_TYPES = new Set(['success', 'error', 'warning', 'info', 'default']);

function resolveType(value) {
  return TOAST_TYPES.has(value) ? value : 'default';
}

export default class Toast extends HTMLElement {
  static props = {
    message: { type: 'string', default: '' },
    type: { type: 'string', default: 'default' },
    duration: { type: 'number', default: 4000 },
    dismissable: { type: 'boolean', default: true },
    customColor: { type: 'object', default: null }
  };

  constructor(props) {
    super();
    slice.attachTemplate(this);

    this.$root = this.querySelector('.slice-toast');
    this.$message = this.querySelector('.slice-toast__message');
    this.$close = this.querySelector('.slice-toast__close');
    this.$icon = this.querySelector('.slice-toast__icon');

    this._message = '';
    this._type = 'default';
    this._duration = 4000;
    this._dismissable = true;
    this._customColor = null;
    this._dismissTimer = null;
    this._exiting = false;

    slice.controller.setComponentProps(this, props || {});

    this._handleClose = this._handleClose.bind(this);
  }

  set message(value) {
    this._message = typeof value === 'string' ? value : '';
    if (this.$message) this.$message.textContent = this._message;
  }

  get message() { return this._message; }

  set type(value) {
    this._type = resolveType(value);
    if (this.$root) {
      this.$root.className = this.$root.className
        .replace(/slice-toast--\w+/g, '')
        .trim() + ` slice-toast--${this._type}`;
    }
    if (this.$icon) this.$icon.dataset.type = this._type;
  }

  get type() { return this._type; }

  set duration(value) {
    this._duration = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 4000;
  }

  get duration() { return this._duration; }

  set dismissable(value) {
    this._dismissable = value !== false;
    if (this.$close) {
      this.$close.style.display = this._dismissable ? '' : 'none';
    }
  }

  get dismissable() { return this._dismissable; }

  set customColor(value) {
    this._customColor = value || null;
    if (!this._customColor) return;
    const cc = this._customColor;
    if (cc.background) this.$root.style.setProperty('--toast-bg', cc.background);
    if (cc.text) this.$root.style.setProperty('--toast-text', cc.text);
    if (cc.accent) this.$root.style.setProperty('--toast-accent', cc.accent);
  }

  get customColor() { return this._customColor; }

  init() {
    if (this._dismissable && this.$close) {
      this.$close.addEventListener('click', this._handleClose);
    }
    if (!this._message && this.$message) {
      this.$message.textContent = '';
    }
    this.show();
  }

  show() {
    if (this._exiting) return;
    this._startTimer();
    requestAnimationFrame(() => {
      if (this.$root) this.$root.classList.add('slice-toast--visible');
    });
  }

  hide() {
    if (this._exiting) return;
    this._exiting = true;
    this._clearTimer();
    if (this.$root) {
      this.$root.classList.remove('slice-toast--visible');
      this.$root.classList.add('slice-toast--exiting');
    }
    setTimeout(() => {
      if (this.parentNode) this.parentNode.removeChild(this);
      this.dispatchEvent(new CustomEvent('toast-dismissed', { bubbles: true }));
    }, 260);
  }

  _handleClose() {
    this.hide();
  }

  _startTimer() {
    this._clearTimer();
    if (this._duration > 0) {
      this._dismissTimer = setTimeout(() => this.hide(), this._duration);
    }
  }

  _clearTimer() {
    if (this._dismissTimer) {
      clearTimeout(this._dismissTimer);
      this._dismissTimer = null;
    }
  }

  disconnectedCallback() {
    this._clearTimer();
  }

  beforeDestroy() {
    this._clearTimer();
  }
}

customElements.define('slice-toast', Toast);
