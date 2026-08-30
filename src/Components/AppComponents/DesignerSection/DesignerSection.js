const CATEGORY_INFO = {
   corrido: { titulo: 'Corrido', descripcion: 'Letras cursivas y elegantes' },
   imprenta: { titulo: 'Imprenta', descripcion: 'Letras separadas, modernas y clásicas' }
};

export default class DesignerSection extends HTMLElement {

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$toolbarSlot = this.querySelector('.designer__toolbar');
      this.$tabsSlot = this.querySelector('.designer__tabs');
      this.$categoryTitle = this.querySelector('.designer__cat-info h2');
      this.$categoryDesc = this.querySelector('.designer__cat-info p');
      this.$gridSlot = this.querySelector('.designer__gridslot');

      slice.controller.setComponentProps(this, props);
   }

   async init() {
      // Servicios singletons booteados por Providers (composition root).
      this._catalog = slice.getComponent('FontsCatalog');
      this._toasts = slice.getComponent('ToastProvider');
      this._share = slice.getComponent('ShareService');

      // Contexto compartido (creado por Providers): única fuente de verdad.
      this._ctx = slice.context.use('designer');

      this._cards = [];
      this._selectedFontId = null;
      this._builtCategory = null;

      await this._buildToolbar();
      await this._buildTabs();

      // Reacción al contexto: sincroniza cards / categoría.
      this._ctx.bind(this, () => this._onStateChange());

      await this._syncCategory(true);
   }

   update() {
      // Revisita cacheada: re-sincroniza desde el contexto.
      return this._onStateChange();
   }

   beforeDestroy() {
      this._cards.forEach((c) => slice.controller.destroyComponent(c));
      this._cards = [];
   }

   _onStateChange() {
      const state = this._ctx.get();

      if (state.category !== this._builtCategory) {
         return this._syncCategory();
      }
      this._syncCards();
      return null;
   }

   async _buildToolbar() {
      const toolbar = await slice.build('DesignerToolbar', { sliceId: 'designer-toolbar' });
      if (toolbar) this.$toolbarSlot.appendChild(toolbar);
   }

   async _buildTabs() {
      const tabs = await slice.build('Tabs', {
         items: [
            { id: 'corrido', label: 'Corrido' },
            { id: 'imprenta', label: 'Imprenta' }
         ],
         onChange: (id) => this._ctx.patch({ category: id })
      });
      if (tabs) {
         tabs.classList.add('designer__tabs-host');
         this.$tabsSlot.appendChild(tabs);
         this._tabs = tabs;
      }
   }

   async _syncCategory(force = false) {
      const category = this._ctx.get().category || 'corrido';
      if (!force && category === this._builtCategory) return;

      this._builtCategory = category;
      if (this._tabs && this._tabs.activeTab !== category) this._tabs.activeTab = category;

      const info = CATEGORY_INFO[category] || CATEGORY_INFO.corrido;
      this.$categoryTitle.textContent = info.titulo;
      this.$categoryDesc.textContent = info.descripcion;

      this._selectedFontId = null;

      // Destruir tarjetas anteriores a través del framework (sin leaks).
      this._cards.forEach((c) => slice.controller.destroyComponent(c));
      this._cards = [];
      if (this._grid) {
         slice.controller.destroyByContainer(this._grid);
         this._grid = null;
         this.$gridSlot.replaceChildren();
      }

      const state = this._ctx.get();
      const grid = await slice.build('Grid', {
         columnTemplate: 'repeat(auto-fill, minmax(240px, 1fr))',
         gap: '20px'
      });
      if (!grid) return;
      this._grid = grid;

      for (const font of this._catalog.getByCategory(category)) {
         const card = await slice.build('FontCard', {
            font,
            texto: state.texto,
            fontSize: state.fontSize,
            styles: { ...state.styles },
            textColor: state.textColor,
            bgColor: state.bgColor,
            isSelected: false,
            onSelect: (f) => this.selectFont(f),
            onShare: (f) => this.shareFont(f),
            onOpenDetail: (f) => this.openDetail(f)
         });
         if (!card) continue;
         this._cards.push(card);
         await grid.setItem(card);
      }

      this.$gridSlot.appendChild(grid);
   }

   _syncCards() {
      const s = this._ctx.get();
      this._cards.forEach((card) => {
         slice.setComponentProps(card, {
            texto: s.texto,
            fontSize: s.fontSize,
            styles: { ...s.styles },
            textColor: s.textColor,
            bgColor: s.bgColor
         });
      });
   }

   selectFont(font) {
      this._selectedFontId = font.id;
      this._cards.forEach((c) => { c.isSelected = c.font.id === font.id; });
   }

   shareFont(font) {
      const s = this._ctx.get();
      const url = this._share.forFont(font.id, {
         texto: s.texto,
         fontSize: s.fontSize,
         ...s.styles,
         textColor: s.textColor,
         bgColor: s.bgColor
      });
      navigator.clipboard.writeText(url)
         .then(() => this._toasts?.show('Link copiado: listo para compartir', { type: 'success' }))
         .catch(() => slice.router.navigate(url.replace(window.location.origin, '')));
   }

   openDetail(font) {
      // Navega al detalle llevando el diseño actual del contexto en la URL.
      const s = this._ctx.get();
      const url = this._share.forFont(font.id, {
         texto: s.texto,
         fontSize: s.fontSize,
         ...s.styles,
         textColor: s.textColor,
         bgColor: s.bgColor
      });
      slice.router.navigate(url.replace(window.location.origin, ''));
   }
}

customElements.define('slice-designer-section', DesignerSection);
