// Matemática pura de la hoja: geometría por celdas, orientaciones,
// decisiones de ajuste y conversión cm→pesos. Sin estado, sin DOM.
//
// Consumo: const geom = slice.getComponent('SheetGeometry');
const RATIO_LOG_LIMIT = 0.25; // tolerancia del modo "smart" para usar cover
const ORIENT_SQUARE_TOL = 0.15;
const MIN_CELL_MM = 15;

export default class SheetGeometry {
   constructor(props = {}) {
      this.props = props || {};
   }

   /** Clasifica una relación de aspecto (w/h) en landscape/portrait/square. */
   orientation(ratio) {
      if (!(ratio > 0)) return 'square';
      if (Math.abs(ratio - 1) < ORIENT_SQUARE_TOL) return 'square';
      return ratio > 1 ? 'landscape' : 'portrait';
   }

   /**
    * Geometría real de la hoja respetando pesos editables por columna/fila.
    * @returns {{cols:number[], rows:number[], colWmm:number[], rowHmm:number[],
    *   cellRatio:number, innerW:number, innerH:number}}
    */
   geometry(tpl, page, preset, colsOverride = null, rowsOverride = null, fixedCellMm = null) {
      const cols = Array.isArray(colsOverride) && colsOverride.length === tpl.cols
         ? colsOverride : Array(tpl.cols).fill(1);
      const rows = Array.isArray(rowsOverride) && rowsOverride.length === tpl.rows
         ? rowsOverride : Array(tpl.rows).fill(1);

      const innerW = Math.max(
         20,
         page.w - preset.marginMm * 2 - preset.gapMm * (tpl.cols - 1)
      );
      const innerH = Math.max(
         20,
         page.h - preset.marginMm * 2 - preset.gapMm * (tpl.rows - 1)
      );

      // Modo tamaño fijo (productos): la celda mide exactamente lo pedido y lo
      // que sobra de la hoja queda como margen, en vez de estirarse. Un sticker
      // de 5×5 tiene que salir de 5×5 aunque la hoja quede con espacio libre.
      if (fixedCellMm?.w > 0 && fixedCellMm?.h > 0) {
         const colWmm = Array(tpl.cols).fill(fixedCellMm.w);
         const rowHmm = Array(tpl.rows).fill(fixedCellMm.h);
         return {
            cols, rows, colWmm, rowHmm,
            cellRatio: fixedCellMm.w / fixedCellMm.h,
            innerW, innerH,
            fixed: true
         };
      }

      const sumC = cols.reduce((a, b) => a + b, 0);
      const sumR = rows.reduce((a, b) => a + b, 0);
      const colWmm = cols.map((w) => (innerW * w) / sumC);
      const rowHmm = rows.map((h) => (innerH * h) / sumR);

      return {
         cols,
         rows,
         colWmm,
         rowHmm,
         cellRatio: colWmm[0] / rowHmm[0],
         innerW,
         innerH,
         fixed: false
      };
   }

   /**
    * Rectángulo de cada celda en MILÍMETROS, medido desde la esquina superior
    * izquierda de la hoja. Es lo que permite estampar cada imagen en el PDF con
    * coordenadas físicas exactas, en vez de rasterizar la hoja entera y confiar
    * en que las proporciones sobrevivan al redondeo de píxeles.
    *
    * @returns {{slot:number, col:number, row:number,
    *   xMm:number, yMm:number, wMm:number, hMm:number}[]}
    */
   cellRects(tpl, page, preset, geo) {
      const { colWmm, rowHmm } = geo;
      const gap = preset.gapMm;

      const gridW = colWmm.reduce((a, b) => a + b, 0) + gap * (tpl.cols - 1);
      const gridH = rowHmm.reduce((a, b) => a + b, 0) + gap * (tpl.rows - 1);

      // En modo tamaño fijo la grilla no llena la hoja: va centrada, igual que
      // en pantalla (justify/alignContent: center).
      const originX = geo.fixed ? (page.w - gridW) / 2 : preset.marginMm;
      const originY = geo.fixed ? (page.h - gridH) / 2 : preset.marginMm;

      const xs = [];
      let x = originX;
      for (const w of colWmm) { xs.push(x); x += w + gap; }

      const ys = [];
      let y = originY;
      for (const h of rowHmm) { ys.push(y); y += h + gap; }

      const rects = [];
      for (let row = 0; row < tpl.rows; row++) {
         for (let col = 0; col < tpl.cols; col++) {
            rects.push({
               slot: row * tpl.cols + col,
               col,
               row,
               xMm: xs[col],
               yMm: ys[row],
               wMm: colWmm[col],
               hMm: rowHmm[row]
            });
         }
      }
      return rects;
   }

   /**
    * Rectángulo que ocupa la imagen DENTRO de la celda, en mm, replicando la
    * semántica de `background-size` de la vista previa.
    *   · scale < 1  → ancho = scale × ancho de celda, alto proporcional, centrado
    *   · contain    → entra completa, centrada
    *   · cover      → llena la celda y se recorta el sobrante
    *
    * @returns {{xMm,yMm,wMm,hMm, crop:boolean}} `crop` avisa si hay que
    *   recortar la imagen antes de estamparla.
    */
   imageRect(cell, imgRatio, fit, scale = 1) {
      if (!(imgRatio > 0)) return { ...cell, crop: false };

      if (scale < 1) {
         const w = cell.wMm * scale;
         const h = w / imgRatio;
         return {
            xMm: cell.xMm + (cell.wMm - w) / 2,
            yMm: cell.yMm + (cell.hMm - h) / 2,
            wMm: w,
            hMm: h,
            crop: false
         };
      }

      if (fit === 'contain') {
         const cellRatio = cell.wMm / cell.hMm;
         const w = imgRatio > cellRatio ? cell.wMm : cell.hMm * imgRatio;
         const h = imgRatio > cellRatio ? cell.wMm / imgRatio : cell.hMm;
         return {
            xMm: cell.xMm + (cell.wMm - w) / 2,
            yMm: cell.yMm + (cell.hMm - h) / 2,
            wMm: w,
            hMm: h,
            crop: false
         };
      }

      // cover: ocupa la celda entera, lo que sobra se recorta.
      return { xMm: cell.xMm, yMm: cell.yMm, wMm: cell.wMm, hMm: cell.hMm, crop: true };
   }

   /** Diferencia logarítmica entre imagen y celda (menor = mejor encaje). */
   fitScore(imgRatio, cellRatio) {
      return Math.abs(Math.log(imgRatio / cellRatio));
   }

   /** Resuelve el ajuste final según el modo de la hoja. */
   fitFor(imgRatio, cellRatio, mode) {
      if (mode === 'smart') {
         return this.fitScore(imgRatio, cellRatio) <= RATIO_LOG_LIMIT
            ? 'cover' : 'contain';
      }
      return mode === 'cover' ? 'cover' : 'contain';
   }

   /**
    * Convierte un ancho/alto objetivo (mm) para la celda `idx` en los pesos
    * relativos que lo producen, clampeando a mínimo MIN_CELL_MM por celda.
    * @param {number[]} weights pesos actuales del eje
    * @param {number[]} sizesMm  tamaños actuales en mm (misma longitud)
    * @param {number}   idx      celda objetivo
    * @param {number}   targetMm tamaño deseado en mm
    * @param {number}   innerMm  espacio interior total del eje (sin gaps)
    */
   applyTargetSize(weights, sizesMm, idx, targetMm, innerMm) {
      const minTotal = MIN_CELL_MM * weights.length;
      const innerSafe = Math.max(innerMm, minTotal);
      const T = Math.min(Math.max(targetMm, MIN_CELL_MM), innerSafe - MIN_CELL_MM * (weights.length - 1));

      const sumW = weights.reduce((a, b) => a + b, 0);
      const sumOthers = sumW - weights[idx];
      const denom = innerSafe - T;
      if (denom <= 0.01 || sumOthers <= 0.01) return [...weights];

      return weights.map((w, i) => (i === idx ? (T * sumOthers) / denom : w));
   }
}
