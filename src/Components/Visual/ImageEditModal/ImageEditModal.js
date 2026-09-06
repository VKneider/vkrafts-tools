// ImageEditModal — Modal de edición básica de imágenes.
// Permite ajustar brillo, contraste y rotar la imagen.
// Devuelve el blob editado via callback.

export default class ImageEditModal extends HTMLElement {

   constructor(props) {
      super();
      slice.attachTemplate(this);
      this._built = false;
      this._buildPromise = null;
      this._onApply = null;
      this._img = null;
      this._imgEl = null;

      // Edit state
      this._brightness = 0;
      this._contrast = 0;
      this._rotation = 0;

      slice.controller.setComponentProps(this, props || {});
   }

   ensure() {
      if (!this._buildPromise) this._buildPromise = this._build();
      return this._buildPromise;
   }

   async _build() {
      const modal = await slice.build('Modal', {
         title: 'Editar imagen',
         width: '440px',
         dismissable: true
      });
      if (!modal) throw new Error('No se pudo construir Modal');

      const body = document.createElement('div');
      body.className = 'iem__body';

      // Preview
      this.$preview = document.createElement('div');
      this.$preview.className = 'iem__preview';
      this.$previewImg = document.createElement('img');
      this.$preview.appendChild(this.$previewImg);
      body.appendChild(this.$preview);

      // Brightness slider
      this.$brightness = this._mkSlider(body, 'Brillo', -100, 100, 0);
      this.$brightness.addEventListener('input', () => {
         this._brightness = Number(this.$brightness.value);
         this._updatePreview();
      });

      // Contrast slider
      this.$contrast = this._mkSlider(body, 'Contraste', -100, 100, 0);
      this.$contrast.addEventListener('input', () => {
         this._contrast = Number(this.$contrast.value);
         this._updatePreview();
      });

      // Rotate buttons
      const rotateRow = document.createElement('div');
      rotateRow.className = 'iem__rotate-row';

      const rotLeft = document.createElement('button');
      rotLeft.type = 'button';
      rotLeft.className = 'iem__rotate-btn';
      rotLeft.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
      rotLeft.addEventListener('click', () => {
         this._rotation = (this._rotation - 90) % 360;
         this._updatePreview();
      });

      const rotLabel = document.createElement('span');
      rotLabel.className = 'iem__rotate-label';
      rotLabel.textContent = '0°';

      const rotRight = document.createElement('button');
      rotRight.type = 'button';
      rotRight.className = 'iem__rotate-btn';
      rotRight.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg>';
      rotRight.addEventListener('click', () => {
         this._rotation = (this._rotation + 90) % 360;
         this._updatePreview();
      });

      this.$rotLabel = rotLabel;
      rotateRow.append(rotLeft, rotLabel, rotRight);
      body.appendChild(rotateRow);

      this._modal = modal;
      modal.appendBody(body);

      // Footer
      const footer = document.createElement('div');
      footer.className = 'iem__footer';

      const cancelBtn = await slice.build('Button', {
         value: 'Cancelar', variant: 'outlined', size: 'sm',
         onClick: () => this.close()
      });
      const resetBtn = await slice.build('Button', {
         value: 'Restablecer', variant: 'ghost', size: 'sm',
         onClick: () => this._reset()
      });
      const applyBtn = await slice.build('Button', {
         value: 'Aplicar', icon: { name: 'check' }, size: 'sm',
         onClick: () => this._apply()
      });
      if (cancelBtn) footer.appendChild(cancelBtn);
      if (resetBtn) footer.appendChild(resetBtn);
      if (applyBtn) footer.appendChild(applyBtn);

      modal.appendFooter(footer);
      this.appendChild(modal);
      this._built = true;
   }

   _mkSlider(parent, label, min, max, value) {
      const row = document.createElement('div');
      row.className = 'iem__slider-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'iem__slider-label';
      labelEl.textContent = label;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(min);
      slider.max = String(max);
      slider.value = String(value);
      slider.className = 'iem__slider';

      const valueEl = document.createElement('span');
      valueEl.className = 'iem__slider-value';
      valueEl.textContent = String(value);

      slider.addEventListener('input', () => {
         valueEl.textContent = slider.value;
      });

      row.append(labelEl, slider, valueEl);
      parent.appendChild(row);
      return slider;
   }

   _getFilterString() {
      const b = 100 + this._brightness;
      const c = 100 + this._contrast;
      return `brightness(${b}%) contrast(${c}%)`;
   }

   _updatePreview() {
      if (!this.$previewImg) return;
      this.$previewImg.style.filter = this._getFilterString();
      this.$previewImg.style.transform = `rotate(${this._rotation}deg)`;
      this.$rotLabel.textContent = `${this._rotation}°`;
   }

   _reset() {
      this._brightness = 0;
      this._contrast = 0;
      this._rotation = 0;
      this.$brightness.value = '0';
      this.$contrast.value = '0';
      this.querySelectorAll('.iem__slider-value').forEach((el) => {
         el.textContent = '0';
      });
      this._updatePreview();
   }

   open(opts = {}) {
      this.ensure().then(() => {
         this._onApply = typeof opts.onApply === 'function' ? opts.onApply : null;
         this._img = opts.img || null;
         this._brightness = 0;
         this._contrast = 0;
         this._rotation = 0;

         if (!this._img?.url) return;

         this.$previewImg.src = this._img.url;
         this.$brightness.value = '0';
         this.$contrast.value = '0';
         this.querySelectorAll('.iem__slider-value').forEach((el) => {
            el.textContent = '0';
         });
         this._updatePreview();

         requestAnimationFrame(() => { this._modal.open = true; });
      });
   }

   async _apply() {
      if (!this._imgEl && !this._img?.url) {
         this._modal?.close();
         return;
      }

      // Load image for canvas processing
      const imgEl = await new Promise((resolve) => {
         const img = new Image();
         img.crossOrigin = 'anonymous';
         img.onload = () => resolve(img);
         img.onerror = () => resolve(null);
         img.src = this._img.url;
      });

      if (!imgEl) {
         this._modal?.close();
         return;
      }

      // Apply rotation: swap dimensions for 90/270
      const isRotated = this._rotation === 90 || this._rotation === -270
         || this._rotation === -90 || this._rotation === 270;
      const outW = isRotated ? imgEl.naturalHeight : imgEl.naturalWidth;
      const outH = isRotated ? imgEl.naturalWidth : imgEl.naturalHeight;

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');

      // Apply filter
      ctx.filter = this._getFilterString();
      ctx.imageSmoothingQuality = 'high';

      // Apply rotation
      ctx.translate(outW / 2, outH / 2);
      ctx.rotate((this._rotation * Math.PI) / 180);
      ctx.drawImage(imgEl, -imgEl.naturalWidth / 2, -imgEl.naturalHeight / 2);

      // Convert to blob
      const blob = await new Promise((resolve) => {
         canvas.toBlob(resolve, 'image/png', 1);
      });

      this._modal?.close();
      this._onApply?.(blob, {
         pxW: canvas.width,
         pxH: canvas.height
      });
   }

   close() {
      this._modal?.close();
   }
}

customElements.define('slice-image-edit-modal', ImageEditModal);
