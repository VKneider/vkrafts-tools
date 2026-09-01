export default class SheetCell extends HTMLElement {

   static props = {
      slot: { type: 'number', default: 0 },
      col: { type: 'number', default: 0 },
      row: { type: 'number', default: 0 },
      img: { type: 'object', default: null },
      imageScale: { type: 'number', default: 1 },
      animate: { type: 'boolean', default: false },
      onPick: { type: 'function', default: null },
      onRemove: { type: 'function', default: null },
      onMenu: { type: 'function', default: null }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$root = this.querySelector('.sheetcell');
      this.$plus = this.querySelector('.sheetcell__plus');
      this.$remove = this.querySelector('.sheetcell__remove');
      this._img = null;
      this._bound = false;

      // Listeners se registran UNA sola vez; _render() solo pinta estado.
      this.$root.addEventListener('click', () => {
         if (!this._img) this._onPick?.(this._slot);
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

      slice.controller.setComponentProps(this, props);
   }

   init() {
      const tips = slice.getComponent('ToolTipProvider');
      this._tips = tips;
      tips?.attach(this.$remove, { text: 'Quitar de la celda', placement: 'bottom' });
      this.paint();
   }

   beforeDestroy() {
      this._tips?.detach(this.$remove);
   }

   // Acá vivían las tiras de borde: un <div> invisible por celda que, al
   // arrastrarlo, redimensionaba la columna o la fila. Se fueron porque
   // LayoutsSection ya dibuja splitters sobre los mismos huecos llamando al
   // mismo handler, con mayor z-index: de cada par de tiras, una quedaba
   // enterrada bajo el splitter y la otra duplicaba su función. El resize vive
   // ahora en un solo lugar.

   paint() {
      const img = this._img;
      const filled = !!img;

      this.$root.dataset.slot = String(this._slot);
      this.$root.classList.toggle('sheetcell--img', filled);
      this.$root.classList.toggle('sheetcell--empty', !filled);
      this.$root.classList.toggle('is-entering', !!this._animate);

      if (filled) {
         this.$root.style.backgroundImage = `url("${img.url}")`;
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
         this.$remove.hidden = false;
         this.$plus.hidden = true;
      } else {
         this.$root.style.backgroundImage = '';
         this.$remove.hidden = true;
         this.$plus.hidden = false;
      }

      this._animate = false;
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

   get animate() { return this._animate; }
   set animate(value) { this._animate = !!value; }

   get onPick() { return this._onPick; }
   set onPick(fn) { this._onPick = typeof fn === 'function' ? fn : null; }

   get onRemove() { return this._onRemove; }
   set onRemove(fn) { this._onRemove = typeof fn === 'function' ? fn : null; }

   get onMenu() { return this._onMenu; }
   set onMenu(fn) { this._onMenu = typeof fn === 'function' ? fn : null; }

}

customElements.define('slice-sheet-cell', SheetCell);
