// PoolCard — Una imagen de la biblioteca de Plantillas.
//
// Antes este markup se construía a mano dentro de LayoutsSection.renderGallery()
// mientras sus estilos vivían en LayoutsPanel.css: ningún componente era dueño
// de la tarjeta. Acá quedan juntos el DOM, los estilos y el comportamiento.
//
// La cantidad ("×N") es cuántas copias de esta imagen deben entrar en la hoja
// al auto-acomodar — el caso "quiero 12 stickers iguales".

const MAX_QUANTITY = 99;

export default class PoolCard extends HTMLElement {

   static props = {
      asset: { type: 'object', default: null },
      pending: { type: 'boolean', default: false },
      used: { type: 'boolean', default: false },
      quantity: { type: 'number', default: 1 },
      onSelect: { type: 'function', default: null },
      onRemove: { type: 'function', default: null },
      onQuantityChange: { type: 'function', default: null }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$root = this.querySelector('.poolcard');
      this.$thumb = this.querySelector('.poolcard__thumb');
      this.$dot = this.querySelector('.poolcard__dot');
      this.$del = this.querySelector('.poolcard__del');
      this.$qtyValue = this.querySelector('.poolcard__qty-value');

      this.$thumb.addEventListener('click', () => {
         this._onSelect?.(this._asset?.id);
      });

      this.$del.addEventListener('click', (e) => {
         e.stopPropagation();
         this._onRemove?.(this._asset?.id);
      });
      // El pool-item es draggable: sin esto, apretar la × arrancaba un arrastre.
      this.$del.addEventListener('pointerdown', (e) => e.stopPropagation());

      this.querySelectorAll('.poolcard__qty-btn').forEach((btn) => {
         btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._step(Number(btn.dataset.step));
         });
         btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      });

      slice.controller.setComponentProps(this, props);
   }

   init() {
      this._tips = slice.getComponent('ToolTipProvider');
      this._applyTooltips();
   }

   beforeDestroy() {
      this._tips?.detach(this.$thumb);
      this._tips?.detach(this.$del);
   }

   /** El nodo por el que se arrastra la tarjeta hacia una celda. */
   get dragHandle() {
      return this.$thumb;
   }

   _step(delta) {
      const next = Math.min(MAX_QUANTITY, Math.max(1, (this._quantity || 1) + delta));
      if (next === this._quantity) return;
      this.quantity = next;
      this._onQuantityChange?.(this._asset?.id, next);
   }

   _applyTooltips() {
      if (!this._tips || !this._asset) return;
      this._tips.detach(this.$thumb);
      this._tips.attach(this.$thumb, {
         text: this._used
            ? `${this._asset.name} · ya está en la hoja`
            : `${this._asset.name} · arrastrá a una celda o hacé click para seleccionar`,
         placement: 'bottom'
      });
   }

   // --- props ---

   get asset() { return this._asset; }
   set asset(value) {
      this._asset = value && value.url ? value : null;
      if (this._asset) {
         this.$thumb.style.backgroundImage = `url("${this._asset.url}")`;
         this.$thumb.setAttribute('aria-label', this._asset.name);
         this.$del.setAttribute('aria-label', `Eliminar ${this._asset.name} de la biblioteca`);
      } else {
         this.$thumb.style.backgroundImage = '';
      }
      this._applyTooltips();
   }

   get pending() { return this._pending; }
   set pending(value) {
      this._pending = !!value;
      this.$thumb.classList.toggle('is-pending', this._pending);
   }

   get used() { return this._used; }
   set used(value) {
      this._used = !!value;
      this.$dot.classList.toggle('is-used', this._used);
      this._applyTooltips();
   }

   get quantity() { return this._quantity; }
   set quantity(value) {
      const n = Number(value);
      this._quantity = Number.isFinite(n) ? Math.min(MAX_QUANTITY, Math.max(1, Math.round(n))) : 1;
      if (this.$qtyValue) this.$qtyValue.textContent = `×${this._quantity}`;
      // Solo se resalta cuando pide más de una copia, para no ensuciar el panel.
      this.$root.classList.toggle('has-copies', this._quantity > 1);
   }

   get onSelect() { return this._onSelect; }
   set onSelect(fn) { this._onSelect = typeof fn === 'function' ? fn : null; }

   get onRemove() { return this._onRemove; }
   set onRemove(fn) { this._onRemove = typeof fn === 'function' ? fn : null; }

   get onQuantityChange() { return this._onQuantityChange; }
   set onQuantityChange(fn) { this._onQuantityChange = typeof fn === 'function' ? fn : null; }
}

customElements.define('slice-pool-card', PoolCard);
