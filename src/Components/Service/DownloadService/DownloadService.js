// DownloadService — Wrapper único para disparar descargas desde el navegador.
//
// Existe porque el patrón "crear un <a>, click y listo" tiene dos trampas que
// se repetían en cada vista:
//   1. Firefox ignora el click si el anchor no está en el documento.
//   2. Revocar la object URL justo después del click aborta la descarga: el
//      navegador todavía no leyó el blob. Hay que diferir el revoke.
//
// Consumo: slice.getComponent('DownloadService').blob(myBlob, 'archivo.png');

const REVOKE_DELAY_MS = 10000;

export default class DownloadService {
   constructor(props = {}) {
      this.props = props || {};
   }

   /**
    * Descarga un Blob. La object URL se crea y se revoca acá adentro.
    * @param {Blob} blob
    * @param {string} fileName
    * @returns {boolean} false si no había blob
    */
   blob(blob, fileName) {
      if (!blob) return false;
      const url = URL.createObjectURL(blob);
      this._trigger(url, fileName);
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
      return true;
   }

   /**
    * Descarga una URL ya existente (data:, blob: o remota). No la revoca: si la
    * creó quien llama, es quien llama el que decide cuándo soltarla.
    * @param {string} href
    * @param {string} fileName
    */
   url(href, fileName) {
      if (!href) return false;
      this._trigger(href, fileName);
      return true;
   }

   /**
    * Descarga texto plano (SVG, JSON, CSV…) como archivo.
    * @param {string} text
    * @param {string} fileName
    * @param {string} [mime]
    */
   text(text, fileName, mime = 'text/plain;charset=utf-8') {
      return this.blob(new Blob([String(text ?? '')], { type: mime }), fileName);
   }

   /**
    * Convierte un canvas a Blob, con fallback a data URL en entornos sin toBlob.
    * @param {HTMLCanvasElement} canvas
    * @param {string} fileName
    * @param {string} [type]
    * @param {number} [quality]
    */
   async canvas(canvas, fileName, type = 'image/png', quality = 1) {
      if (typeof canvas?.toBlob === 'function') {
         const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
         if (blob) return this.blob(blob, fileName);
      }
      return this.url(canvas.toDataURL(type, quality), fileName);
   }

   _trigger(href, fileName) {
      const link = document.createElement('a');
      link.href = href;
      link.download = fileName || 'download';
      link.rel = 'noopener';
      // Debe estar en el documento: Firefox descarta el click si no lo está.
      document.body.appendChild(link);
      link.click();
      link.remove();
   }
}
