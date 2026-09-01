export default class ToolTip extends HTMLElement {
   static props = {
      text: {
         type: 'string',
         default: ''
      },
      placement: {
         type: 'string',
         default: 'top'
      },
      offset: {
         type: 'number',
         default: 10
      },
      maxWidth: {
         type: 'number',
         default: 300
      },
      showDelay: {
         type: 'number',
         default: 0
      },
      hideDelay: {
         type: 'number',
         default: 120
      },
      customColor: {
         type: 'object',
         default: null
      }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$trigger = this.querySelector('.tooltip-trigger');
      this.bubble = null;
      this._text = '';
      this._placement = 'top';
      this._offset = 10;
      this._maxWidth = 300;
      this._showDelay = 0;
      this._hideDelay = 120;
      this._customColor = null;
      this._showTimer = null;
      this._hideTimer = null;
      this._removeTimer = null;
      this._visible = false;
      this._tooltipId = `slice-tooltip-${Math.random().toString(36).slice(2, 10)}`;

      if (!this.hasAttribute('tabindex')) {
         this.setAttribute('tabindex', '0');
      }

      slice.controller.setComponentProps(this, props || {});

      this.queueShow = this.queueShow.bind(this);
      this.queueHide = this.queueHide.bind(this);
      this.toggle = this.toggle.bind(this);
      this.updatePosition = this.updatePosition.bind(this);
      this.handleOutsidePress = this.handleOutsidePress.bind(this);
      this.handleKeyDown = this.handleKeyDown.bind(this);
   }

   set text(value) {
      this._text = typeof value === 'string' ? value : '';
      if (this.bubble) {
         this.bubble.textContent = this._text;
         if (!this._text) this.hide();
         else this.updatePosition();
      }
   }

   get text() {
      return this._text;
   }

   set placement(value) {
      const allowed = new Set(['top', 'bottom', 'left', 'right']);
      this._placement = allowed.has(value) ? value : 'top';
      this.updatePosition();
   }

   set offset(value) {
      this._offset = Number.isFinite(Number(value)) ? Math.max(4, Number(value)) : 10;
      this.updatePosition();
   }

   set maxWidth(value) {
      this._maxWidth = Number.isFinite(Number(value)) ? Math.max(120, Number(value)) : 300;
      if (this.bubble) {
         this.bubble.style.maxWidth = `${this._maxWidth}px`;
         this.updatePosition();
      }
   }

   set showDelay(value) {
      this._showDelay = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
   }

   set hideDelay(value) {
      this._hideDelay = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 120;
   }

   get customColor() {
      return this._customColor;
   }

   set customColor(value) {
      this._customColor = value;
      if (!value) return;
      if (this.bubble) this.applyCustomColor();
   }

   applyCustomColor() {
      if (!this._customColor || !this.bubble) return;
      const cc = this._customColor;
      if (cc.background) this.bubble.style.setProperty('--tt-bg', cc.background);
      if (cc.text) this.bubble.style.setProperty('--tt-text', cc.text);
      // `--tt-accent` no lo lee ninguna regla del CSS: setearlo no hacía nada.
   }

   async init() {
      this.addEventListener('mouseenter', this.queueShow);
      this.addEventListener('mouseleave', this.queueHide);
      this.addEventListener('focusin', this.queueShow);
      this.addEventListener('focusout', this.queueHide);
      this.addEventListener('click', this.toggle);
      this.addEventListener('keydown', this.handleKeyDown);
   }

   toggle() {
      if (this._visible) this.hide();
      else this.show();
   }

   handleKeyDown(event) {
      if (event.key === 'Escape') this.hide();
   }

   disconnectedCallback() {
      this.cleanup();
   }

   beforeDestroy() {
      this.cleanup();
   }

   cleanup() {
      clearTimeout(this._showTimer);
      clearTimeout(this._hideTimer);
      clearTimeout(this._removeTimer);
      this._showTimer = null;
      this._hideTimer = null;
      this._removeTimer = null;
      this.removeGlobalListeners();
      this.removeBubble();
   }

   addGlobalListeners() {
      window.addEventListener('resize', this.updatePosition);
      window.addEventListener('scroll', this.updatePosition, true);
      document.addEventListener('pointerdown', this.handleOutsidePress, true);
   }

   removeGlobalListeners() {
      window.removeEventListener('resize', this.updatePosition);
      window.removeEventListener('scroll', this.updatePosition, true);
      document.removeEventListener('pointerdown', this.handleOutsidePress, true);
   }

   handleOutsidePress(event) {
      if (!this._visible) return;
      const target = event.target;
      if (this.contains(target) || this.bubble?.contains(target)) return;
      this.hide();
   }

   createBubble() {
      if (this.bubble) return;

      this.bubble = document.createElement('div');
      this.bubble.classList.add('slice-tooltip-bubble');
      this.bubble.setAttribute('role', 'tooltip');
      this.bubble.id = this._tooltipId;
      this.bubble.dataset.placement = this._placement;
      this.bubble.textContent = this._text;
      this.bubble.style.maxWidth = `${this._maxWidth}px`;
      this.applyCustomColor();
      document.body.appendChild(this.bubble);
   }

   removeBubble() {
      if (this.bubble && this.bubble.parentNode) {
         this.bubble.parentNode.removeChild(this.bubble);
      }
      this.bubble = null;
   }

   queueShow() {
      clearTimeout(this._hideTimer);
      clearTimeout(this._removeTimer);
      this._hideTimer = null;
      this._removeTimer = null;

      if (!this._showDelay) {
         this.show();
         return;
      }

      clearTimeout(this._showTimer);
      this._showTimer = setTimeout(() => {
         this.show();
      }, this._showDelay);
   }

   queueHide() {
      clearTimeout(this._showTimer);
      this._showTimer = null;

      if (!this._hideDelay) {
         this.hide();
         return;
      }

      clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => {
         this.hide();
      }, this._hideDelay);
   }

   show() {
      if (!this._text) return;

      clearTimeout(this._hideTimer);
      clearTimeout(this._removeTimer);
      this.createBubble();
      this.updatePosition();
      this.setAttribute('aria-describedby', this._tooltipId);
      this._visible = true;
      this.addGlobalListeners();

      requestAnimationFrame(() => {
         if (this.bubble) this.bubble.classList.add('visible');
      });
   }

   hide() {
      clearTimeout(this._showTimer);
      clearTimeout(this._hideTimer);
      this._showTimer = null;
      this._hideTimer = null;

      if (this.bubble) {
         this.bubble.classList.remove('visible');
         this.removeAttribute('aria-describedby');
         this._visible = false;
         this.removeGlobalListeners();
         clearTimeout(this._removeTimer);
         this._removeTimer = setTimeout(() => {
            this.removeBubble();
         }, 180);
      }
   }

   getPlacementOrder() {
      const placement = this._placement;
      const fallbackMap = {
         top: ['bottom', 'right', 'left'],
         bottom: ['top', 'right', 'left'],
         left: ['right', 'top', 'bottom'],
         right: ['left', 'top', 'bottom']
      };
      return [placement, ...(fallbackMap[placement] || ['top', 'bottom', 'right', 'left'])];
   }

   computePlacementRect(placement, triggerRect, bubbleRect) {
      const offset = this._offset;
      if (placement === 'bottom') {
         return {
            top: triggerRect.bottom + offset,
            left: triggerRect.left + (triggerRect.width / 2) - (bubbleRect.width / 2)
         };
      }

      if (placement === 'left') {
         return {
            top: triggerRect.top + (triggerRect.height / 2) - (bubbleRect.height / 2),
            left: triggerRect.left - bubbleRect.width - offset
         };
      }

      if (placement === 'right') {
         return {
            top: triggerRect.top + (triggerRect.height / 2) - (bubbleRect.height / 2),
            left: triggerRect.right + offset
         };
      }

      return {
         top: triggerRect.top - bubbleRect.height - offset,
         left: triggerRect.left + (triggerRect.width / 2) - (bubbleRect.width / 2)
      };
   }

   fitsViewport(rect, bubbleRect) {
      const margin = 8;
      return (
         rect.top >= margin &&
         rect.left >= margin &&
         rect.top + bubbleRect.height <= window.innerHeight - margin &&
         rect.left + bubbleRect.width <= window.innerWidth - margin
      );
   }

   updatePosition() {
      if (!this.bubble) return;

      const triggerRect = this.getBoundingClientRect();
      const bubbleRect = this.bubble.getBoundingClientRect();

      let chosenPlacement = this._placement;
      let rect = this.computePlacementRect(chosenPlacement, triggerRect, bubbleRect);
      for (const placement of this.getPlacementOrder()) {
         const candidate = this.computePlacementRect(placement, triggerRect, bubbleRect);
         if (this.fitsViewport(candidate, bubbleRect)) {
            chosenPlacement = placement;
            rect = candidate;
            break;
         }
      }

      const margin = 8;
      const top = Math.min(Math.max(rect.top, margin), window.innerHeight - bubbleRect.height - margin);
      const left = Math.min(Math.max(rect.left, margin), window.innerWidth - bubbleRect.width - margin);

      this.bubble.style.top = `${top}px`;
      this.bubble.style.left = `${left}px`;
      this.bubble.dataset.placement = chosenPlacement;
   }
}

customElements.define('slice-tooltip', ToolTip);
