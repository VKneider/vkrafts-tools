function numAttr(el, name) {
   const v = el.getAttribute(name);
   return v !== null ? Number(v) : undefined;
}

export default class ToolTipProvider {
   constructor() {
      this._registry = new Map();
      this._activeTrigger = null;
      this._bubble = null;
      this._showTimer = null;
      this._hideTimer = null;
      this._removeTimer = null;
      this._visible = false;
      this._id = `tt-provider-${Math.random().toString(36).slice(2, 8)}`;

      this._onShow = this._onShow.bind(this);
      this._onHide = this._onHide.bind(this);
      this._toggle = this._toggle.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
      this._reposition = this._reposition.bind(this);
      this._onOutsidePress = this._onOutsidePress.bind(this);

      ToolTipProvider._ensureCSS();
   }

   static _cssPromise = null;

   static _ensureCSS() {
      if (ToolTipProvider._cssPromise) return;
      ToolTipProvider._cssPromise = (async () => {
         if (typeof slice === 'undefined' || !slice.controller) return;
         if (slice.controller.requestedStyles.has('ToolTip')) return;
         try {
            await slice.build('ToolTip', { text: '' });
         } catch (err) {
            slice.logger?.logWarn?.('ToolTipProvider', 'Could not preload ToolTip CSS', err);
         }
      })();
   }

   attach(element, config = {}) {
      const existing = this._registry.get(element);
      const merged = {
         text: config.text ?? element.getAttribute('data-tooltip') ?? existing?.text ?? '',
         placement: config.placement ?? element.getAttribute('data-tooltip-placement') ?? existing?.placement ?? 'top',
         offset: config.offset ?? numAttr(element, 'data-tooltip-offset') ?? existing?.offset ?? 10,
         maxWidth: config.maxWidth ?? numAttr(element, 'data-tooltip-max-width') ?? existing?.maxWidth ?? 300,
         showDelay: config.showDelay ?? numAttr(element, 'data-tooltip-show-delay') ?? existing?.showDelay ?? 0,
         hideDelay: config.hideDelay ?? numAttr(element, 'data-tooltip-hide-delay') ?? existing?.hideDelay ?? 120,
         customColor: config.customColor ?? existing?.customColor ?? null
      };
      this._registry.set(element, merged);
      this._addTriggerListeners(element);
      element.setAttribute('tabindex', '0');
      return this;
   }

   detach(element) {
      if (!this._registry.has(element)) return this;
      if (this._activeTrigger === element) this._hide();
      this._registry.delete(element);
      this._removeTriggerListeners(element);
      element.removeAttribute('aria-describedby');
      if (this._registry.size === 0) this._removeGlobalListeners();
      return this;
   }

   scope(container) {
      container.querySelectorAll('[data-tooltip]').forEach((el) => this.attach(el));
      return this;
   }

   // Framework teardown hook — the controller calls beforeDestroy() (never
   // destroy()), so the provider's cleanup must live here.
   beforeDestroy() {
      for (const el of [...this._registry.keys()]) this.detach(el);
      this._removeBubble();
      clearTimeout(this._showTimer);
      clearTimeout(this._hideTimer);
      clearTimeout(this._removeTimer);
      this._registry = null;
   }

   _addTriggerListeners(el) {
      el.addEventListener('mouseenter', this._onShow);
      el.addEventListener('mouseleave', this._onHide);
      el.addEventListener('focusin', this._onShow);
      el.addEventListener('focusout', this._onHide);
      el.addEventListener('click', this._toggle);
      el.addEventListener('keydown', this._onKeyDown);
   }

   _removeTriggerListeners(el) {
      el.removeEventListener('mouseenter', this._onShow);
      el.removeEventListener('mouseleave', this._onHide);
      el.removeEventListener('focusin', this._onShow);
      el.removeEventListener('focusout', this._onHide);
      el.removeEventListener('click', this._toggle);
      el.removeEventListener('keydown', this._onKeyDown);
   }

   _onShow(event) {
      const el = event.currentTarget;
      const cfg = this._registry.get(el);
      if (!cfg || !cfg.text) return;
      clearTimeout(this._hideTimer);
      clearTimeout(this._removeTimer);
      this._hideTimer = null;
      this._removeTimer = null;

      if (!cfg.showDelay) { this._show(el); return; }
      clearTimeout(this._showTimer);
      this._showTimer = setTimeout(() => this._show(el), cfg.showDelay);
   }

   _onHide(event) {
      const el = event.currentTarget;
      const cfg = this._registry.get(el);
      if (!cfg) return;
      clearTimeout(this._showTimer);
      this._showTimer = null;
      if (!cfg.hideDelay) { this._hide(); return; }
      clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => this._hide(), cfg.hideDelay);
   }

   _toggle(event) {
      const el = event.currentTarget;
      const cfg = this._registry.get(el);
      if (!cfg || !cfg.text) return;
      if (this._activeTrigger === el && this._visible) this._hide();
      else this._show(el);
   }

   _onKeyDown(event) {
      const cfg = this._registry.get(event.currentTarget);
      if (event.key === 'Escape' && cfg && this._visible) this._hide();
   }

   _show(element) {
      const cfg = this._registry.get(element);
      if (!cfg || !cfg.text) return;
      if (this._visible && this._activeTrigger === element) return;

      clearTimeout(this._hideTimer);
      clearTimeout(this._removeTimer);

      if (this._activeTrigger && this._activeTrigger !== element) {
         this._activeTrigger.removeAttribute('aria-describedby');
      }

      this._activeTrigger = element;
      this._createBubble(cfg);
      this._position(element, cfg);
      element.setAttribute('aria-describedby', this._id);
      this._visible = true;
      this._addGlobalListeners();
      requestAnimationFrame(() => {
         if (this._bubble) this._bubble.classList.add('visible');
      });
   }

   _hide() {
      clearTimeout(this._showTimer);
      clearTimeout(this._hideTimer);
      this._showTimer = null;
      this._hideTimer = null;
      if (!this._bubble) return;
      this._bubble.classList.remove('visible');
      this._visible = false;
      this._removeGlobalListeners();
      clearTimeout(this._removeTimer);
      this._removeTimer = setTimeout(() => this._removeBubble(), 180);
   }

   _createBubble(cfg) {
      if (this._bubble) {
         this._bubble.textContent = cfg.text;
         this._bubble.style.maxWidth = `${cfg.maxWidth}px`;
         this._bubble.dataset.placement = cfg.placement;
         this._applyCustomColor(cfg);
         return;
      }
      this._bubble = document.createElement('div');
      this._bubble.classList.add('slice-tooltip-bubble');
      this._bubble.setAttribute('role', 'tooltip');
      this._bubble.id = this._id;
      this._bubble.textContent = cfg.text;
      this._bubble.style.maxWidth = `${cfg.maxWidth}px`;
      this._bubble.dataset.placement = cfg.placement;
      this._applyCustomColor(cfg);
      document.body.appendChild(this._bubble);
   }

   _removeBubble() {
      if (this._bubble && this._bubble.parentNode) {
         this._bubble.parentNode.removeChild(this._bubble);
      }
      this._bubble = null;
   }

   _applyCustomColor(cfg) {
      if (!this._bubble || !cfg.customColor) return;
      const cc = cfg.customColor;
      if (cc.background) this._bubble.style.setProperty('--tt-bg', cc.background);
      if (cc.text) this._bubble.style.setProperty('--tt-text', cc.text);
   }

   _position(element, cfg) {
      if (!this._bubble) return;
      const trig = element.getBoundingClientRect();
      const bub = this._bubble.getBoundingClientRect();
      let placement = cfg.placement;
      const order = [placement, ...(this._fallbackMap[placement] || ['top', 'bottom', 'right', 'left'])];
      let rect = this._computeRect(placement, trig, bub, cfg.offset);
      for (const p of order) {
         const r = this._computeRect(p, trig, bub, cfg.offset);
         if (r.top >= 8 && r.left >= 8 && r.top + bub.height <= window.innerHeight - 8 && r.left + bub.width <= window.innerWidth - 8) {
            placement = p; rect = r; break;
         }
      }
      const margin = 8;
      this._bubble.style.top = `${Math.min(Math.max(rect.top, margin), window.innerHeight - bub.height - margin)}px`;
      this._bubble.style.left = `${Math.min(Math.max(rect.left, margin), window.innerWidth - bub.width - margin)}px`;
      this._bubble.dataset.placement = placement;
   }

   get _fallbackMap() {
      return {
         top: ['bottom', 'right', 'left'],
         bottom: ['top', 'right', 'left'],
         left: ['right', 'top', 'bottom'],
         right: ['left', 'top', 'bottom']
      };
   }

   _computeRect(placement, trig, bub, offset) {
      switch (placement) {
         case 'bottom': return { top: trig.bottom + offset, left: trig.left + trig.width / 2 - bub.width / 2 };
         case 'left': return { top: trig.top + trig.height / 2 - bub.height / 2, left: trig.left - bub.width - offset };
         case 'right': return { top: trig.top + trig.height / 2 - bub.height / 2, left: trig.right + offset };
         default: return { top: trig.top - bub.height - offset, left: trig.left + trig.width / 2 - bub.width / 2 };
      }
   }

   _reposition() {
      if (!this._bubble || !this._activeTrigger) return;
      const cfg = this._registry.get(this._activeTrigger);
      if (cfg) this._position(this._activeTrigger, cfg);
   }

   _addGlobalListeners() {
      window.addEventListener('resize', this._reposition);
      window.addEventListener('scroll', this._reposition, true);
      document.addEventListener('pointerdown', this._onOutsidePress, true);
   }

   _removeGlobalListeners() {
      window.removeEventListener('resize', this._reposition);
      window.removeEventListener('scroll', this._reposition, true);
      document.removeEventListener('pointerdown', this._onOutsidePress, true);
   }

   _onOutsidePress(event) {
      if (!this._visible || !this._activeTrigger) return;
      if (this._activeTrigger.contains(event.target) || this._bubble?.contains(event.target)) return;
      this._hide();
   }
}

if (typeof window !== 'undefined') {
   window.ToolTipProvider = ToolTipProvider;
}
