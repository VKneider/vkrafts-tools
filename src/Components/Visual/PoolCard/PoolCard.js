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
      onQuantityChange: { type: 'function', default: null },
      onContextMenu: { type: 'function', default: null }
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

      this.$thumb.addEventListener('contextmenu', (e) => {
         e.preventDefault();
         if (this._asset) {
            this._onContextMenu?.({ nativeEvent: e, asset: this._asset });
         }
      });

      // Preview en hover: muestra imagen ampliada al pasar el mouse
      this._previewEl = null;
      this._showPreviewTimer = null;
      this.$thumb.addEventListener('mouseenter', () => {
         if (!this._asset?.url) return;
         this._showPreviewTimer = setTimeout(() => this._showPreview(), 400);
      });
      this.$thumb.addEventListener('mouseleave', () => {
         clearTimeout(this._showPreviewTimer);
         this._hidePreview();
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

   _showPreview() {
      if (this._previewEl || !this._asset?.url) return;
      const el = document.createElement('div');
      el.className = 'poolcard-preview';
      el.innerHTML = `<img src="${this._asset.url}" alt="${this._asset.name}" /><span>${this._asset.name}</span>`;
      document.body.appendChild(el);
      this._previewEl = el;

      // Posicionar cerca del thumbnail
      const rect = this.$thumb.getBoundingClientRect();
      el.style.left = `${rect.right + 8}px`;
      el.style.top = `${rect.top}px`;

      // Ajustar si se sale de la pantalla
      requestAnimationFrame(() => {
         const pr = el.getBoundingClientRect();
         if (pr.right > window.innerWidth - 8) {
            el.style.left = `${rect.left - pr.width - 8}px`;
         }
         if (pr.bottom > window.innerHeight - 8) {
            el.style.top = `${window.innerHeight - pr.height - 8}px`;
         }
      });
   }

   _hidePreview() {
      if (this._previewEl) {
         this._previewEl.remove();
         this._previewEl = null;
      }
   }

   beforeDestroy() {
      clearTimeout(this._showPreviewTimer);
      this._hidePreview();
   }

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

   get onContextMenu() { return this._onContextMenu; }
   set onContextMenu(fn) { this._onContextMenu = typeof fn === 'function' ? fn : null; }
}

customElements.define('slice-pool-card', PoolCard);
