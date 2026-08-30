const TEXT_PRESETS = [
   ['Negro', '#000000'], ['Blanco', '#FFFFFF'], ['Oro', '#D4AF37'],
   ['Plata', '#C0C0C0'], ['Rosa', '#FF69B4'], ['Rojo', '#DC2626'],
   ['Azul', '#2563EB'], ['Verde', '#16A34A'], ['Morado', '#9333EA'],
   ['Naranja', '#EA580C']
];

const BG_PRESETS = [
   ['Transparente', 'transparent'], ['Blanco', '#FFFFFF'], ['Negro', '#000000'],
   ['Gris claro', '#F3F4F6'], ['Gris oscuro', '#374151'], ['Madera clara', '#DEB887'],
   ['Madera oscura', '#8B4513']
];

const DEFAULT_STYLES = {
   bold: false,
   italic: false,
   underline: false,
   align: 'center',
   letterSpacing: 0,
   mirrored: false,
   rotation: 0
};

export default class DesignerToolbar extends HTMLElement {

   static props = {};

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$inputSlot = this.querySelector('.designertoolbar__input');
      this.$minus = this.querySelector('.designertoolbar__minus');
      this.$plus = this.querySelector('.designertoolbar__plus');
      this.$sizeValue = this.querySelector('.designertoolbar__size-value');
      this.$trigger = this.querySelector('.designertoolbar__color-trigger');
      this.$popover = this.querySelector('.designertoolbar__popover');
      this.$swatchesText = this.querySelector('.designertoolbar__swatches--text');
      this.$swatchesBg = this.querySelector('.designertoolbar__swatches--bg');
      this.$stylesText = this.querySelector('.designertoolbar__styles-text');
      this.$stylesAlign = this.querySelector('.designertoolbar__styles-align');
      this.$stylesTransform = this.querySelector('.designertoolbar__styles-transform');
      this.$spacing = this.querySelector('.designertoolbar__spacing');
      this.$spacingValue = this.querySelector('.designertoolbar__spacing-value');
      this.$reset = this.querySelector('.designertoolbar__reset');

      slice.controller.setComponentProps(this, props);
   }

   async init() {
      // Contexto compartido (creado por Providers). Única fuente de verdad.
      this._ctx = slice.context.use('designer');
      this._tips = slice.getComponent('ToolTipProvider');

      await this._buildControls();
      this._buildSwatches();

      this._ctx.bind(this, () => this._paintFromState());

      // Tooltips del registry para todos los triggers marcados.
      this._tips?.scope(this);

      // Interacción dentro del popover nunca lo cierra.
      this.$popover.addEventListener('click', (e) => e.stopPropagation());

      // Reposicionar mientras está abierto (scroll/resize) y cerrar en Escape.
      window.addEventListener('scroll', this._onReposition = () => {
         if (this._open) this._positionPopover();
      }, { passive: true });
      window.addEventListener('resize', this._onRepositionResize = () => {
         if (this._open) this._positionPopover();
      });

      document.addEventListener('click', this._onDocClick = (e) => {
         if (this._open
            && !this.$popover.contains(e.target)
            && !this.$trigger.contains(e.target)) {
            this._closePopover();
         }
      });
      document.addEventListener('keydown', this._onKey = (e) => {
         if (e.key === 'Escape' && this._open) this._closePopover();
      });
   }

   beforeDestroy() {
      document.removeEventListener('click', this._onDocClick);
      document.removeEventListener('keydown', this._onKey);
      window.removeEventListener('scroll', this._onReposition);
      window.removeEventListener('resize', this._onRepositionResize);
      if (this._tips) {
         this.querySelectorAll('[data-tooltip]').forEach((el) => this._tips.detach(el));
      }
   }

   get _state() { return this._ctx.get(); }

   _patch(partial) {
      this._ctx.patch(partial);
   }

   _patchStyles(mutator) {
      const styles = { ...this._state.styles };
      mutator(styles);
      this._patch({ styles });
   }

   // ---------- construcción ----------

   async _buildControls() {
      const input = await slice.build('Input', { placeholder: 'Escribe tu texto aquí...' });
      if (input) {
         input.addEventListener('input', () => this._patch({ texto: input.value }));
         this._input = input;
         this.$inputSlot.appendChild(input);
      }

      const minus = await slice.build('Button', {
         value: '', icon: { name: 'minus' }, variant: 'ghost', size: 'sm',
         onClick: () => this._patch({ fontSize: Math.max(24, this._state.fontSize - 8) })
      });
      minus?.setAttribute('data-tooltip', 'Reducir tamaño');
      minus?.setAttribute('data-tooltip-placement', 'bottom');
      const plus = await slice.build('Button', {
         value: '', icon: { name: 'plus' }, variant: 'ghost', size: 'sm',
         onClick: () => this._patch({ fontSize: Math.min(120, this._state.fontSize + 8) })
      });
      plus?.setAttribute('data-tooltip', 'Aumentar tamaño');
      plus?.setAttribute('data-tooltip-placement', 'bottom');
      if (minus) this.$minus.appendChild(minus);
      if (plus) this.$plus.appendChild(plus);

      const paletteBtn = await slice.build('Button', {
         value: 'Colores',
         icon: { name: 'palette' },
         variant: 'ghost',
         size: 'sm',
         onClick: () => this._togglePopover()
      });
      if (paletteBtn) this.$trigger.appendChild(paletteBtn);

      // Indicador de los colores activos junto al botón.
      this.$dots = document.createElement('span');
      this.$dots.className = 'designertoolbar__color-dots';
      const dotText = document.createElement('i');
      const dotBg = document.createElement('i');
      dotBg.className = 'designertoolbar__dot-bg';
      this.$dots.append(dotText, dotBg);
      if (paletteBtn) this.$trigger.appendChild(this.$dots);

      const groups = [
         { slot: this.$stylesText, items: [
            { icon: 'bold', title: 'Negrita', key: 'bold' },
            { icon: 'italic', title: 'Cursiva', key: 'italic' },
            { icon: 'underline', title: 'Subrayado', key: 'underline' }
         ] },
         { slot: this.$stylesAlign, items: [
            { icon: 'align-left', title: 'Izquierda', align: 'left' },
            { icon: 'align-center', title: 'Centro', align: 'center' },
            { icon: 'align-right', title: 'Derecha', align: 'right' }
         ] },
         { slot: this.$stylesTransform, items: [
            { icon: 'flip-horizontal-2', title: 'Espejado (HTV)', action: 'mirror' },
            { icon: 'rotate-cw', title: 'Rotar 90°', action: 'rotate' }
         ] }
      ];

      for (const group of groups) {
         for (const cfg of group.items) {
            const btn = await slice.build('Button', {
               value: '', icon: { name: cfg.icon }, variant: 'ghost', size: 'sm',
               onClick: () => this._handleStyle(cfg)
            });
            btn.dataset.tooltip = cfg.title;
            btn.dataset.tooltipPlacement = 'bottom';
            btn.dataset.styleKey = cfg.key || cfg.align || cfg.action;
            group.slot.appendChild(btn);
         }
      }

      this.$spacing.addEventListener('input', () => {
         this._patchStyles((s) => { s.letterSpacing = Number(this.$spacing.value); });
      });
      this.$spacing.setAttribute('data-tooltip', 'Espaciado entre letras: de -5 (pegado) a 30px');
      this.$spacing.setAttribute('data-tooltip-placement', 'bottom');

      const reset = await slice.build('Button', {
         value: 'Reset', variant: 'ghost', size: 'sm',
         onClick: () => this._patch({ styles: { ...DEFAULT_STYLES } })
      });
      if (reset) this.$reset.appendChild(reset);

      this._paintFromState();
   }

   _buildSwatches() {
      TEXT_PRESETS.forEach(([label, value]) =>
         this.$swatchesText.appendChild(this._swatch(label, value)));
      BG_PRESETS.forEach(([label, value]) =>
         this.$swatchesBg.appendChild(this._swatch(label, value)));

      const textCustom = document.createElement('input');
      textCustom.type = 'color';
      textCustom.title = 'Color personalizado';
      textCustom.addEventListener('input', () => this._patch({ textColor: textCustom.value }));

      const bgCustom = document.createElement('input');
      bgCustom.type = 'color';
      bgCustom.title = 'Color personalizado';
      bgCustom.addEventListener('input', () => this._patch({ bgColor: bgCustom.value }));

      this.$swatchesText.appendChild(textCustom);
      this.$swatchesBg.appendChild(bgCustom);
      this._bgCustom = bgCustom;
   }

   _swatch(_label, value) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'designertoolbar__swatch';
      b.dataset.value = value;
      b.addEventListener('click', (e) => {
         e.stopPropagation();
         if (this.$swatchesText.contains(b)) this._patch({ textColor: value });
         else this._patch({ bgColor: value });
      });
      return b;
   }

   // ---------- popover ----------

   _togglePopover() {
      this._open ? this._closePopover() : this._openPopover();
   }

   _openPopover() {
      this._open = true;
      this.$popover.classList.add('designertoolbar__popover--open');
      this._positionPopover();
   }

   _closePopover() {
      this._open = false;
      this.$popover.classList.remove('designertoolbar__popover--open');
   }

   /**
    * Posiciona el popover con coordenadas fijas de viewport, anclado al
    * trigger. Evita el recorte/desplazamiento por ancestros con overflow
    * (gotcha §28) y hace flip vertical si no hay espacio debajo.
    */
   _positionPopover() {
      const pop = this.$popover;
      if (!pop) return;

      // Medir con el popover ya visible pero fuera del flujo visual.
      const prevVisibility = pop.style.visibility;
      pop.style.visibility = 'hidden';

      const rect = this.$trigger.getBoundingClientRect();
      const pw = pop.offsetWidth || pop.getBoundingClientRect().width;
      const ph = pop.offsetHeight || pop.getBoundingClientRect().height;

      const left = Math.max(12, Math.min(rect.left, window.innerWidth - pw - 12));
      let top = rect.bottom + 8;
      if (top + ph > window.innerHeight - 12) {
         top = Math.max(12, rect.top - ph - 8);
      }

      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
      pop.style.visibility = prevVisibility === 'hidden' ? '' : prevVisibility;
   }

   _onPopoverClick(e) {
      e.stopPropagation();
   }

   // ---------- estilos ----------

   _handleStyle({ key, align, action }) {
      this._patchStyles((s) => {
         if (key) s[key] = !s[key];
         if (align) s.align = align;
         if (action === 'mirror') s.mirrored = !s.mirrored;
         if (action === 'rotate') {
            s.rotation = s.rotation === 0 ? 90 : s.rotation === 90 ? 180 : s.rotation === 180 ? 270 : 0;
         }
      });
   }

   // ---------- repintado desde el contexto ----------

   _paintFromState() {
      const state = this._state;
      const styles = state.styles || DEFAULT_STYLES;

      this.$sizeValue.textContent = String(state.fontSize);
      this.$spacing.value = String(styles.letterSpacing ?? 0);
      this.$spacingValue.textContent = `${styles.letterSpacing ?? 0}px`;
      if (this._input && this._input.value !== state.texto) this._input.value = state.texto;
      if (this._bgCustom) {
         this._bgCustom.value = state.bgColor === 'transparent' ? '#ffffff' : state.bgColor;
      }

      // Swatches
      const paint = (container, current) => {
         container.querySelectorAll('.designertoolbar__swatch').forEach((b) => {
            const v = b.dataset.value;
            b.classList.toggle('designertoolbar__swatch--active', v === current);
            b.style.background = v === 'transparent'
               ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px'
               : v;
         });
      };
      paint(this.$swatchesText, state.textColor);
      paint(this.$swatchesBg, state.bgColor);

      // Dots indicadores junto al botón Colores
      if (this.$dots) {
         const [dotText, dotBg] = this.$dots.querySelectorAll('i');
         dotText.style.background = state.textColor === 'transparent' ? '#fff' : state.textColor;
         dotBg.style.background = state.bgColor === 'transparent'
            ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 6px 6px'
            : state.bgColor;
      }

      // Toggle buttons
      this.querySelectorAll('[data-style-key]').forEach((btn) => {
         const key = btn.dataset.styleKey;
         let active = !!styles[key];
         if (key === 'center') active = styles.align === 'center';
         if (key === 'left') active = styles.align === 'left';
         if (key === 'right') active = styles.align === 'right';
         if (key === 'rotate') active = (styles.rotation ?? 0) !== 0;
         btn.classList.toggle('designertoolbar__toggle--on', active);
      });

      // Reset visible solo con estilos activos
      const hasActive = styles.bold || styles.italic || styles.underline
         || styles.align !== 'center' || (styles.letterSpacing ?? 0) !== 0
         || styles.mirrored || (styles.rotation ?? 0) !== 0;
      this.$reset.hidden = !hasActive;
   }
}

customElements.define('slice-designer-toolbar', DesignerToolbar);
