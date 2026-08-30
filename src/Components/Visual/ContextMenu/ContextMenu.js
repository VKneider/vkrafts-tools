// Menú contextual visual (singleton por sliceId). Un único elemento flotante
// que se activa con los datos del target cliqueado:
//   const menu = slice.getComponent('app-context-menu');
//   menu.open({ x: e.clientX, y: e.clientY, items: [
//      { label: 'Editar', icon: 'pen-tool', action: () => {} },
//      { type: 'separator' },
//      { label: 'Quitar', danger: true, action: () => {} }
//   ]});
export default class ContextMenu extends HTMLElement {

   constructor(props) {
      super();
      slice.attachTemplate(this);
      this.$root = this.querySelector('.contextmenu');
      this._buttons = [];
      this._idx = -1;
      this._open = false;

      slice.controller.setComponentProps(this, props);
   }

   init() {
      document.addEventListener('click', this._onDocClick = (e) => {
         if (!this.$root.contains(e.target)) this.close();
      });
      document.addEventListener('keydown', this._onKey = (e) => this._handleKey(e));
      window.addEventListener('resize', this._onReposition = () => this.isOpen && this._clamp());
      window.addEventListener('scroll', this._onReposition, true);
   }

   beforeDestroy() {
      document.removeEventListener('click', this._onDocClick);
      document.removeEventListener('keydown', this._onKey);
      window.removeEventListener('resize', this._onReposition);
      window.removeEventListener('scroll', this._onReposition, true);
   }

   get isOpen() { return this._open; }

   /** Abre el menú en x/y con la lista de items derivada del target. */
   async open({ x, y, items = [] }) {
      await this._renderItems(items);

      this.$root.hidden = false;
      // Medir antes de fijar posición final clampeada al viewport.
      this.$root.style.left = '0px';
      this.$root.style.top = '0px';
      const mw = this.$root.offsetWidth;
      const mh = this.$root.offsetHeight;
      this.$root.style.left = `${Math.max(8, Math.min(x, window.innerWidth - mw - 8))}px`;
      this.$root.style.top = `${Math.max(8, Math.min(y, window.innerHeight - mh - 8))}px`;

      this._open = true;
      this._idx = -1;
   }

   close() {
      if (!this._open) return;
      this._open = false;
      this.$root.hidden = true;
   }

   _clamp() {
      if (!this._open) return;
      const mw = this.$root.offsetWidth;
      const mh = this.$root.offsetHeight;
      const left = parseFloat(this.$root.style.left) || 0;
      const top = parseFloat(this.$root.style.top) || 0;
      this.$root.style.left = `${Math.max(8, Math.min(left, window.innerWidth - mw - 8))}px`;
      this.$root.style.top = `${Math.max(8, Math.min(top, window.innerHeight - mh - 8))}px`;
   }

   async _renderItems(items) {
      this.$root.replaceChildren();
      this._buttons = [];

      for (const item of items) {
         if (item.type === 'separator') {
            const sep = document.createElement('div');
            sep.className = 'contextmenu__sep';
            this.$root.appendChild(sep);
            continue;
         }

         const btn = document.createElement('button');
         btn.type = 'button';
         btn.className =
            'contextmenu__item' + (item.danger ? ' contextmenu__item--danger' : '');
         btn.setAttribute('role', 'menuitem');

         if (item.icon) {
            const icon = await slice.build('Icon', { name: item.icon, size: '14' });
            if (icon) btn.appendChild(icon);
         }

         const label = document.createElement('span');
         label.textContent = item.label;
         btn.appendChild(label);

         btn.addEventListener('click', () => {
            this.close();
            item.action?.();
         });

         this.$root.appendChild(btn);
         this._buttons.push(btn);
      }
   }

   _handleKey(e) {
      if (!this._open) return;
      if (e.key === 'Escape') { this.close(); return; }
      if (!this._buttons.length) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
         e.preventDefault();
         const dir = e.key === 'ArrowDown' ? 1 : -1;
         this._idx = (this._idx + dir + this._buttons.length) % this._buttons.length;
         this._buttons.forEach((b, i) => b.classList.toggle('is-focused', i === this._idx));
      } else if (e.key === 'Enter' && this._idx >= 0) {
         e.preventDefault();
         this._buttons[this._idx].click();
      }
   }
}

customElements.define('slice-context-menu', ContextMenu);
