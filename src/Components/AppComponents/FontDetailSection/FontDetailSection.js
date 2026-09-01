import html2canvas from 'html2canvas';

const DEFAULT_TEXT = '#000000';

function resolveTextColor(textColor) {
   return !textColor || textColor === DEFAULT_TEXT
      ? 'var(--font-primary-color)'
      : textColor;
}

function buildExportStage(textEl, bgColor = 'transparent') {
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

export default class FontDetailSection extends HTMLElement {

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$notFound = this.querySelector('.fontdetailsection__notfound');
      this.$detail = this.querySelector('.fontdetailsection__detail');
      this.$breadcrumbsSlot = this.querySelector('.fontdetailsection__breadcrumbs');
      this.$backSlot = this.querySelector('.fontdetailsection__back-slot');
      this.$code = this.querySelector('.fontdetailsection__code');
      this.$familyWrap = this.querySelector('.fontdetailsection__family-wrap');
      this.$family = this.querySelector('.fontdetailsection__family');
      this.$familyLock = this.querySelector('.fontdetailsection__family-lock');
      this.$preview = this.querySelector('.fontdetailsection__preview');
      this.$text = this.querySelector('.fontdetailsection__text');
      this.$metaTexto = this.querySelector('.fontdetailsection__meta-texto');
      this.$metaSize = this.querySelector('.fontdetailsection__meta-size');
      this.$metaStyles = this.querySelector('.fontdetailsection__meta-styles');
      this.$actions = this.querySelector('.fontdetailsection__actions');

      slice.controller.setComponentProps(this, props);
   }

   async init() {
      // Servicios singletons booteados por Providers (composition root).
      this._catalog = slice.getComponent('FontsCatalog');
      this._toasts = slice.getComponent('ToastProvider');
      this._html = slice.getComponent('HtmlService');
      this._share = slice.getComponent('ShareService');

      // Breadcrumbs: Designer / Fuente {codigo} — el último tramo se
      // actualiza en cada _render().
      this._crumbs = await slice.build('Breadcrumbs', {
         items: [{ text: 'Designer', path: '/designer' }],
         includeCurrent: true,
         separator: '/'
      });
      if (this._crumbs) this.$breadcrumbsSlot.appendChild(this._crumbs);

      const back = await slice.build('Button', {
         value: 'Volver al Designer',
         icon: { name: 'arrow-left', size: '14' },
         variant: 'outlined',
         size: 'sm',
         onClick: () => slice.router.navigate('/designer')
      });
      if (back) this.$backSlot.appendChild(back);

      const pngBtn = await slice.build('Button', {
         value: 'Descargar PNG (4x)',
         icon: { name: 'image', size: '14' },
         size: 'sm',
         onClick: () => this.downloadPNG()
      });
      const svgBtn = await slice.build('Button', {
         value: 'Descargar SVG',
         icon: { name: 'file-text', size: '14' },
         variant: 'outlined',
         size: 'sm',
         onClick: () => this.downloadSVG()
      });
      const copyBtn = await slice.build('Button', {
         value: 'Copiar link',
         icon: { name: 'share-2', size: '14' },
         variant: 'soft',
         size: 'sm',
         onClick: () => this.copyLink()
      });
      [pngBtn, svgBtn, copyBtn].forEach((b) => b && this.$actions.appendChild(b));

      // Candado del nombre oculto.
      const lockIcon = await slice.build('Icon', { name: 'lock', size: '12', color: 'currentColor' });
      if (lockIcon) this.$familyLock.appendChild(lockIcon);
      this._tips?.scope(this.$familyWrap);

      await this._render();
   }

   beforeDestroy() {
      this._teardownFamilyHold();
      if (this._tips) {
         this.querySelectorAll('[data-tooltip]').forEach((el) => this._tips.detach(el));
      }
   }

   async update() {
      // Revisita cacheada con otro id (/font/c1 → /font/c3): re-render completo.
      await this._render();
   }

   // ---------- nombre oculto (long-press para revelar) ----------

   _lockFamily() {
      this.$familyWrap.classList.remove('is-revealed');
      this.$familyWrap.setAttribute('data-tooltip', 'Mantén presionado para revelar');
      this.$familyWrap.setAttribute('data-tooltip-placement', 'bottom');
   }

   _bindFamilyHold() {
      if (this._familyHoldBound) return;
      this._familyHoldBound = true;

      const HOLD_MS = 900;
      let timer = null;

      const reveal = () => this.$familyWrap.classList.add('is-revealed');
      const conceal = () => {
         clearTimeout(timer);
         timer = null;
         this.$familyWrap.classList.remove('is-revealed');
      };

      this.$familyWrap.addEventListener('pointerdown', () => {
         if (!timer) timer = setTimeout(reveal, HOLD_MS);
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach((evt) => {
         this.$familyWrap.addEventListener(evt, conceal);
      });
      this._teardownFamilyHold = () => {
         clearTimeout(timer);
         timer = null;
         this._familyHoldBound = false;
      };
   }

   _teardownFamilyHold() {}

   _readState() {
      const parsed = this._share.parse();
      const fontId = parsed?.fontId || this.props?.id;
      const font = fontId ? this._catalog.find(fontId) : null;
      return { font, design: parsed?.design || null };
   }

   async _render() {
      const { font, design } = this._readState();

      this.$notFound.hidden = !!font;
      this.$detail.hidden = !font;
      if (!font) return;

      const d = design || {};
      const texto = (d.texto ?? '').trim() || 'Tu texto aquí';

      this._currentFont = font;
      this._currentDesign = d;
      this._currentTexto = texto;

      if (this._crumbs) {
         this._crumbs.items = [
            { text: 'Designer', path: '/designer' },
            { text: `Fuente ${font.codigo}` }
         ];
      }

      this.$code.textContent = font.codigo;

      // Nombre "oculto": presente en el DOM pero difuminado; solo un
      // long-press (~900ms) lo revela mientras se mantiene presionado.
      this.$family.textContent = font.fontFamily;
      this._lockFamily();
      this._bindFamilyHold();

      Object.assign(this.$text.style, {
         fontFamily: `'${font.fontFamily}', cursive`,
         fontSize: `${d.fontSize ?? 48}px`,
         fontWeight: d.bold ? 'bold' : 'normal',
         fontStyle: d.italic ? 'italic' : 'normal',
         textDecoration: d.underline ? 'underline' : 'none',
         letterSpacing: `${d.letterSpacing ?? 0}px`,
         textAlign: d.align ?? 'center',
         color: resolveTextColor(d.textColor),
         transform: [
            d.mirrored ? 'scaleX(-1)' : '',
            d.rotation ? `rotate(${d.rotation}deg)` : ''
         ].filter(Boolean).join(' ') || 'none'
      });
      this.$text.textContent = texto;

      const bg = (d.bgColor && d.bgColor !== 'transparent') || false;
      this.$preview.classList.toggle('fontdetailsection__preview--checker', !bg);
      this.$preview.style.backgroundColor = bg ? d.bgColor : '';

      // El texto compartido llega de un tercero: se escapa antes de inyectarse.
      this.$metaTexto.innerHTML = this._html.escape(texto);
      this.$metaSize.textContent = `${d.fontSize ?? 48}px`;
      this.$metaStyles.replaceChildren();
      const styles = [
         d.bold && 'Negrita',
         d.italic && 'Cursiva',
         d.underline && 'Subrayado',
         (d.align ?? 'center') !== 'center' && `Alineado ${d.align}`,
         (d.letterSpacing ?? 0) !== 0 && `Espaciado ${d.letterSpacing}px`,
         d.mirrored && 'Espejado (HTV)',
         (d.rotation ?? 0) !== 0 && `Rotación ${d.rotation}°`
      ].filter(Boolean);
      (styles.length ? styles : ['Normal']).forEach((label) => {
         const chip = document.createElement('span');
         chip.className = 'fontdetailsection__chip';
         chip.textContent = label;
         this.$metaStyles.appendChild(chip);
      });
   }

   async downloadPNG() {
      const exportStage = buildExportStage(this.$text, (this._currentDesign || {}).bgColor);
      try {
         const canvas = await html2canvas(exportStage.stage, {
            backgroundColor: null,
            scale: 4,
            useCORS: true,
            logging: false
         });
         await slice.getComponent('DownloadService')?.canvas(
            canvas,
            `${this._currentFont.codigo}-${this._currentTexto.slice(0, 20)}.png`,
            'image/png',
            1.0
         );
         this._toasts?.show('PNG descargado en alta resolución (escala 4x)', { type: 'success' });
      } catch {
         this._toasts?.show('Error al descargar PNG', { type: 'error' });
      } finally {
         exportStage.cleanup();
      }
   }

   downloadSVG() {
      const d = this._currentDesign || {};
      const font = this._currentFont;
      const transform = [
         d.mirrored ? 'scale(-1, 1)' : '',
         d.rotation ? `rotate(${d.rotation})` : ''
      ].filter(Boolean).join(' ');
      const anchor = d.align === 'left' ? 'start' : d.align === 'right' ? 'end' : 'middle';
      const rawColor = d.textColor ?? DEFAULT_TEXT;
      const fillColor = rawColor !== DEFAULT_TEXT
         ? rawColor
         : (getComputedStyle(this.$text).color || DEFAULT_TEXT);

      const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200" viewBox="0 0 800 200">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=${font.fontFamily.replace(/ /g, '+')}:wght@400;700&amp;display=swap');
  </style>
  <text
    x="400"
    y="120"
    font-family="'${font.fontFamily}', sans-serif"
    font-size="${d.fontSize ?? 48}"
    font-weight="${d.bold ? 'bold' : 'normal'}"
    font-style="${d.italic ? 'italic' : 'normal'}"
    text-decoration="${d.underline ? 'underline' : 'none'}"
    letter-spacing="${d.letterSpacing ?? 0}"
    fill="${fillColor}"
    text-anchor="${anchor}"
    dominant-baseline="middle"
    ${transform ? `transform="${transform}" transform-origin="400 120"` : ''}
  >${this._html.escape(this._currentTexto)}</text>
</svg>`;

      // Vía DownloadService: el anchor tiene que estar en el documento y la
      // object URL no se puede revocar en la línea siguiente al click.
      slice.getComponent('DownloadService')?.text(
         svgContent,
         `${font.codigo}-${this._currentTexto.slice(0, 20)}.svg`,
         'image/svg+xml;charset=utf-8'
      );
      this._toasts?.show('SVG descargado', { type: 'success' });
   }

   async copyLink() {
      try {
         await navigator.clipboard.writeText(window.location.href);
         this._toasts?.show('Link copiado al portapapeles', { type: 'success' });
      } catch {
         this._toasts?.show('Error al copiar el link', { type: 'error' });
      }
   }
}

customElements.define('slice-font-detail-section', FontDetailSection);
