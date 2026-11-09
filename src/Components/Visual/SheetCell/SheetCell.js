const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.05;

export default class SheetCell extends HTMLElement {

   static props = {
      slot: { type: 'number', default: 0 },
      col: { type: 'number', default: 0 },
      row: { type: 'number', default: 0 },
      img: { type: 'object', default: null },
      imageScale: { type: 'number', default: 1 },
      selected: { type: 'boolean', default: false },
      animate: { type: 'boolean', default: false },
      onPick: { type: 'function', default: null },
      onRemove: { type: 'function', default: null },
      onMenu: { type: 'function', default: null },
      onSelect: { type: 'function', default: null },
      onFocus: { type: 'function', default: null },
      onCropChange: { type: 'function', default: null }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$root = this.querySelector('.sheetcell');
      this.$plus = this.querySelector('.sheetcell__plus');
      this.$remove = this.querySelector('.sheetcell__remove');
      this.$zoom = this.querySelector('.sheetcell__zoom');
      this._img = null;
      this._bound = false;
      // Slider de zoom per-celda, construido de forma diferida (solo al
      // seleccionar o pasar el mouse) para no crear decenas de componentes.
      this._zoomSlider = null;
      this._zoomBuilding = null;

      // Zoom/pan state
      this._cropScale = 1;
      this._cropX = 0.5;
      this._cropY = 0.5;
      this._dragging = false;
      this._dragStartX = 0;
      this._dragStartY = 0;
      this._dragStartCropX = 0;
      this._dragStartCropY = 0;

      // Listeners se registran UNA sola vez; _render() solo pinta estado.
      this.$root.addEventListener('click', (e) => {
         if (e.target.closest('.sheetcell__zoom')) return;
         if (this._img) {
            this._onSelect?.(this._slot, e);
         } else {
            this._onPick?.(this._slot);
         }
      });
      this.$root.addEventListener('pointerenter', () => {
         if (this._img) this._ensureZoomSlider();
      });
      this.$root.addEventListener('focus', () => {
         // Solo el foco por teclado selecciona; el click lo maneja onSelect.
         if (this.$root.matches(':focus-visible')) this._onFocus?.(this._slot);
      });
      this.$root.addEventListener('keydown', (e) => {
         if (e.target.closest('.sheetcell__zoom')) return;
         if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.$root.click();
         }
      });
      this.$root.addEventListener('contextmenu', (e) => {
         e.preventDefault();
         const col = this._col ?? 0;
         const row = this._row ?? 0;
         this._onMenu?.({ nativeEvent: e, slot: this._slot, img: this._img, col, row });
      });
      this.$remove.addEventListener('click', (e) => {
         e.stopPropagation();
         this._onRemove?.(this._slot, this._img?.id);
      });
      this.$remove.addEventListener('pointerdown', (e) => e.stopPropagation());

      // Zoom: scroll wheel
      this.$root.addEventListener('wheel', (e) => {
         if (!this._selected || !this._img) return;
         e.preventDefault();
         e.stopPropagation();
         const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
         this._cropScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this._cropScale + delta));
         this._applyCropStyles();
         this._clampCropPosition();
         this._notifyCropChange();
      }, { passive: false });

      // Pan: pointer drag
      this.$root.addEventListener('pointerdown', (e) => {
         if (e.target.closest('.sheetcell__zoom')) return;
         if (!this._selected || !this._img || this._cropScale <= 1) return;
         e.preventDefault();
         this._dragging = true;
         this._dragStartX = e.clientX;
         this._dragStartY = e.clientY;
         this._dragStartCropX = this._cropX;
         this._dragStartCropY = this._cropY;
         this.$root.setPointerCapture(e.pointerId);
      });

      this.$root.addEventListener('pointermove', (e) => {
         if (!this._dragging) return;
         const dx = (e.clientX - this._dragStartX) / this.$root.offsetWidth;
         const dy = (e.clientY - this._dragStartY) / this.$root.offsetHeight;
         const range = (this._cropScale - 1) / (this._cropScale * 2);
         this._cropX = this._clamp(this._dragStartCropX - dx * range * 2, 0, 1);
         this._cropY = this._clamp(this._dragStartCropY - dy * range * 2, 0, 1);
         this._applyCropStyles();
         this._notifyCropChange();
      });

      this.$root.addEventListener('pointerup', () => {
         this._dragging = false;
      });

      // Double-click: reset crop
      this.$root.addEventListener('dblclick', (e) => {
         if (e.target.closest('.sheetcell__zoom')) return;
         if (!this._selected || !this._img) return;
         e.preventDefault();
         e.stopPropagation();
         this._cropScale = 1;
         this._cropX = 0.5;
         this._cropY = 0.5;
         this._applyCropStyles();
         this._notifyCropChange();
      });

      slice.controller.setComponentProps(this, props);
   }

   init() {
      const tips = slice.getComponent('ToolTipProvider');
      this._tips = tips;
      tips?.attach(this.$remove, { text: 'Quitar de la celda', placement: 'bottom' });
      this.paint();
      if (this._selected && this._img) this._ensureZoomSlider();
   }

   beforeDestroy() {
      this._tips?.detach(this.$remove);
      if (this._zoomSlider) {
         slice.controller.destroyComponent(this._zoomSlider);
         this._zoomSlider = null;
      }
   }

   paint() {
      const img = this._img;
      const filled = !!img;

      this.$root.dataset.slot = String(this._slot);
      this.$root.setAttribute(
         'aria-label',
         filled
            ? `Celda ${this._slot + 1}: ${img.name || 'imagen'}`
            : `Celda ${this._slot + 1} vacía`
      );
      this.$root.setAttribute('aria-pressed', this._selected ? 'true' : 'false');
      this.$root.classList.toggle('sheetcell--img', filled);
      this.$root.classList.toggle('sheetcell--empty', !filled);
      this.$root.classList.toggle('is-entering', !!this._animate);
      this.$root.classList.toggle('sheetcell--selected', !!this._selected);

      if (filled) {
         this.$root.style.backgroundImage = `url("${img.url}")`;
         // Restaurar crop del asset
         this._cropScale = img.cropScale || 1;
         this._cropX = img.cropX ?? 0.5;
         this._cropY = img.cropY ?? 0.5;

         if (this._cropScale > 1) {
            this.$root.style.backgroundSize = `${this._cropScale * 100}%`;
            this.$root.style.backgroundPosition = `${this._cropX * 100}% ${this._cropY * 100}%`;
            this.$root.style.backgroundRepeat = 'no-repeat';
         } else {
            const scale = this._imageScale ?? 1;
            if (scale < 1) {
               this.$root.style.backgroundSize = `${scale * 100}%`;
               this.$root.style.backgroundPosition = 'center';
               this.$root.style.backgroundRepeat = 'no-repeat';
            } else {
               this.$root.style.backgroundSize = img.fit === 'contain' ? 'contain' : 'cover';
               this.$root.style.backgroundPosition = '';
               this.$root.style.backgroundRepeat = '';
            }
         }
         this.$remove.hidden = false;
         this.$plus.hidden = true;
      } else {
         this.$root.style.backgroundImage = '';
         this._cropScale = 1;
         this._cropX = 0.5;
         this._cropY = 0.5;
         this.$remove.hidden = true;
         this.$plus.hidden = false;
      }

      this._animate = false;
      this._syncZoomSlider();
   }

   /**
    * Slider de zoom per-celda. Se construye una sola vez y de forma diferida
    * (hover o selección) para no crear un componente por cada celda de la hoja.
    */
   _ensureZoomSlider() {
      if (this._zoomSlider) return this._zoomSlider;
      if (this._zoomBuilding) return this._zoomBuilding;
      if (!this._img || !this.$zoom) return null;

      this._zoomBuilding = (async () => {
         const slider = await slice.build('Slider', {
            min: ZOOM_MIN,
            max: ZOOM_MAX,
            step: ZOOM_STEP,
            value: this._cropScale,
            label: 'Zoom',
            size: 'sm',
            variant: 'plain',
            formatValue: (value) => `${Math.round(value * 100)}%`,
            onInput: (value) => this._setZoomFromSlider(value)
         });

         this._zoomBuilding = null;
         if (!this.isConnected || !this.$zoom) {
            slice.controller.destroyComponent(slider);
            return null;
         }
         this.$zoom.appendChild(slider);
         this._zoomSlider = slider;
         return slider;
      })();

      return this._zoomBuilding;
   }

   _setZoomFromSlider(value) {
      if (!this._img) return;
      const next = this._clamp(Number(value), ZOOM_MIN, ZOOM_MAX);
      if (next === this._cropScale) return;

      this._cropScale = next;
      if (next <= 1) {
         this._cropX = 0.5;
         this._cropY = 0.5;
      }
      this._clampCropPosition();
      this._applyCropStyles();
      this._notifyCropChange();
   }

   _syncZoomSlider() {
      if (this._zoomSlider && this._zoomSlider.value !== this._cropScale) {
         this._zoomSlider.value = this._cropScale;
      }
   }

   _applyCropStyles() {
      if (this._cropScale > 1) {
         this.$root.style.backgroundSize = `${this._cropScale * 100}%`;
         this.$root.style.backgroundPosition = `${this._cropX * 100}% ${this._cropY * 100}%`;
         this.$root.style.backgroundRepeat = 'no-repeat';
      } else {
         const scale = this._imageScale ?? 1;
         if (scale < 1) {
            this.$root.style.backgroundSize = `${scale * 100}%`;
            this.$root.style.backgroundPosition = 'center';
            this.$root.style.backgroundRepeat = 'no-repeat';
         } else {
            this.$root.style.backgroundSize = this._img?.fit === 'contain' ? 'contain' : 'cover';
            this.$root.style.backgroundPosition = '';
            this.$root.style.backgroundRepeat = '';
         }
      }
      this._syncZoomSlider();
   }

   _clampCropPosition() {
      const range = (this._cropScale - 1) / (this._cropScale * 2);
      this._cropX = this._clamp(this._cropX, range, 1 - range);
      this._cropY = this._clamp(this._cropY, range, 1 - range);
   }

   _clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
   }

   _notifyCropChange() {
      if (!this._img) return;
      this._onCropChange?.(this._slot, {
         cropX: this._cropX,
         cropY: this._cropY,
         cropScale: this._cropScale
      });
   }

   // --- props ---

   get slot() { return this._slot; }
   set slot(value) { this._slot = Number(value); }

   get col() { return this._col; }
   set col(value) { this._col = Number(value) || 0; }

   get row() { return this._row; }
   set row(value) { this._row = Number(value) || 0; }

   get img() { return this._img; }
   set img(value) {
      this._img = value && value.url ? value : null;
      this.paint();
   }

   get imageScale() { return this._imageScale; }
   set imageScale(value) {
      this._imageScale = typeof value === 'number' ? value : 1;
      this.paint();
   }

   get selected() { return this._selected; }
   set selected(value) {
      this._selected = !!value;
      this.$root.classList.toggle('sheetcell--selected', this._selected);
      this.$root.setAttribute('aria-pressed', this._selected ? 'true' : 'false');
      if (this._selected && this._img && this.isConnected) this._ensureZoomSlider();
   }

   get animate() { return this._animate; }
   set animate(value) { this._animate = !!value; }

   get onPick() { return this._onPick; }
   set onPick(fn) { this._onPick = typeof fn === 'function' ? fn : null; }

   get onRemove() { return this._onRemove; }
   set onRemove(fn) { this._onRemove = typeof fn === 'function' ? fn : null; }

   get onMenu() { return this._onMenu; }
   set onMenu(fn) { this._onMenu = typeof fn === 'function' ? fn : null; }

   get onSelect() { return this._onSelect; }
   set onSelect(fn) { this._onSelect = typeof fn === 'function' ? fn : null; }

   get onFocus() { return this._onFocus; }
   set onFocus(fn) { this._onFocus = typeof fn === 'function' ? fn : null; }

   get onCropChange() { return this._onCropChange; }
   set onCropChange(fn) { this._onCropChange = typeof fn === 'function' ? fn : null; }

}

customElements.define('slice-sheet-cell', SheetCell);
