// ImageCropModal — Modal de recorte de imágenes.
// Permite recortar una imagen con un rectángulo de recorte arrastrable y
// redimensionable. Devuelve el blob recortado via callback.

const ASPECT_PRESETS = [
   { label: 'Libre', value: null },
   { label: '1:1', value: 1 },
   { label: '4:3', value: 4 / 3 },
   { label: '3:4', value: 3 / 4 },
   { label: '16:9', value: 16 / 9 },
   { label: '9:16', value: 9 / 16 }
];

export default class ImageCropModal extends HTMLElement {

   constructor(props) {
      super();
      slice.attachTemplate(this);
      this._built = false;
      this._buildPromise = null;
      this._onApply = null;
      this._img = null;
      this._imgEl = null;

      // Crop state
      this._crop = { x: 0, y: 0, w: 0, h: 0 };
      this._aspect = null;
      this._dragging = null;
      this._dragStart = { x: 0, y: 0, crop: null };

      slice.controller.setComponentProps(this, props || {});
   }

   ensure() {
      if (!this._buildPromise) this._buildPromise = this._build();
      return this._buildPromise;
   }

   async _build() {
      const modal = await slice.build('Modal', {
         title: 'Recortar imagen',
         width: '520px',
         dismissable: true
      });
      if (!modal) throw new Error('No se pudo construir Modal');

      // Body
      const body = document.createElement('div');
      body.className = 'icm__body';

      // Canvas container
      this.$canvasWrap = document.createElement('div');
      this.$canvasWrap.className = 'icm__canvas-wrap';
      this.$canvas = document.createElement('canvas');
      this.$canvas.className = 'icm__canvas';
      this.$canvasWrap.appendChild(this.$canvas);
      this.$ctx = this.$canvas.getContext('2d');

      // Crop overlay
      this.$overlay = document.createElement('div');
      this.$overlay.className = 'icm__overlay';
      this.$canvasWrap.appendChild(this.$overlay);

      // Crop handles (8 handles: corners + midpoints)
      this._handles = [];
      const positions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      for (const pos of positions) {
         const h = document.createElement('div');
         h.className = `icm__handle icm__handle--${pos}`;
         h.dataset.handle = pos;
         this.$overlay.appendChild(h);
         this._handles.push(h);
      }

      body.appendChild(this.$canvasWrap);

      // Aspect ratio selector
      const aspectRow = document.createElement('div');
      aspectRow.className = 'icm__aspect-row';
      for (const preset of ASPECT_PRESETS) {
         const btn = document.createElement('button');
         btn.type = 'button';
         btn.className = 'icm__aspect-btn';
         btn.textContent = preset.label;
         btn.dataset.aspect = preset.value ?? '';
         btn.addEventListener('click', () => this._setAspect(preset.value));
         aspectRow.appendChild(btn);
      }
      body.appendChild(aspectRow);

      this._modal = modal;
      modal.appendBody(body);

      // Footer
      const footer = document.createElement('div');
      footer.className = 'icm__footer';

      const cancel = await slice.build('Button', {
         value: 'Cancelar', variant: 'outlined', size: 'sm',
         onClick: () => this.close()
      });
      const apply = await slice.build('Button', {
         value: 'Recortar', icon: { name: 'check' }, size: 'sm',
         onClick: () => this._apply()
      });
      if (cancel) footer.appendChild(cancel);
      if (apply) footer.appendChild(apply);

      modal.appendFooter(footer);
      this.appendChild(modal);
      this._built = true;

      // Event listeners for crop interaction
      this._bindCropEvents();
   }

   _bindCropEvents() {
      // Drag on overlay (move crop)
      this.$overlay.addEventListener('pointerdown', (e) => {
         if (e.target.classList.contains('icm__handle')) return;
         e.preventDefault();
         this._dragging = 'move';
         this._dragStart = { x: e.clientX, y: e.clientY, crop: { ...this._crop } };
         this.$overlay.setPointerCapture(e.pointerId);
      });

      this.$overlay.addEventListener('pointermove', (e) => {
         if (!this._dragging) return;
         e.preventDefault();
         const rect = this.$canvas.getBoundingClientRect();
         const scaleX = this.$canvas.width / rect.width;
         const scaleY = this.$canvas.height / rect.height;

         if (this._dragging === 'move') {
            const dx = (e.clientX - this._dragStart.x) * scaleX;
            const dy = (e.clientY - this._dragStart.y) * scaleY;
            const c = this._dragStart.crop;
            this._crop.x = Math.max(0, Math.min(this.$canvas.width - c.w, c.x + dx));
            this._crop.y = Math.max(0, Math.min(this.$canvas.height - c.h, c.y + dy));
         } else {
            this._resizeCrop(e, rect, scaleX, scaleY);
         }
         this._drawOverlay();
      });

      this.$overlay.addEventListener('pointerup', () => { this._dragging = null; });
      this.$overlay.addEventListener('pointercancel', () => { this._dragging = null; });

      // Handle drag
      for (const handle of this._handles) {
         handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._dragging = handle.dataset.handle;
            this._dragStart = { x: e.clientX, y: e.clientY, crop: { ...this._crop } };
            handle.setPointerCapture(e.pointerId);
         });
      }

      // Window resize → redraw
      this._resizeObserver = new ResizeObserver(() => this._drawOverlay());
      this._resizeObserver.observe(this.$canvasWrap);
   }

   _resizeCrop(e, rect, scaleX, scaleY) {
      const dx = (e.clientX - this._dragStart.x) * scaleX;
      const dy = (e.clientY - this._dragStart.y) * scaleY;
      const c = this._dragStart.crop;
      const handle = this._dragging;
      const minSize = 20;

      let { x, y, w, h } = c;

      if (handle.includes('e')) {
         w = Math.max(minSize, Math.min(this.$canvas.width - x, c.w + dx));
      }
      if (handle.includes('w')) {
         const newX = Math.max(0, c.x + dx);
         w = c.w + (c.x - newX);
         if (w >= minSize) x = newX;
         else w = minSize;
      }
      if (handle.includes('s')) {
         h = Math.max(minSize, Math.min(this.$canvas.height - y, c.h + dy));
      }
      if (handle.includes('n')) {
         const newY = Math.max(0, c.y + dy);
         h = c.h + (c.y - newY);
         if (h >= minSize) y = newY;
         else h = minSize;
      }

      // Enforce aspect ratio
      if (this._aspect) {
         if (handle === 'n' || handle === 's') {
            w = h * this._aspect;
         } else if (handle === 'e' || handle === 'w') {
            h = w / this._aspect;
         } else {
            // Corner: constrain by the dominant axis
            if (Math.abs(dx) > Math.abs(dy)) {
               h = w / this._aspect;
            } else {
               w = h * this._aspect;
            }
         }
         // Clamp to bounds
         if (x + w > this.$canvas.width) w = this.$canvas.width - x;
         if (y + h > this.$canvas.height) h = this.$canvas.height - y;
      }

      this._crop = { x, y, w, h };
   }

   _setAspect(aspect) {
      this._aspect = aspect;
      // Update button states
      this.querySelectorAll('.icm__aspect-btn').forEach((btn) => {
         const val = btn.dataset.aspect;
         btn.classList.toggle('is-active', val === String(aspect ?? ''));
      });
      // Refit crop to aspect
      if (aspect) {
         const c = this._crop;
         const newW = Math.min(c.w, this.$canvas.height * aspect);
         const newH = newW / aspect;
         this._crop = {
            x: c.x + (c.w - newW) / 2,
            y: c.y + (c.h - newH) / 2,
            w: newW,
            h: newH
         };
         this._drawOverlay();
      }
   }

   _drawOverlay() {
      const canvas = this.$canvas;
      if (!canvas.width || !canvas.height) return;

      // Position overlay to match canvas display size
      const rect = canvas.getBoundingClientRect();
      Object.assign(this.$overlay.style, {
         position: 'absolute',
         left: canvas.offsetLeft + 'px',
         top: canvas.offsetTop + 'px',
         width: rect.width + 'px',
         height: rect.height + 'px'
      });

      // Scale factors: canvas pixels → CSS pixels
      const sx = rect.width / canvas.width;
      const sy = rect.height / canvas.height;

      const c = this._crop;
      Object.assign(this.$overlay.style, {
         background: `
            linear-gradient(to right, rgba(0,0,0,0.5) ${c.x * sx}px, transparent ${c.x * sx}px),
            linear-gradient(to left, rgba(0,0,0,0.5) ${(canvas.width - c.x - c.w) * sx}px, transparent ${(canvas.width - c.x - c.w) * sx}px),
            linear-gradient(to bottom, rgba(0,0,0,0.5) ${c.y * sy}px, transparent ${c.y * sy}px),
            linear-gradient(to top, rgba(0,0,0,0.5) ${(canvas.height - c.y - c.h) * sy}px, transparent ${(canvas.height - c.y - c.h) * sy}px)
         `
      });

      // Position handles
      const handleSize = 10;
      const positions = {
         nw: { left: c.x * sx - handleSize / 2, top: c.y * sy - handleSize / 2 },
         n:  { left: (c.x + c.w / 2) * sx - handleSize / 2, top: c.y * sy - handleSize / 2 },
         ne: { left: (c.x + c.w) * sx - handleSize / 2, top: c.y * sy - handleSize / 2 },
         e:  { left: (c.x + c.w) * sx - handleSize / 2, top: (c.y + c.h / 2) * sy - handleSize / 2 },
         se: { left: (c.x + c.w) * sx - handleSize / 2, top: (c.y + c.h) * sy - handleSize / 2 },
         s:  { left: (c.x + c.w / 2) * sx - handleSize / 2, top: (c.y + c.h) * sy - handleSize / 2 },
         sw: { left: c.x * sx - handleSize / 2, top: (c.y + c.h) * sy - handleSize / 2 },
         w:  { left: c.x * sx - handleSize / 2, top: (c.y + c.h / 2) * sy - handleSize / 2 }
      };

      for (const h of this._handles) {
         const pos = positions[h.dataset.handle];
         if (pos) {
            h.style.left = pos.left + 'px';
            h.style.top = pos.top + 'px';
         }
      }
   }

   open(opts = {}) {
      this.ensure().then(() => {
         this._onApply = typeof opts.onApply === 'function' ? opts.onApply : null;
         this._img = opts.img || null;
         this._aspect = null;

         if (!this._img?.url) return;

         // Reset aspect buttons
         this.querySelectorAll('.icm__aspect-btn').forEach((btn, i) => {
            btn.classList.toggle('is-active', i === 0);
         });

         // Load image into canvas
         this._imgEl = new Image();
         this._imgEl.crossOrigin = 'anonymous';
         this._imgEl.onload = () => {
            // Fit canvas to container
            const maxW = 480;
            const maxH = 360;
            const ratio = Math.min(maxW / this._imgEl.naturalWidth, maxH / this._imgEl.naturalHeight, 1);
            this.$canvas.width = Math.round(this._imgEl.naturalWidth * ratio);
            this.$canvas.height = Math.round(this._imgEl.naturalHeight * ratio);

            // Draw image
            this.$ctx.drawImage(this._imgEl, 0, 0, this.$canvas.width, this.$canvas.height);

            // Default crop: full image
            const margin = 0.05;
            this._crop = {
               x: this.$canvas.width * margin,
               y: this.$canvas.height * margin,
               w: this.$canvas.width * (1 - margin * 2),
               h: this.$canvas.height * (1 - margin * 2)
            };

            this._drawOverlay();
         };
         this._imgEl.src = this._img.url;

         requestAnimationFrame(() => { this._modal.open = true; });
      });
   }

   async _apply() {
      if (!this._imgEl || !this.$canvas.width) {
         this._modal?.close();
         return;
      }

      // Crop at full resolution
      const sx = this._imgEl.naturalWidth / this.$canvas.width;
      const sy = this._imgEl.naturalHeight / this.$canvas.height;

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = Math.round(this._crop.w * sx);
      cropCanvas.height = Math.round(this._crop.h * sy);
      const ctx = cropCanvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
         this._imgEl,
         Math.round(this._crop.x * sx),
         Math.round(this._crop.y * sy),
         cropCanvas.width,
         cropCanvas.height,
         0, 0,
         cropCanvas.width,
         cropCanvas.height
      );

      // Convert to blob
      const blob = await new Promise((resolve) => {
         cropCanvas.toBlob(resolve, 'image/png', 1);
      });

      this._modal?.close();
      this._onApply?.(blob, {
         pxW: cropCanvas.width,
         pxH: cropCanvas.height
      });
   }

   close() {
      this._modal?.close();
   }

   beforeDestroy() {
      this._resizeObserver?.disconnect();
   }
}

customElements.define('slice-image-crop-modal', ImageCropModal);
