import html2canvas from 'html2canvas';

export default class FontCard extends HTMLElement {

   // Color de texto "auto": sigue al tema activo en vez de quedar fijo en negro.
   static DEFAULT_TEXT = '#000000';

   /** Resuelve un color de texto para render: auto → token del tema. */
   static resolveTextColor(textColor) {
      return !textColor || textColor === this.DEFAULT_TEXT
         ? 'var(--font-primary-color)'
         : textColor;
   }

   static props = {
      font: { type: 'object', required: true },
      texto: { type: 'string', default: '' },
      fontSize: { type: 'number', default: 48 },
      styles: { type: 'object', default: null },
      textColor: { type: 'string', default: '#000000' },
      bgColor: { type: 'string', default: 'transparent' },
      isSelected: { type: 'boolean', default: false },
      onSelect: { type: 'function', default: null },
      onShare: { type: 'function', default: null },
      onOpenDetail: { type: 'function', default: null }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);
      this.$root = this.querySelector('.fontcard');
      this.$code = this.querySelector('.fontcard__code');
      this.$flags = this.querySelector('.fontcard__flags');
      this.$preview = this.querySelector('.fontcard__preview');
      this.$text = this.querySelector('.fontcard__text');
      this.$actions = this.querySelector('.fontcard__actions');
      this.$downloads = this.querySelector('.fontcard__downloads');
      this.$shareSlot = this.querySelector('.fontcard__share');

      slice.controller.setComponentProps(this, props);
   }

   async init() {
      // Servicios singletons booteados por Providers (composition root).
      this._toasts = slice.getComponent('ToastProvider');
      this._tips = slice.getComponent('ToolTipProvider');
      this._html = slice.getComponent('HtmlService');
      this._styles = this._styles || this.constructor.defaults();

      const buttons = [
         { label: 'PNG', icon: 'image', tip: 'Descargar PNG en alta resolución (4x)', handler: () => this.downloadPNG() },
         { label: 'SVG', icon: 'file-text', tip: 'Descargar SVG vectorial', handler: () => this.downloadSVG() },
         { label: 'Ambos', icon: 'download', tip: 'Descargar PNG y SVG juntos', handler: () => this.downloadBoth() }
      ];
      for (const b of buttons) {
         const btn = await slice.build('Button', {
            value: b.label,
            icon: { name: b.icon, size: '14' },
            variant: 'outlined',
            size: 'sm',
            onClick: b.handler
         });
         if (btn) {
            btn.setAttribute('data-tooltip', b.tip);
            btn.setAttribute('data-tooltip-placement', 'bottom');
            this.$downloads.appendChild(btn);
         }
      }

      const shareBtn = await slice.build('Button', {
         value: 'Compartir',
         icon: { name: 'share-2', size: '14' },
         variant: 'soft',
         size: 'sm',
         onClick: () => this._onShare?.(this._font)
      });
      if (shareBtn) {
         shareBtn.setAttribute('data-tooltip', 'Copiar link de este diseño');
         shareBtn.setAttribute('data-tooltip-placement', 'bottom');
         this.$shareSlot.appendChild(shareBtn);
      }

      this.$preview.id = `designer-text-${this._font.id}`;
      // El nombre interno no se expone al cliente; el badge abre el detalle.
      this.$code.setAttribute('data-tooltip', 'Ver vista de detalle');
      this.$code.addEventListener('click', () => this._onOpenDetail?.(this._font));
      this.$preview.setAttribute('data-tooltip', 'Usar esta fuente');
      this.$preview.setAttribute('data-tooltip-placement', 'bottom');
      this._tips?.scope(this);
      this.$preview.addEventListener('click', () => this._onSelect?.(this._font));

      this.render();
   }

   beforeDestroy() {
      // Liberar los triggers registrados en el ToolTipProvider singleton.
      if (this._tips) {
         this.querySelectorAll('[data-tooltip]').forEach((el) => this._tips.detach(el));
      }
   }

   static defaults() {
      return {
         bold: false,
         italic: false,
         underline: false,
         align: 'center',
         letterSpacing: 0,
         mirrored: false,
         rotation: 0
      };
   }

   get displayText() {
      return (this._texto || '').trim() || 'Tu texto aquí';
   }

   /** Color concreto para exportar (SVG no entiende var()). */
   _resolvedExportColor() {
      const raw = this._textColor || this.constructor.DEFAULT_TEXT;
      if (raw !== this.constructor.DEFAULT_TEXT) return raw;
      return getComputedStyle(this.$text).color || this.constructor.DEFAULT_TEXT;
   }

   render() {
      const font = this._font || {};
      const styles = this._styles || {};
      const bg = this._bgColor && this._bgColor !== 'transparent';

      // Solo el código (C1, I3…): la familia queda oculta al cliente.
      this.$code.textContent = font.codigo;
      this.$text.textContent = this.displayText;

      Object.assign(this.$text.style, {
         fontFamily: `'${font.fontFamily}', cursive`,
         fontSize: `${this._fontSize}px`,
         fontWeight: styles.bold ? 'bold' : 'normal',
         fontStyle: styles.italic ? 'italic' : 'normal',
         textDecoration: styles.underline ? 'underline' : 'none',
         letterSpacing: `${styles.letterSpacing || 0}px`,
         textAlign: styles.align || 'center',
         color: this.constructor.resolveTextColor(this._textColor),
         transform: [
            styles.mirrored ? 'scaleX(-1)' : '',
            styles.rotation ? `rotate(${styles.rotation}deg)` : ''
         ].filter(Boolean).join(' ') || 'none'
      });

      this.$preview.classList.toggle('fontcard__preview--checker', !bg);
      this.$preview.style.backgroundColor = bg ? this._bgColor : '';

      this.$root.classList.toggle('fontcard--selected', !!this._isSelected);
      this.$flags.replaceChildren();

      if (this._isSelected) {
         const badge = document.createElement('span');
         badge.className = 'fontcard__flag fontcard__flag--selected';
         badge.textContent = 'Seleccionado';
         this.$flags.appendChild(badge);
      }
   }

   /**
    * Escenario de exportación fuera de pantalla: replica la tipografía
    * computada del preview pero SIN checkerboard, borde ni fondo del tema,
    * para que el PNG salga con transparencia real cuando corresponde.
    */
   static buildExportStage(textEl, bgColor = 'transparent') {
      const cs = getComputedStyle(textEl);
      const stage = document.createElement('div');

      Object.assign(stage.style, {
         position: 'fixed',
         left: '-10000px',
         top: '0',
         boxSizing: 'border-box',
         padding: '32px',
         width: `${textEl.clientWidth + 64}px`,
         background: bgColor === 'transparent' ? 'transparent' : bgColor
      });

      const p = document.createElement('p');
      [
         'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
         'letterSpacing', 'textAlign', 'lineHeight'
      ].forEach((k) => {
         if (cs[k]) p.style[k] = cs[k];
      });
      if (cs.transform && cs.transform !== 'none') p.style.transform = cs.transform;
      // Color explícito del elemento; si es "auto", el resuelto del tema.
      p.style.color = textEl.style.color || getComputedStyle(textEl).color;
      p.style.margin = '0';
      p.style.wordBreak = 'break-word';
      p.textContent = textEl.textContent;

      stage.appendChild(p);
      document.body.appendChild(stage);
      return {
         stage,
         cleanup() { stage.remove(); }
      };
   }

   async downloadPNG(scale = 4) {
      const exportStage = this.constructor.buildExportStage(this.$text, this._bgColor);
      try {
         const canvas = await html2canvas(exportStage.stage, {
            backgroundColor: null,
            scale,
            useCORS: true,
            logging: false
         });
         await slice.getComponent('DownloadService')?.canvas(
            canvas,
            `${this._font.codigo}-${this.displayText.slice(0, 20)}.png`,
            'image/png',
            1.0
         );
         return true;
      } catch {
         this._toasts?.show('Error al descargar PNG', { type: 'error' });
         return false;
      } finally {
         exportStage.cleanup();
      }
   }

   downloadSVG() {
      const s = this._styles || {};
      const transform = [
         s.mirrored ? 'scale(-1, 1)' : '',
         s.rotation !== 0 && s.rotation ? `rotate(${s.rotation})` : ''
      ].filter(Boolean).join(' ');

      const anchor = s.align === 'left' ? 'start' : s.align === 'right' ? 'end' : 'middle';

      const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200" viewBox="0 0 800 200">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=${this._font.fontFamily.replace(/ /g, '+')}:wght@400;700&amp;display=swap');
  </style>
  <text
    x="400"
    y="120"
    font-family="'${this._font.fontFamily}', sans-serif"
    font-size="${this._fontSize}"
    font-weight="${s.bold ? 'bold' : 'normal'}"
    font-style="${s.italic ? 'italic' : 'normal'}"
    text-decoration="${s.underline ? 'underline' : 'none'}"
    letter-spacing="${s.letterSpacing || 0}"
    fill="${this._resolvedExportColor()}"
    text-anchor="${anchor}"
    dominant-baseline="middle"
    ${transform ? `transform="${transform}" transform-origin="400 120"` : ''}
   >${this._html?.escape(this.displayText) ?? this.displayText}</text>
</svg>`;

      slice.getComponent('DownloadService')?.text(
         svgContent,
         `${this._font.codigo}-${this.displayText.slice(0, 20)}.svg`,
         'image/svg+xml;charset=utf-8'
      );
      return true;
   }

   async downloadBoth() {
      await this.downloadPNG();
      this.downloadSVG();
      this._toasts?.show(`Descarga completa: ${this._font.codigo} · PNG + SVG`, { type: 'success' });
   }

   // --- props ---

   get font() { return this._font; }
   set font(value) { this._font = value; this.render(); }

   get texto() { return this._texto; }
   set texto(value) { this._texto = value ?? ''; this.render(); }

   get fontSize() { return this._fontSize; }
   set fontSize(value) { this._fontSize = Number(value) || 48; this.render(); }

   get styles() { return this._styles; }
   set styles(value) { this._styles = value || this.constructor.defaults(); this.render(); }

   get textColor() { return this._textColor; }
   set textColor(value) { this._textColor = value || '#000000'; this.render(); }

   get bgColor() { return this._bgColor; }
   set bgColor(value) { this._bgColor = value || 'transparent'; this.render(); }

   get isSelected() { return this._isSelected; }
   set isSelected(value) { this._isSelected = !!value; this.render(); }

   get onShare() { return this._onShare; }
   set onShare(fn) { this._onShare = typeof fn === 'function' ? fn : null; }

   get onOpenDetail() { return this._onOpenDetail; }
   set onOpenDetail(fn) { this._onOpenDetail = typeof fn === 'function' ? fn : null; }
}

customElements.define('slice-font-card', FontCard);
