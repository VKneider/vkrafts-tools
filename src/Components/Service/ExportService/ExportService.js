// ExportService — Exportación PNG, PDF e impresión.
// Renderiza hojas offscreen y genera archivos descargables.
// Depende de html2canvas y jsPDF (importados por la vista que lo consume).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default class ExportService {
   constructor(props = {}) {
      this._tpl = props.templatesService;
   }

   /**
    * Renderiza cada hoja offscreen en un contenedor temporal.
    * @param {object[]} sheets
    * @param {function} renderFn — (sheet, container) => Promise<void>
    * @returns {Promise<{sheet:object, tmp:HTMLElement}[]>}
    */
   async renderOffscreen(sheets, renderFn) {
      const stages = [];
      for (const sheet of sheets) {
         const tmp = document.createElement('div');
         Object.assign(tmp.style, {
            position: 'fixed', left: '0', top: '0',
            zIndex: '-1', opacity: '0', pointerEvents: 'none',
            background: '#ffffff'
         });
         document.body.appendChild(tmp);
         await renderFn(sheet, tmp);
         stages.push({ sheet, tmp });
      }
      return stages;
   }

   /**
    * Limpia los contenedores temporales.
    */
   cleanupStages(stages) {
      stages.forEach((s) => s.tmp.remove());
   }

   /**
    * Exporta todas las hojas como PNGs individuales.
    * @param {{sheet:object, tmp:HTMLElement}[]} stages
    * @param {function} html2canvas — dependencia externa
    * @returns {Promise<number>} cantidad de hojas exportadas
    */
   async exportPNGs(stages, html2canvas) {
      let count = 0;
      for (let i = 0; i < stages.length; i++) {
         const canvas = await html2canvas(stages[i].tmp, {
            scale: 2, backgroundColor: '#ffffff', useCORS: true
         });
         const link = document.createElement('a');
         link.download = `hoja-${i + 1}-${stages[i].sheet.pageId}.png`;
         link.href = canvas.toDataURL('image/png', 1.0);
         link.click();
         await sleep(400);
         count++;
      }
      return count;
   }

   /**
    * Exporta todas las hojas en un solo PDF.
    * @param {{sheet:object, tmp:HTMLElement}[]} stages
    * @param {function} html2canvas
    * @param {function} jsPDF — constructor de jsPDF
    * @returns {Promise<boolean>} true si éxito
    */
   async exportPDF(stages, html2canvas, jsPDF) {
      let pdf = null;
      for (let i = 0; i < stages.length; i++) {
         const { sheet, tmp } = stages[i];
         const page = this._tpl.page(sheet.pageId);
         const canvas = await html2canvas(tmp, {
            scale: 2, backgroundColor: '#ffffff', useCORS: true
         });
         const orientation = page.w > page.h ? 'landscape' : 'portrait';
         if (!pdf) {
            pdf = new jsPDF({ orientation, unit: 'mm', format: [page.w, page.h] });
         } else {
            pdf.addPage([page.w, page.h], orientation);
         }
         pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, page.w, page.h);
      }
      pdf?.save('vkrafts-hojas.pdf');
      return !!pdf;
   }

   /**
    * Imprime la hoja actual usando un portal temporal.
    * @param {HTMLElement} sheetElement — elemento de la hoja a imprimir
    * @returns {Promise<void>}
    */
   printSheet(sheetElement) {
      const clone = sheetElement.cloneNode(true);

      const sheetStyles = `
        .layoutssection__sheet {
          position: relative;
          display: grid;
          background: #ffffff;
          border-radius: 0;
          box-shadow: none;
        }
        .layoutssection__cell {
          position: relative;
          border-radius: 0;
          min-width: 0;
          min-height: 0;
        }
        .layoutssection__cell--img {
          background-position: center;
          background-repeat: no-repeat;
        }
      `;

      const printWindow = window.open('', '_blank', 'width=800,height=600');
      if (!printWindow) return;

      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
<style>
  @page { margin: 0; size: auto; }
  @page :first { margin: 0; }
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #fff; }
  body { display: flex; justify-content: center; align-items: center; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  ${sheetStyles}
</style>
</head>
<body></body>
</html>`);
      printWindow.document.body.appendChild(clone);
      printWindow.document.close();

      const onAfterPrint = () => {
         printWindow.close();
         window.removeEventListener('afterprint', onAfterPrint);
      };
      window.addEventListener('afterprint', onAfterPrint);

      setTimeout(() => {
         printWindow.print();
      }, 200);
   }
}
