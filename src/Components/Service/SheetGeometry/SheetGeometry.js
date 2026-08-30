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
   geometry(tpl, page, preset, colsOverride = null, rowsOverride = null) {
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
         innerH
      };
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
