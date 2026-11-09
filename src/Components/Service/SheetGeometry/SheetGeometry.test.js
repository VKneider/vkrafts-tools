import { describe, it, expect } from 'vitest';
import SheetGeometry from './SheetGeometry.js';

const TPL_2X2 = { id: 'm2x2', cols: 2, rows: 2 };
const TPL_1COL = { id: 'm2', cols: 1, rows: 2 };
const PAGE = { w: 216, h: 279 };            // Carta
const PRESET = { marginMm: 10, gapMm: 6 };  // Normal

const geom = new SheetGeometry();

describe('SheetGeometry.geometry', () => {
   it('reparte la hoja por pesos cuando no hay medidas exactas', () => {
      const g = geom.geometry(TPL_2X2, PAGE, PRESET);

      expect(g.innerW).toBe(190);
      expect(g.innerH).toBe(253);
      expect(g.colWmm).toEqual([95, 95]);
      expect(g.rowHmm).toEqual([126.5, 126.5]);
      expect(g.colFixed).toBe(false);
      expect(g.rowFixed).toBe(false);
      expect(g.originXMm).toBe(10);
      expect(g.originYMm).toBe(10);
   });

   it('respeta medidas exactas por columna sin estirar el eje', () => {
      const g = geom.geometry(TPL_2X2, PAGE, PRESET, [1, 1], [1, 1], null, {
         colsMm: [20, 20]
      });

      expect(g.colWmm).toEqual([20, 20]);
      expect(g.colFixed).toBe(true);
      expect(g.colCentered).toBe(false);
      // La grilla queda anclada al margen: 20 + 6 + 20 = 46 mm de ancho.
      expect(g.gridW).toBe(46);
      expect(g.originXMm).toBe(10);
      // El eje sin medidas exactas sigue llenando la hoja.
      expect(g.rowHmm).toEqual([126.5, 126.5]);
      expect(g.rowCentered).toBe(false);
      expect(g.originYMm).toBe(10);
   });

   it('respeta medidas exactas por fila', () => {
      const g = geom.geometry(TPL_2X2, PAGE, PRESET, [1, 1], [1, 1], null, {
         rowsMm: [30, 40]
      });

      expect(g.rowHmm).toEqual([30, 40]);
      expect(g.rowFixed).toBe(true);
      expect(g.gridH).toBe(76);
      expect(g.originYMm).toBe(10);
      expect(g.colFixed).toBe(false);
   });

   it('editar una columna no cambia el tamaño de las demás (bug reportado)', () => {
      // Estado inicial: dos columnas iguales.
      const first = geom.geometry(TPL_2X2, PAGE, PRESET);
      expect(first.colWmm).toEqual([95, 95]);

      // "Editar medidas" de la celda 0 a 2 cm.
      const colA = geom.applyExactSize(first.colWmm, 0, 20);
      const afterA = geom.geometry(TPL_2X2, PAGE, PRESET, [1, 1], [1, 1], null, {
         colsMm: colA
      });
      expect(afterA.colWmm).toEqual([20, 95]);

      // "Editar medidas" de la celda 1 a 2 cm: la 0 sigue en 2 cm.
      const colB = geom.applyExactSize(afterA.colWmm, 1, 20);
      const afterB = geom.geometry(TPL_2X2, PAGE, PRESET, [1, 1], [1, 1], null, {
         colsMm: colB
      });
      expect(afterB.colWmm).toEqual([20, 20]);
   });

   it('permite fijar el ancho en una plantilla de una sola columna', () => {
      const base = geom.geometry(TPL_1COL, PAGE, PRESET);
      expect(base.colWmm).toEqual([196]);

      const sizes = geom.applyExactSize(base.colWmm, 0, 20);
      const g = geom.geometry(TPL_1COL, PAGE, PRESET, [1, 1], [1, 1], null, {
         colsMm: sizes
      });

      expect(g.colWmm).toEqual([20]);
      expect(g.colFixed).toBe(true);
      expect(g.originXMm).toBe(10);
   });

   it('escala medidas que no entran en la hoja en vez de desbordar', () => {
      const g = geom.geometry(TPL_2X2, PAGE, PRESET, [1, 1], [1, 1], null, {
         colsMm: [200, 200]
      });

      expect(g.colWmm[0] + g.colWmm[1]).toBeCloseTo(190, 5);
      expect(g.colWmm[0]).toBeCloseTo(g.colWmm[1], 5);
   });

   it('ignora listas de medidas con longitud distinta a la plantilla', () => {
      const g = geom.geometry(TPL_2X2, PAGE, PRESET, [1, 1], [1, 1], null, {
         colsMm: [20, 20, 20]
      });

      expect(g.colFixed).toBe(false);
      expect(g.colWmm).toEqual([95, 95]);
   });

   it('mantiene el modo producto fijo con la grilla centrada', () => {
      const g = geom.geometry(TPL_2X2, PAGE, PRESET, [1, 1], [1, 1], { w: 50, h: 50 });

      expect(g.fixed).toBe(true);
      expect(g.colWmm).toEqual([50, 50]);
      expect(g.rowHmm).toEqual([50, 50]);
      expect(g.gridW).toBe(106);
      expect(g.originXMm).toBe(55);
      expect(g.originYMm).toBe((279 - 106) / 2);
   });
});

describe('SheetGeometry.applyExactSize', () => {
   it('cambia solo la celda objetivo', () => {
      expect(geom.applyExactSize([95, 95], 0, 20)).toEqual([20, 95]);
      expect(geom.applyExactSize([20, 95], 1, 20)).toEqual([20, 20]);
   });

   it('respeta el mínimo por celda', () => {
      expect(geom.applyExactSize([95, 95], 0, 5)).toEqual([15, 95]);
   });

   it('no toca nada con una medida inválida', () => {
      expect(geom.applyExactSize([95, 95], 0, NaN)).toEqual([95, 95]);
      expect(geom.applyExactSize([95, 95], 0, 0)).toEqual([95, 95]);
   });
});

describe('SheetGeometry.cellRects', () => {
   it('usa el origen de la vista con medidas exactas (anclado al margen)', () => {
      const g = geom.geometry(TPL_2X2, PAGE, PRESET, [1, 1], [1, 1], null, {
         colsMm: [20, 20]
      });
      const rects = geom.cellRects(TPL_2X2, PAGE, PRESET, g);

      expect(rects[0]).toMatchObject({ slot: 0, col: 0, row: 0, xMm: 10, wMm: 20 });
      expect(rects[1]).toMatchObject({ slot: 1, col: 1, row: 0, xMm: 36, wMm: 20 });
      expect(rects[2].yMm).toBe(rects[0].yMm + 126.5 + 6);
   });
});
