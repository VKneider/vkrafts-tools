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
});
