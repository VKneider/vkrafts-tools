const VALID_POSITIONS = new Set([
  'top-right', 'top-left', 'bottom-right', 'bottom-left', 'top-center', 'bottom-center'
]);

export default class ToastProvider {
  constructor() {
    this._container = null;
    this._toasts = new Map();
    this._position = 'top-right';
    this._maxToasts = 5;
    this._counter = 0;

    this._handleToastDismissed = this._handleToastDismissed.bind(this);
    ToastProvider._ensureCSS();
  }

  static _cssPromise = null;

  static _ensureCSS() {
    if (ToastProvider._cssPromise) return;
    ToastProvider._cssPromise = (async () => {
      if (typeof slice === 'undefined' || !slice.controller) return;
      if (slice.controller.requestedStyles?.has?.('Toast')) return;
      try {
        await slice.build('Toast', { message: '' });
        const dummy = document.querySelector('slice-toast');
        if (dummy && dummy.parentNode) dummy.parentNode.removeChild(dummy);
      } catch (err) {
        slice.logger?.logWarn?.('ToastProvider', 'Could not preload Toast CSS', err);
      }
    })();
  }

  async show(message, config = {}) {
    if (!message) return '';

    const id = `toast-${++this._counter}-${Date.now()}`;
    const props = {
      message: String(message),
      type: config.type || 'default',
      duration: config.duration ?? 4000,
      dismissable: config.dismissable ?? true,
      customColor: config.customColor || null
    };

    const toast = await slice.build('Toast', props);
    toast.addEventListener('toast-dismissed', this._handleToastDismissed);

    this._toasts.set(id, toast);
    this._getContainer().appendChild(toast);
    this._enforceMax();

    return id;
  }

  dismiss(id) {
    const toast = this._toasts.get(id);
    if (toast) {
      toast.hide();
      this._toasts.delete(id);
    }
    return this;
  }

  clear() {
    for (const toast of this._toasts.values()) {
      toast.hide();
    }
    this._toasts.clear();
    return this;
  }

  setPosition(position) {
    if (!VALID_POSITIONS.has(position)) return this;
    this._position = position;
    if (this._container) {
      this._container.dataset.position = position;
    }
    return this;
  }

  // Framework teardown hook — the controller calls beforeDestroy() (never
  // destroy()), so the provider's cleanup must live here.
  beforeDestroy() {
    this.clear();
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._container = null;
    this._toasts = null;
  }

  _getContainer() {
    if (!this._container) {
      this._container = document.createElement('div');
      this._container.className = 'toast-provider-container';
      this._container.dataset.position = this._position;
      document.body.appendChild(this._container);
    }
    return this._container;
  }

  _enforceMax() {
    const entries = [...this._toasts.entries()];
    while (entries.length > this._maxToasts) {
      const [id, toast] = entries.shift();
      toast.hide();
      this._toasts.delete(id);
    }
  }

  _handleToastDismissed(event) {
    const toast = event.target;
    for (const [id, t] of this._toasts) {
      if (t === toast) {
        this._toasts.delete(id);
        break;
      }
    }
  }
}

if (typeof window !== 'undefined') {
  window.ToastProvider = ToastProvider;
}
