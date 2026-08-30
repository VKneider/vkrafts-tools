export default class Modal extends HTMLElement {
  static props = {
    open: { type: 'boolean', default: false },
    title: { type: 'string', default: '' },
    dismissable: { type: 'boolean', default: true },
    width: { type: 'string', default: '' },
    maxWidth: { type: 'string', default: '' },
    draggable: { type: 'boolean', default: false },
    resizable: { type: 'boolean', default: false },
    customColor: { type: 'object', default: null },
    onClose: { type: 'function', default: null }
  };

  constructor(props) {
    super();
    slice.attachTemplate(this);

    this.$dialog = this.querySelector('.slice-modal');
    this.$title = this.querySelector('.slice-modal__title');
    this.$body = this.querySelector('.slice-modal__body');
    this.$footer = this.querySelector('.slice-modal__footer');
    this.$close = this.querySelector('.slice-modal__close');

    this._open = false;
    this._title = '';
    this._dismissable = true;
    this._customColor = null;
    this._onClose = null;
    this._scrollLocked = false;
    this._draggable = false;
    this._resizable = false;
    this._dnd = null;
    this._inited = false;

    slice.controller.setComponentProps(this, props || {});

    this._pressedOnBackdrop = false;

    this._handleClose = this._handleClose.bind(this);
    this._handleKeyDown = this._handleKeyDown.bind(this);
    this._handleDialogClose = this._handleDialogClose.bind(this);
    this._handleBackdropClick = this._handleBackdropClick.bind(this);
    this._handleDialogPointerDown = this._handleDialogPointerDown.bind(this);
  }

  static _openCount = 0;
  static _scrollY = null;

  set open(value) {
    const next = value === true;
    // During construction the host is not connected yet and showModal() would
    // throw; just record the state and let init() apply it. Once mounted, the
    // prop drives the dialog so `modal.open = true/false` actually works.
    if (!this.$dialog || !this.isConnected) {
      this._open = next;
      return;
    }
    if (next) {
      this.showModal();
    } else {
      this.close();
    }
  }

  get open() { return this._open; }

  set title(value) {
    this._title = typeof value === 'string' ? value : '';
    if (this.$title) this.$title.textContent = this._title;
  }

  get title() { return this._title; }

  set dismissable(value) {
    this._dismissable = value !== false;
    if (this.$close) {
      this.$close.style.display = this._dismissable ? '' : 'none';
    }
  }

  get dismissable() { return this._dismissable; }

  set width(value) {
    if (value && this.$dialog) {
      this.$dialog.style.setProperty('--modal-width', value);
    }
  }

  set maxWidth(value) {
    if (value && this.$dialog) {
      this.$dialog.style.setProperty('--modal-max-width', value);
    }
  }

  set draggable(value) {
    this._draggable = value === true;
    this.classList.toggle('is-draggable', this._draggable);
    this._syncDnD();
  }

  get draggable() { return this._draggable; }

  set resizable(value) {
    this._resizable = value === true;
    this.classList.toggle('is-resizable', this._resizable);
    this._syncDnD();
  }

  get resizable() { return this._resizable; }

  set customColor(value) {
    this._customColor = value || null;
    if (!this._customColor || !this.$dialog) return;
    if (this._customColor.background) this.$dialog.style.setProperty('--modal-bg', this._customColor.background);
    if (this._customColor.text) this.$dialog.style.setProperty('--modal-text', this._customColor.text);
    if (this._customColor.accent) this.$dialog.style.setProperty('--modal-accent', this._customColor.accent);
  }

  get customColor() { return this._customColor; }

  set onClose(value) {
    this._onClose = typeof value === 'function' ? value : null;
  }

  get onClose() { return this._onClose; }

   showModal() {
      this._open = true;
      this.removeAttribute('open');
      // showModal() throws InvalidStateError if the dialog is already open.
      // Lock scroll BEFORE showModal() so Chrome cannot scroll the page
      // when auto-focusing the dialog ("scroll the dialog into view" step).
      if (this.$dialog && !this.$dialog.open) {
        this._lockScroll();
        if (this._dndEnabled()) this._resetDnDLayout();
        this.$dialog.showModal();
        if (this._dndEnabled()) this._pinForDnD();
      }
    }

  close(result) {
    this._open = false;
    if (result !== undefined) {
      this.$dialog.close(result);
    } else {
      this.$dialog.close();
    }
    this._restoreScroll();
  }

  _lockScroll() {
    // Guard per-instance so the same modal can never increment the shared
    // counter twice (e.g. showModal() + a stray init path).
    if (this._scrollLocked) return;
    this._scrollLocked = true;
    Modal._openCount++;
    if (Modal._openCount === 1) {
      // Patrón position:fixed en vez de overflow:hidden para evitar que
      // Chrome propague overflow al viewport y reseteé scrollY a 0.
      Modal._scrollY = window.scrollY;
      Modal._originalBodyPosition = document.body.style.position;
      Modal._originalBodyTop = document.body.style.top;
      Modal._originalBodyWidth = document.body.style.width;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${Modal._scrollY}px`;
      document.body.style.width = '100%';
    }
  }

  _restoreScroll() {
    // Idempotent: only the instance that actually locked may release, so it is
    // safe to call this from every close path (close(), the native 'close'
    // event, disconnect and destroy) without double-decrementing the counter.
    if (!this._scrollLocked) return;
    this._scrollLocked = false;
    Modal._openCount = Math.max(0, Modal._openCount - 1);
    if (Modal._openCount === 0) {
      const scrollY = Modal._scrollY;
      document.body.style.position = Modal._originalBodyPosition || '';
      document.body.style.top = Modal._originalBodyTop || '';
      document.body.style.width = Modal._originalBodyWidth || '';
      Modal._originalBodyPosition = null;
      Modal._originalBodyTop = null;
      Modal._originalBodyWidth = null;
      Modal._scrollY = null;
      if (scrollY !== null) {
        window.scrollTo(0, scrollY);
      }
    }
  }

  appendBody(node) {
    if (node && this.$body) this.$body.appendChild(node);
  }

  appendFooter(node) {
    if (node && this.$footer) this.$footer.appendChild(node);
  }

  async init() {
    if (this.$close) {
      this.$close.addEventListener('click', this._handleClose);
    }
    this.$dialog.addEventListener('keydown', this._handleKeyDown);
    this.$dialog.addEventListener('close', this._handleDialogClose);
    this.$dialog.addEventListener('click', this._handleBackdropClick);
    this.$dialog.addEventListener('pointerdown', this._handleDialogPointerDown);

    this._inited = true;
    if (this._dndEnabled()) {
      this._dnd = await slice.build('DragDropService', { singleton: true });
      this._applyDnD();
    }

    if (this._open) {
      requestAnimationFrame(() => {
        if (this.isConnected && this._open) {
          this.showModal();
        }
      });
    }
  }

  // ── Drag & resize (DragDropService integration) ───────────────

  _dndEnabled() {
    return this._draggable || this._resizable;
  }

  // (Re)wire the dialog with the DnD service from the current flags. Idempotent:
  // detach first so toggling never stacks duplicate resize-handle containers.
  _applyDnD() {
    if (!this._dnd || !this.$dialog) return;
    this._dnd.detach(this.$dialog);
    // A resizable modal must not be capped by the default max-width/height,
    // otherwise resizing wider/taller has no visible effect.
    this.$dialog.style.maxWidth = this._resizable ? 'none' : '';
    this.$dialog.style.maxHeight = this._resizable ? 'none' : '';
    if (this._draggable) {
      this._dnd.makeDraggable(this.$dialog, {
        handle: '.slice-modal__header',
        ghost: false,
        freePosition: true,
        threshold: 4,        // a click on the header (e.g. the close button) must not start a drag
        autoScroll: false,   // the background scroll is locked while a modal is open
      });
    }
    if (this._resizable) {
      this._dnd.makeResizable(this.$dialog, {
        handles: ['se', 'sw', 'ne', 'nw', 'e', 'w', 's', 'n'],
        minWidth: 280,
        minHeight: 140,
      });
    }
  }

  // From the draggable/resizable setters: build the service on demand when a
  // flag is enabled after init(); detach when both are turned off.
  _syncDnD() {
    if (!this._inited) return;   // init() wires from the stored flags
    if (this._dndEnabled()) {
      if (this._dnd) {
        this._applyDnD();
      } else {
        slice.build('DragDropService', { singleton: true }).then((s) => {
          this._dnd = s;
          this._applyDnD();
        });
      }
    } else if (this._dnd) {
      this._dnd.detach(this.$dialog);
    }
  }

  // A modal opened with showModal() is UA-centered via margin:auto. Drag/resize
  // need real viewport coordinates, so pin it to fixed + explicit centered
  // left/top once shown. offsetWidth/Height ignore the enter animation's
  // transform, so the measurement is stable.
  _pinForDnD() {
    const d = this.$dialog;
    const w = d.offsetWidth;
    const h = d.offsetHeight;
    d.style.position = 'fixed';
    d.style.margin = '0';
    d.style.left = Math.max(8, (window.innerWidth - w) / 2) + 'px';
    d.style.top = Math.max(8, (window.innerHeight - h) / 2) + 'px';
  }

  // Clear drag/resize inline styles so each open starts from the default
  // centered size (we re-pin immediately after).
  _resetDnDLayout() {
    const s = this.$dialog.style;
    s.position = '';
    s.left = '';
    s.top = '';
    s.right = '';
    s.bottom = '';
    s.margin = '';
    s.width = '';
    s.height = '';
    s.transform = '';
  }

  _handleClose() {
    this.close();
  }

  _handleKeyDown(event) {
    if (event.key === 'Escape' && !this._dismissable) {
      event.preventDefault();
    }
  }

  _handleDialogClose() {
    this._open = false;
    // The native <dialog> fires 'close' on EVERY close path (Escape key, the
    // close() method, backdrop). Restoring scroll here is the single source of
    // truth so Escape-to-close cannot leave the background scroll-locked.
    this._restoreScroll();
    if (typeof this._onClose === 'function') {
      this._onClose({ returnValue: this.$dialog.returnValue });
    }
  }

  _handleDialogPointerDown(event) {
    // Only a press that STARTS on the backdrop (the dialog element itself, not
    // its content) counts as an outside-click. This prevents a drag/resize that
    // ends on the backdrop — or a text selection released outside — from
    // closing the modal.
    this._pressedOnBackdrop = event.target === this.$dialog;
  }

  _handleBackdropClick(event) {
    if (event.target === this.$dialog && this._dismissable && this._pressedOnBackdrop) {
      this.close();
    }
  }

  _removeListeners() {
    if (this.$close) this.$close.removeEventListener('click', this._handleClose);
    this.$dialog.removeEventListener('keydown', this._handleKeyDown);
    this.$dialog.removeEventListener('close', this._handleDialogClose);
    this.$dialog.removeEventListener('click', this._handleBackdropClick);
    this.$dialog.removeEventListener('pointerdown', this._handleDialogPointerDown);
  }

  disconnectedCallback() {
    // Listeners are added once in init() and are NOT re-added on reconnect, so
    // tearing them down here would break a detach/reattach cycle (e.g. the
    // router caches instances via innerHTML='' + appendChild without re-running
    // init()). Listener cleanup lives in beforeDestroy() — the real Slice
    // destroy hook. Here we only release the scroll lock as a safety net for
    // teardown via innerHTML='' that never reaches beforeDestroy().
    this._restoreScroll();
  }

  beforeDestroy() {
    if (this._open) {
      this.$dialog.close();
      this._restoreScroll();
    }
    if (this._dnd) this._dnd.detach(this.$dialog);
    this._removeListeners();
  }
}

customElements.define('slice-modal', Modal);
