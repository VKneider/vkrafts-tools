// ExportService — Exportación PNG, PDF e impresión.
// Renderiza hojas offscreen y genera archivos descargables.
// Depende de html2canvas y jsPDF (importados por la vista que lo consume).
//
// Contrato de geometría: la vista renderiza cada hoja usando píxeles CSS que
// equivalen 1:1 a milímetros reales (96dpi ⇒ 1mm = 96/25.4 px). Gracias a eso
// la impresión sale a tamaño real sin ninguna conversión adicional, y el DPI
// del raster lo decide únicamente el `scale` de html2canvas.

import { zipSync } from 'fflate';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// scale 3 sobre una base de 96dpi ⇒ ~288dpi, suficiente para impresión.
const RASTER_SCALE = 3;
const IMAGE_WAIT_MS = 4000;
// Tope de espera por imagen al estampar un PDF. Un data URL corrupto que
// dispara `onerror` no hace falta esperarlo, pero uno que nunca resuelve sí.
const IMAGE_LOAD_TIMEOUT_MS = 10000;

export default class ExportService {
   constructor(props = {}) {
      this._tpl = props.templatesService;
      this._downloads = props.downloadService || null;
   }

   /** DownloadService inyectado, o el singleton, o null en tests. */
   get _dl() {
      if (!this._downloads && typeof slice !== 'undefined') {
         this._downloads = slice.getComponent?.('DownloadService') || null;
      }
      return this._downloads;
   }

   /**
    * Renderiza cada hoja offscreen en un contenedor temporal.
    *
    * Cada stage tiene dos nodos: `host` es la cáscara posicionada fuera de
    * pantalla (se descarta en cleanup) y `node` es la hoja en sí — el único que
    * se captura o se imprime. Separarlos evita que el `position: fixed` y el
    * desplazamiento negativo del host contaminen la captura.
    *
    * @param {object[]} sheets
    * @param {function} renderFn — (sheet, node) => Promise<void>
    * @returns {Promise<{sheet:object, host:HTMLElement, node:HTMLElement}[]>}
    */
   async renderOffscreen(sheets, renderFn) {
      const stages = [];
      for (const sheet of sheets) {
         const host = document.createElement('div');
         Object.assign(host.style, {
            position: 'fixed',
            left: '-99999px',
            top: '0',
            pointerEvents: 'none',
            zIndex: '-1'
         });

         const node = document.createElement('div');
         document.body.appendChild(host);
         host.appendChild(node);

         await renderFn(sheet, node);
         stages.push({ sheet, host, node });
      }
      return stages;
   }

   /**
    * Limpia los contenedores temporales.
    */
   cleanupStages(stages) {
      (stages || []).forEach((s) => (s.host || s.tmp)?.remove());
   }

   /**
    * Espera a que todas las imágenes de fondo del subárbol estén decodificadas.
    * html2canvas no espera por su cuenta y captura celdas en blanco si el blob
    * todavía no se resolvió. El `win` opcional permite precargarlas en **otro
    * documento** (el iframe de impresión).
    * @param {HTMLElement} node
    * @param {Window} [win]
    */
   async waitForImages(node, win = null) {
      const urls = new Set();
      const collect = (el) => {
         const bg = el.style?.backgroundImage || '';
         const match = bg.match(/url\(["']?([^"')]+)["']?\)/);
         if (match) urls.add(match[1]);
      };
      collect(node);
      node.querySelectorAll('*').forEach(collect);

      if (!urls.size) return;

      const view = win || (typeof window !== 'undefined' ? window : null);
      const loads = [...urls].map(
         (url) =>
            new Promise((resolve) => {
               if (!view?.Image && typeof Image === 'undefined') return resolve();
               const img = view?.Image ? new view.Image() : new Image();
               img.onload = img.onerror = () => resolve();
               img.src = url;
            })
      );

      await Promise.race([
         Promise.all(loads),
         sleep(IMAGE_WAIT_MS)
      ]);
   }

   /**
    * Rasteriza un stage a canvas.
    * @param {HTMLElement} node
    * @param {function} html2canvas
    * @param {number} scale
    */
   async _rasterize(node, html2canvas, scale = RASTER_SCALE) {
      await this.waitForImages(node);
      return html2canvas(node, {
         scale,
         backgroundColor: '#ffffff',
         useCORS: true,
         logging: false,
         // El nodo vive fuera del viewport: sin esto html2canvas recorta la
         // captura al área visible de la ventana.
         width: node.offsetWidth,
         height: node.offsetHeight,
         windowWidth: node.offsetWidth,
         windowHeight: node.offsetHeight,
         scrollX: 0,
         scrollY: 0
      });
   }

   /**
    * Descarga un canvas. Delega en DownloadService, que es el que sabe de las
    * trampas del anchor (debe estar en el DOM) y del revoke diferido.
    */
   async _downloadCanvas(canvas, fileName, type = 'image/png', quality = 1) {
      const dl = this._dl;
      if (dl) return dl.canvas(canvas, fileName, type, quality);

      // Fallback mínimo para entornos sin el servicio (tests).
      const link = document.createElement('a');
      link.download = fileName;
      link.href = canvas.toDataURL(type, quality);
      document.body.appendChild(link);
      link.click();
      link.remove();
      return true;
   }

   /**
    * Exporta las hojas como PNGs individuales o, si hay más de una, como un
    * único ZIP (evita que el navegador bloquee descargas encadenadas).
    * @param {{sheet:object, node:HTMLElement}[]} stages
    * @param {function} html2canvas — dependencia externa
    * @param {{onProgress?:function, scale?:number}} [options]
    * @returns {Promise<number>} cantidad de hojas exportadas
    */
   async exportPNGs(stages, html2canvas, { onProgress = null, scale = RASTER_SCALE } = {}) {
      let count = 0;
      const multiple = stages.length > 1;
      const files = {};

      for (let i = 0; i < stages.length; i++) {
         onProgress?.(i, stages.length);

         const { sheet, node } = stages[i];
         const canvas = await this._rasterize(node, html2canvas, scale);
         const fileName = `hoja-${i + 1}-${sheet.pageId}.png`;

         if (multiple) {
            files[fileName] = await this._canvasBytes(canvas);
         } else {
            await this._downloadCanvas(canvas, fileName, 'image/png', 1.0);
         }

         count++;
         // Descargas encadenadas demasiado rápido se pierden en Chrome.
         if (!multiple && i < stages.length - 1) await sleep(400);
      }

      if (multiple) this._downloadZip(files);

      onProgress?.(stages.length, stages.length);
      return count;
   }

   /** Bytes PNG del canvas (toBlob o fallback a data URL). */
   async _canvasBytes(canvas) {
      if (typeof canvas?.toBlob === 'function') {
         const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 1.0));
         if (blob) {
            if (typeof blob.arrayBuffer === 'function') {
               return new Uint8Array(await blob.arrayBuffer());
            }
            const buffer = await new Promise((resolve, reject) => {
               const reader = new FileReader();
               reader.onload = () => resolve(reader.result);
               reader.onerror = () => reject(reader.error);
               reader.readAsArrayBuffer(blob);
            });
            return new Uint8Array(buffer);
         }
      }

      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const base64 = String(dataUrl).split(',')[1] || '';
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
   }

   /** Descarga el ZIP de PNGs; pasa por DownloadService cuando está. */
   _downloadZip(files) {
      const zip = zipSync(files);
      const blob = new Blob([zip], { type: 'application/zip' });
      const dl = this._dl;
      if (dl) return dl.blob(blob, 'vkrafts-hojas.zip');

      const link = document.createElement('a');
      link.download = 'vkrafts-hojas.zip';
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
      link.remove();
      return true;
   }

   // ── PDF a tamaño exacto ────────────────────────────────────────────────
   //
   // Rasterizar la hoja entera y estamparla como una sola imagen conserva las
   // proporciones, pero arrastra el redondeo a píxeles enteros del canvas. Acá
   // cada imagen se dibuja en sus coordenadas en mm: el tamaño es exacto por
   // construcción y además cada foto entra a su resolución nativa, sin pasar
   // resampleada por un canvas del tamaño de la página.

   /** Carga y decodifica una imagen por URL. */
   _loadImage(url, timeoutMs = IMAGE_LOAD_TIMEOUT_MS) {
      if (!url) return Promise.resolve(null);

      return new Promise((resolve) => {
         const img = new Image();
         let done = false;
         const finish = (value) => {
            if (done) return;
            done = true;
            resolve(value);
         };

         // crossOrigin 'anonymous' es necesario para CORS, pero las object URLs
         // y los data URLs no lo necesitan — solo se activa cuando corresponde.
         if (!url.startsWith('blob:') && !url.startsWith('data:')) img.crossOrigin = 'anonymous';
         img.onload = () => finish(img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null);
         img.onerror = () => finish(null);
         // Sin timeout, un data URL corrupto dejaba la exportación esperando
         // para siempre y el botón de PDF trabado en "Generando…".
         setTimeout(() => finish(null), timeoutMs);
         img.src = url;
      });
   }

   /** Extensiones que valen la pena conservar con transparencia. */
   _keepsAlpha(name) {
      return /\.(png|webp|gif|svg)$/i.test(String(name || ''));
   }

   /**
    * Convierte una imagen a data URL y devuelve el formato REAL de los bytes.
    *
    * jsPDF necesita que el `format` coincida con el data URL; si no, la imagen
    * se descarta y la página sale en blanco. Deducirlo del nombre del archivo es
    * frágil (rotar/voltear guardan PNG aunque el nombre diga `.jpg`), así que se
    * lee el prefijo del data URL.
    */
   _payload(img, keepAlpha, canvas = null) {
      const data = canvas
         ? canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.94)
         : this._imageToDataURL(img, keepAlpha);

      const match = /^data:image\/([a-z+]+)/i.exec(String(data || ''));
      const kind = (match?.[1] || '').toLowerCase();
      const format = kind === 'png'
         ? 'PNG'
         : kind === 'jpeg' || kind === 'jpg'
            ? 'JPEG'
            : (keepAlpha ? 'PNG' : 'JPEG');

      return { data, format };
   }

   /**
    * Convierte un HTMLImageElement a data URL para que jsPDF pueda estamparlo.
    * Sin esto, addImage recibe un objeto Image que el navegador no serializa
    * correctamente al PDF → página en blanco.
    */
   _imageToDataURL(img, keepAlpha, quality = 0.94) {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', quality);
   }

   /**
    * Recorta una imagen al aspecto de la celda (modo `cover`) devolviendo un
    * canvas del tamaño físico pedido. jsPDF no sabe recortar.
    */
   _cropToRatio(img, targetRatio, dpi, wMm) {
      const srcRatio = img.naturalWidth / img.naturalHeight;

      let sw = img.naturalWidth;
      let sh = img.naturalHeight;
      if (srcRatio > targetRatio) sw = img.naturalHeight * targetRatio;
      else sh = img.naturalWidth / targetRatio;

      const sx = (img.naturalWidth - sw) / 2;
      const sy = (img.naturalHeight - sh) / 2;

      // No se sobre-muestrea: si la imagen no da la resolución pedida, se usa
      // la que tiene en vez de inventar píxeles.
      const wantedPx = Math.round((wMm / 25.4) * dpi);
      const outW = Math.max(1, Math.min(wantedPx, Math.round(sw)));
      const outH = Math.max(1, Math.round(outW / targetRatio));

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      return canvas;
   }

   /**
    * Renderiza la vista recortada de una imagen tal como la muestra la celda:
    * `background-size: <cropScale>% auto` + `background-position: x% y%`.
    * Se usa solo cuando hay zoom/encuadre manual (`cropScale > 1`), porque ahí
    * jsPDF ya no puede recortar por sí solo.
    */
   _renderCropView(img, item, dpi, keepAlpha) {
      const imgRatio = img.naturalWidth / img.naturalHeight;
      const scale = Number(item.cropScale) > 1 ? Number(item.cropScale) : 1;
      const cropX = Number.isFinite(Number(item.cropX)) ? Number(item.cropX) : 0.5;
      const cropY = Number.isFinite(Number(item.cropY)) ? Number(item.cropY) : 0.5;

      // Tamaño visible de la imagen en mm (CSS: ancho = scale × ancho de celda).
      const dwMm = item.wMm * scale;
      const dhMm = dwMm / imgRatio;
      const offXMm = (item.wMm - dwMm) * cropX;
      const offYMm = (item.hMm - dhMm) * cropY;

      // No se sobre-muestrea: se limita a los píxeles visibles de la fuente.
      const visibleSrcW = Math.min(img.naturalWidth, (item.wMm / dwMm) * img.naturalWidth);
      const wantedPx = Math.round((item.wMm / 25.4) * dpi);
      const outW = Math.max(1, Math.min(wantedPx, Math.round(visibleSrcW)));
      const outH = Math.max(1, Math.round(outW * (item.hMm / item.wMm)));

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!keepAlpha) {
         // La hoja es blanca: los huecos de un encuadre que no cubre la celda
         // tienen que salir blancos, no negros (JPEG no guarda transparencia).
         ctx.fillStyle = '#ffffff';
         ctx.fillRect(0, 0, outW, outH);
      }
      ctx.imageSmoothingQuality = 'high';
      const pxPerMm = outW / item.wMm;
      ctx.drawImage(
         img,
         offXMm * pxPerMm,
         offYMm * pxPerMm,
         dwMm * pxPerMm,
         dhMm * pxPerMm
      );
      return canvas;
   }


   /**
    * Genera el PDF a partir de un plan ya resuelto en milímetros.
    *
    * Las imágenes se precargan **una vez por URL** y se cuenta cuántas se
    * pudieron estampar. Si había piezas y ninguna imagen se pudo leer, **no se
    * guarda** el PDF: un archivo con las hojas vacías parece un bug del layout y
    * esconde el problema real (una imagen que no decodifica). La vista decide
    * entonces rasterizar las hojas como último recurso.
    *
    * @param {{widthMm:number, heightMm:number,
    *   items:{url:string, xMm:number, yMm:number, wMm:number, hMm:number,
    *          crop:boolean, cellRatio:number, cropScale?:number,
    *          cropX?:number, cropY?:number, name?:string}[]}[]} pages
    * @param {function} jsPDF
    * @param {{onProgress?:function, fileName?:string, dpi?:number}} [options]
    * @returns {Promise<false|{ok:boolean, paginas:number, items:number,
    *   imagenes:number, fallidas:string[]}>}
    */
   async exportPDFExact(pages, jsPDF, {
      onProgress = null,
      fileName = 'vkrafts-hojas.pdf',
      dpi = 300
   } = {}) {
      if (!pages?.length) return false;

      // Precarga sin repetir: dos celdas del mismo sticker comparten URL y no
      // tiene sentido decodificarlo dos veces.
      const cache = new Map();
      const fallidas = [];
      for (const page of pages) {
         for (const item of page.items || []) {
            if (!item?.url || cache.has(item.url)) continue;
            const img = await this._loadImage(item.url);
            cache.set(item.url, img);
            if (!img) fallidas.push(item.url);
         }
      }

      let pdf = null;
      let items = 0;
      let colocadas = 0;

      for (let i = 0; i < pages.length; i++) {
         onProgress?.(i, pages.length);
         const page = pages[i];

         if (!pdf) {
            pdf = new jsPDF({
               unit: 'mm',
               format: [page.widthMm, page.heightMm],
               // jsPDF normaliza a vertical cualquier format custom si no se le
               // dice la orientación: [297, 210] salía 210×297.
               orientation: page.widthMm > page.heightMm ? 'landscape' : 'portrait',
               compress: true
            });
         } else {
            pdf.addPage(
               [page.widthMm, page.heightMm],
               page.widthMm > page.heightMm ? 'landscape' : 'portrait'
            );
         }

         for (const item of page.items || []) {
            items++;
            const img = cache.get(item.url);
            if (!img) continue;

            const keepAlpha = this._keepsAlpha(item.name);
            const canvas = Number(item.cropScale) > 1
               ? this._renderCropView(img, item, dpi, keepAlpha)
               : (item.crop
                  ? this._cropToRatio(img, item.cellRatio || 1, dpi, item.wMm)
                  : null);
            if (canvas && (!canvas.width || !canvas.height)) continue;

            const { data, format } = this._payload(img, keepAlpha, canvas);
            // `data:,` es lo que devuelve un canvas vacío; jsPDF lo ignora y la
            // página quedaría sin nada.
            if (!/^data:image\//i.test(String(data || ''))) continue;

            pdf.addImage(
               data,
               format,
               item.xMm, item.yMm, item.wMm, item.hMm,
               undefined,
               'FAST'
            );
            colocadas++;
         }
      }

      onProgress?.(pages.length, pages.length);

      const ok = colocadas > 0;
      if (ok) pdf?.save(fileName);

      if (!ok && items > 0) {
         console.warn(
            `[ExportService] El PDF tiene ${items} pieza(s) pero no se pudo estampar ninguna imagen. ` +
            'Revisa que las URLs del pool sigan vivas.'
         );
      }

      return { ok, paginas: pages.length, items, imagenes: colocadas, fallidas };
   }

   /**
    * PDF de último recurso: rasteriza cada hoja offscreen y la estampa como
    * página completa. Se usa solo cuando el PDF exacto no pudo leer ninguna
    * imagen; el layout se ve igual, pero no es vectorial.
    *
    * @param {{sheet:{pageId:string}, node:HTMLElement}[]} stages
    * @param {function} html2canvas
    * @param {function} jsPDF
    * @returns {Promise<boolean>}
    */
   async exportPDFRaster(stages, html2canvas, jsPDF, {
      fileName = 'vkrafts-hojas.pdf',
      onProgress = null
   } = {}) {
      if (!stages?.length) return false;

      let pdf = null;
      for (let i = 0; i < stages.length; i++) {
         onProgress?.(i, stages.length);

         const { sheet, node } = stages[i];
         const canvas = await this._rasterize(node, html2canvas);
         if (!canvas?.width || !canvas?.height) continue;

         const page = this._tpl.page(sheet.pageId);
         const orientation = page.w > page.h ? 'landscape' : 'portrait';
         if (!pdf) {
            pdf = new jsPDF({
               unit: 'mm',
               format: [page.w, page.h],
               orientation,
               compress: true
            });
         } else {
            pdf.addPage([page.w, page.h], orientation);
         }
         pdf.addImage(
            canvas.toDataURL('image/jpeg', 0.95),
            'JPEG',
            0, 0, page.w, page.h,
            undefined,
            'FAST'
         );
      }

      if (!pdf) return false;
      onProgress?.(stages.length, stages.length);
      pdf.save(fileName);
      return true;
   }

   /**
    * Hoja de calibración: una regla de 100 mm y un cuadrado de 50 mm impresos a
    * tamaño real. Sirve para distinguir "la app mide mal" de "mi impresora
    * reescala" — casi todos los drivers aplican "ajustar a la página" por
    * defecto y encogen todo sin avisar.
    *
    * @param {function} jsPDF
    * @param {string} pageId
    */
   exportCalibrationSheet(jsPDF, pageId = 'a4') {
      const page = this._tpl.page(pageId);
      const pdf = new jsPDF({
         unit: 'mm',
         format: [page.w, page.h],
         orientation: page.w > page.h ? 'landscape' : 'portrait'
      });

      const left = 20;
      let y = 30;

      pdf.setFontSize(16);
      pdf.text('Calibración de impresión · VKRAFTS', left, y);

      y += 10;
      pdf.setFontSize(10);
      pdf.text('1. Imprimí esta hoja con el escalado DESACTIVADO', left, y);
      y += 5;
      pdf.text('   (en el diálogo de impresión: "Tamaño real" o "Escala: 100%",', left, y);
      y += 5;
      pdf.text('   nunca "Ajustar a la página").', left, y);
      y += 5;
      pdf.text('2. Medí la regla con una regla de verdad.', left, y);
      y += 5;
      pdf.text('3. Si no da 100 mm exactos, el que reescala es tu driver.', left, y);

      // Regla de 100 mm con marcas cada 10 mm.
      y += 18;
      pdf.setLineWidth(0.3);
      pdf.line(left, y, left + 100, y);
      for (let mm = 0; mm <= 100; mm += 10) {
         const tall = mm % 50 === 0;
         pdf.line(left + mm, y, left + mm, y - (tall ? 6 : 3));
         pdf.setFontSize(7);
         pdf.text(String(mm), left + mm, y - (tall ? 8 : 5), { align: 'center' });
      }
      pdf.setFontSize(9);
      pdf.text('Esta línea debe medir exactamente 100 mm (10 cm)', left, y + 6);

      // Cuadrado de 50 mm.
      y += 20;
      pdf.rect(left, y, 50, 50);
      pdf.text('50 × 50 mm', left + 54, y + 26);

      pdf.save('vkrafts-calibracion.pdf');
      return true;
   }

   /**
    * Imprime las hojas a tamaño real.
    *
    * Usa un iframe oculto en vez de `window.open`: no lo bloquea el navegador,
    * no depende de `document.write` sobre otra ventana y el `afterprint` llega
    * a la ventana correcta (con `window.open` se escuchaba en la ventana que
    * abría, así que la ventana de impresión nunca se cerraba).
    *
    * Es async porque **espera a que el iframe cargue las imágenes** antes de
    * abrir el diálogo. Las celdas se pintan con `background-image` de object
    * URLs; el iframe es otro documento y las decodifica de cero. Llamar a
    * `print()` en el frame siguiente dejaba la vista previa en blanco.
    *
    * @param {{sheet:object, node:HTMLElement}[]} stages
    * @param {{onDone?:function}} [options]
    * @returns {Promise<boolean>} false si no había nada que imprimir
    */
   async printSheets(stages, { onDone = null } = {}) {
      if (!stages?.length) return false;

      const page = this._tpl.page(stages[0].sheet.pageId);

      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.title = 'Impresión';
      Object.assign(frame.style, {
         position: 'fixed',
         right: '0',
         bottom: '0',
         width: '0',
         height: '0',
         border: '0',
         visibility: 'hidden'
      });
      document.body.appendChild(frame);

      const doc = frame.contentDocument;
      if (!doc) {
         frame.remove();
         return false;
      }

      const style = doc.createElement('style');
      style.textContent = `
        @page { size: ${page.w}mm ${page.h}mm; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .vk-print-sheet { break-after: page; page-break-after: always; overflow: hidden; }
        .vk-print-sheet:last-child { break-after: auto; page-break-after: auto; }
      `;
      doc.head.appendChild(style);

      for (const stage of stages) {
         // El nodo offscreen ya está plano y medido en px-CSS ≡ mm reales:
         // se importa tal cual, solo neutralizando el transform de preview.
         const imported = doc.importNode(stage.node, true);
         imported.classList.add('vk-print-sheet');
         imported.style.transform = 'none';
         imported.style.boxShadow = 'none';
         imported.style.borderRadius = '0';
         doc.body.appendChild(imported);
      }

      const cleanup = () => {
         frame.remove();
         onDone?.();
      };

      const win = frame.contentWindow;
      win.addEventListener('afterprint', cleanup, { once: true });
      // Red de seguridad: algunos navegadores no emiten afterprint desde un
      // iframe, y el frame quedaría colgado en el DOM para siempre.
      setTimeout(cleanup, 60000);

      // Sin esto, el diálogo de impresión puede abrirse antes de que el
      // documento nuevo tenga las imágenes decodificadas (hojas en blanco).
      await this.waitForImages(doc.body, win);

      // Un frame de margen para que el layout del iframe se asiente.
      requestAnimationFrame(() => {
         win.focus();
         win.print();
      });

      return true;
   }
}
