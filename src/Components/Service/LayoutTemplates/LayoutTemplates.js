// Catálogo de plantillas de hoja + tamaños de papel (mm).
// Una plantilla define la grilla de celdas; la relación de aspecto de cada
// celda se deriva del tamaño de página para el mecanismo de auto-asignación.
const PAGE_SIZES = {
   a4: { label: 'A4 (210×297)', w: 210, h: 297 },
   carta: { label: 'Carta (216×279)', w: 216, h: 279 },
   a5: { label: 'A5 (148×210)', w: 148, h: 210 }
};

const TEMPLATES = [
   { id: 'x1', name: '1 por hoja', cols: 1, rows: 1 },
   { id: 'm2', name: '2 × 1', cols: 1, rows: 2 },
   { id: 'm2x2', name: '2 × 2', cols: 2, rows: 2 },
   { id: 'm2x3', name: '2 × 3', cols: 2, rows: 3 },
   { id: 'm3x3', name: '3 × 3', cols: 3, rows: 3 },
   { id: 'm3x4', name: '3 × 4', cols: 3, rows: 4 },
   { id: 'tira4', name: 'Tira ×4', cols: 4, rows: 1 }
];

const PRESETS = [
   { id: 'none', name: 'Sin margen', marginMm: 0, gapMm: 0 },
   { id: 'compact', name: 'Compacto', marginMm: 5, gapMm: 3 },
   { id: 'normal', name: 'Normal', marginMm: 10, gapMm: 6 },
   { id: 'wide', name: 'Amplio', marginMm: 16, gapMm: 12 }
];

export default class LayoutTemplates {
   constructor(props = {}) {
      this.props = props || {};
      this.pageSizes = PAGE_SIZES;
      this.templates = TEMPLATES;
      this.presets = PRESETS;
   }

   preset(id) {
      return this.presets.find((p) => p.id === id) || this.presets[2];
   }

   createSheet(seq = 1) {
      return {
         id: `sheet-${seq}-${Date.now()}`,
         pageId: 'carta',
         templateId: 'm2x2',
         presetId: 'normal',
         fitMode: 'smart',
         imageScale: 1
      };
   }

   all() {
      return this.templates;
   }

   get(id) {
      return this.templates.find((t) => t.id === id) || this.templates[2];
   }

   pages() {
      return Object.entries(this.pageSizes).map(([id, p]) => ({ id, ...p }));
   }

   page(id) {
      return this.pageSizes[id] || this.pageSizes.a4;
   }

   /**
    * Relación de aspecto (w/h) de cada celda para una plantilla + página,
    * descontando márgenes y gap proporcionalmente.
    */
   cellAspect(templateId, pageId, marginMm, gapMm) {
      const t = this.get(templateId);
      const page = this.page(pageId);
      const innerW = page.w - marginMm * 2 - gapMm * (t.cols - 1);
      const innerH = page.h - marginMm * 2 - gapMm * (t.rows - 1);
      return innerW / t.cols / (innerH / t.rows);
   }
}
