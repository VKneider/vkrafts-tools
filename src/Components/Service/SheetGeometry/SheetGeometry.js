// Matemática pura de la hoja: geometría por celdas, orientaciones,
// decisiones de ajuste y conversión cm→pesos/medidas exactas. Sin estado, sin DOM.
//
// Consumo: const geom = slice.getComponent('SheetGeometry');
const RATIO_LOG_LIMIT = 0.25; // tolerancia del modo "smart" para usar cover
const ORIENT_SQUARE_TOL = 0.15;
const MIN_CELL_MM = 15;
const EPS = 0.01;

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
    * Geometría real de la hoja.
    *
    * Dos modos conviven:
    *   · **Pesos** (por defecto): `cols`/`rows` son proporciones y las celdas
    *     se estiran para llenar la hoja.
    *   · **Medidas exactas**: `sizes.colsMm` / `sizes.rowsMm` fijan el tamaño
    *     físico de cada columna/fila. Ese eje NO se estira: la grilla se ancla
    *     al margen superior izquierdo y lo que sobra queda libre. Editar una
    *     celda no modifica a las demás, que es lo que se espera de "medidas
    *     exactas".
    *
    * El modo producto (`fixedCellMm`) fija ambos ejes a una misma medida.
    *
    * @param {object} tpl plantilla (cols, rows)
    * @param {object} page papel (w, h en mm)
    * @param {object} preset márgenes y separación (mm)
    * @param {number[]|null} [colsOverride] pesos de columnas
    * @param {number[]|null} [rowsOverride] pesos de filas
    * @param {{w:number,h:number}|null} [fixedCellMm] medida fija de producto
    * @param {{colsMm?:number[]|null, rowsMm?:number[]|null}|null} [sizes]
    *   medidas exactas por columna/fila (mm)
    * @returns {{cols:number[], rows:number[], colWmm:number[], rowHmm:number[],
    *   cellRatio:number, innerW:number, innerH:number, fixed:boolean,
    *   colFixed:boolean, rowFixed:boolean, colCentered:boolean,
    *   rowCentered:boolean, originXMm:number, originYMm:number,
    *   gridW:number, gridH:number}}
    */
   geometry(tpl, page, preset, colsOverride = null, rowsOverride = null,
      fixedCellMm = null, sizes = null) {
      const cols = Array.isArray(colsOverride) && colsOverride.length === tpl.cols
         ? colsOverride : Array(tpl.cols).fill(1);
      const rows = Array.isArray(rowsOverride) && rowsOverride.length === tpl.rows
         ? rowsOverride : Array(tpl.rows).fill(1);

      const gapW = preset.gapMm * (tpl.cols - 1);
      const gapH = preset.gapMm * (tpl.rows - 1);

      const innerW = Math.max(
         20,
         page.w - preset.marginMm * 2 - gapW
      );
      const innerH = Math.max(
         20,
         page.h - preset.marginMm * 2 - gapH
      );

      // Modo tamaño fijo (productos): la celda mide exactamente lo pedido y lo
      // que sobra de la hoja queda como margen, en vez de estirarse. Un sticker
      // de 5×5 tiene que salir de 5×5 aunque la hoja quede con espacio libre.
      if (fixedCellMm?.w > 0 && fixedCellMm?.h > 0) {
         const colWmm = Array(tpl.cols).fill(fixedCellMm.w);
         const rowHmm = Array(tpl.rows).fill(fixedCellMm.h);
         const gridW = fixedCellMm.w * tpl.cols + gapW;
         const gridH = fixedCellMm.h * tpl.rows + gapH;
         return {
            cols, rows, colWmm, rowHmm,
            cellRatio: fixedCellMm.w / fixedCellMm.h,
            innerW, innerH,
            fixed: true,
            colFixed: true, rowFixed: true,
            colCentered: true, rowCentered: true,
            originXMm: (page.w - gridW) / 2,
            originYMm: (page.h - gridH) / 2,
            gridW, gridH
         };
      }

      const sumC = cols.reduce((a, b) => a + b, 0);
      const sumR = rows.reduce((a, b) => a + b, 0);

      const colFixed = this._validSizes(sizes?.colsMm, tpl.cols);
      const rowFixed = this._validSizes(sizes?.rowsMm, tpl.rows);

      // Pesos → mm. Solo se usan en los ejes que no tienen medidas exactas.
      const colWmm = colFixed
         ? this._normalizeSizes(sizes.colsMm, innerW, tpl.cols)
         : cols.map((w) => (innerW * w) / sumC);
      const rowHmm = rowFixed
         ? this._normalizeSizes(sizes.rowsMm, innerH, tpl.rows)
         : rows.map((h) => (innerH * h) / sumR);

      const gridW = colWmm.reduce((a, b) => a + b, 0) + gapW;
      const gridH = rowHmm.reduce((a, b) => a + b, 0) + gapH;

      return {
         cols,
         rows,
         colWmm,
         rowHmm,
         cellRatio: colWmm[0] / rowHmm[0],
         innerW,
         innerH,
         fixed: false,
         colFixed,
         rowFixed,
         // Un eje con medidas exactas deja de estirarse: sus celdas conservan
         // el tamaño pedido y la grilla se ancla al margen superior izquierdo.
         // Así editar una celda no mueve a las anteriores (si se centrara, al
         // achicar una columna la primera "saltaría" de lugar).
         colCentered: false,
         rowCentered: false,
         originXMm: preset.marginMm,
         originYMm: preset.marginMm,
         gridW,
         gridH
      };
   }

   /** ¿El array de medidas es válido para esta cantidad de celdas? */
   _validSizes(list, count) {
      return Array.isArray(list)
         && list.length === count
         && list.every((v) => Number.isFinite(Number(v)) && Number(v) > 0);
   }

   /**
    * Sanea medidas exactas: cada celda respeta el mínimo y, si la suma no entra
    * en la hoja, se escala todo proporcionalmente para que no se desborde.
    */
   _normalizeSizes(list, innerMm, count) {
      const out = list.slice(0, count).map((v) => Math.max(MIN_CELL_MM, Number(v)));
      const total = out.reduce((a, b) => a + b, 0);
      if (total > innerMm + EPS) {
         const k = innerMm / total;
         return out.map((v) => v * k);
      }
      return out;
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

      const gridW = geo.gridW ?? colWmm.reduce((a, b) => a + b, 0) + gap * (tpl.cols - 1);
      const gridH = geo.gridH ?? rowHmm.reduce((a, b) => a + b, 0) + gap * (tpl.rows - 1);

      // En modo producto la grilla no llena la hoja: va centrada, igual que en
      // pantalla (justify/alignContent: center). Con medidas exactas se ancla
      // al margen, también igual que en pantalla.
      const originX = Number.isFinite(geo.originXMm)
         ? geo.originXMm
         : (geo.fixed ? (page.w - gridW) / 2 : preset.marginMm);
      const originY = Number.isFinite(geo.originYMm)
         ? geo.originYMm
         : (geo.fixed ? (page.h - gridH) / 2 : preset.marginMm);

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
    * Aplica una medida exacta a UNA celda de un eje sin tocar a las demás.
    * Devuelve el array completo de medidas del eje, tomando como base las
    * medidas actuales (`sizesMm`) para que las otras celdas conserven su tamaño.
    *
    * @param {number[]} sizesMm  medidas actuales en mm del eje
    * @param {number}   idx      celda objetivo
    * @param {number}   targetMm tamaño deseado en mm
    * @returns {number[]} medidas nuevas del eje
    */
   applyExactSize(sizesMm, idx, targetMm) {
      const next = sizesMm.map((v) => Number(v));
      if (!Number.isFinite(targetMm) || targetMm <= 0) return next;
      next[idx] = Math.max(MIN_CELL_MM, targetMm);
      return next;
   }
}
