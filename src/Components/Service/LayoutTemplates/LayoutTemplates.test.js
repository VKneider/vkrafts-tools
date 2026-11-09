import { describe, it, expect } from 'vitest';
import LayoutTemplates from './LayoutTemplates.js';

describe('LayoutTemplates', () => {
   it('crea hojas con la configuración por defecto', () => {
      const tpl = new LayoutTemplates();
      const sheet = tpl.createSheet(1);
      expect(sheet.pageId).toBe('carta');
      expect(sheet.templateId).toBe('m2x2');
      expect(sheet.placement).toEqual({});
   });

   it('ensureGrid registra la grilla derivada y la devuelve en get', () => {
      const tpl = new LayoutTemplates();
      const grid = tpl.ensureGrid(3, 5);
      expect(grid.id).toBe('grid-3x5');
      expect(tpl.get('grid-3x5')).toEqual(grid);
   });

   it('get rehidrata una grilla derivada después de un F5', () => {
      // Las grillas de producto no se persisten: tras recargar, el estado
      // conserva `grid-3x5` pero el catálogo en memoria está limpio. Sin
      // rehidratar, get() devolvía 2×2 y la capacidad bajaba de 15 a 4.
      const tpl = new LayoutTemplates();
      const grid = tpl.get('grid-3x5');
      expect(grid.id).toBe('grid-3x5');
      expect(grid.cols).toBe(3);
      expect(grid.rows).toBe(5);
      expect(grid.derived).toBe(true);
   });

   it('get devuelve la plantilla por defecto para un id desconocido', () => {
      const tpl = new LayoutTemplates();
      expect(tpl.get('no-existe').id).toBe('m2x2');
   });

   it('ensurePreset registra y rehidrata márgenes personalizados', () => {
      const tpl = new LayoutTemplates();
      const preset = tpl.ensurePreset(20, 10);
      expect(preset.id).toBe('custom-20.0-10.0');
      expect(preset.marginMm).toBe(20);
      expect(preset.gapMm).toBe(10);
      expect(preset.derived).toBe(true);

      // Tras un F5 el catálogo en memoria está limpio: preset() reconstruye.
      const rehydrated = tpl.preset('custom-12.5-7.5');
      expect(rehydrated.marginMm).toBe(12.5);
      expect(rehydrated.gapMm).toBe(7.5);
   });

   it('incluye páginas horizontales con el ancho y alto intercambiados', () => {
      const tpl = new LayoutTemplates();
      expect(tpl.page('carta')).toMatchObject({ w: 216, h: 279 });
      expect(tpl.page('carta-h')).toMatchObject({ w: 279, h: 216 });
      expect(tpl.page('a4-h')).toMatchObject({ w: 297, h: 210 });
   });

   it('incluye tamaños estándar de carnet y pasaporte', () => {
      const tpl = new LayoutTemplates();
      expect(tpl.product('carnet-3x4')).toMatchObject({ wMm: 30, hMm: 40 });
      expect(tpl.product('carnet-4x4')).toMatchObject({ wMm: 40, hMm: 40 });
      expect(tpl.product('carnet-2.5x3.5')).toMatchObject({ wMm: 25, hMm: 35 });
      expect(tpl.product('pasaporte-3.5x4.5')).toMatchObject({ wMm: 35, hMm: 45 });
   });

   it('ignora un tamaño de página desconocido y cae en A4', () => {
      const tpl = new LayoutTemplates();
      expect(tpl.page('custom-200.0x300.0')).toMatchObject({ w: 210, h: 297 });
   });
});
