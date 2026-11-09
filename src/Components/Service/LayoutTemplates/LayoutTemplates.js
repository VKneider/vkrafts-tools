// Catálogo de plantillas de hoja + tamaños de papel (mm).
// Una plantilla define la grilla de celdas; la relación de aspecto de cada
// celda se deriva del tamaño de página para el mecanismo de auto-asignación.
const PAGE_SIZES = {
   a4: { label: 'A4 (210×297)', w: 210, h: 297 },
   'a4-h': { label: 'A4 horizontal (297×210)', w: 297, h: 210 },
   carta: { label: 'Carta (216×279)', w: 216, h: 279 },
   'carta-h': { label: 'Carta horizontal (279×216)', w: 279, h: 216 },
   a5: { label: 'A5 (148×210)', w: 148, h: 210 },
   'a5-h': { label: 'A5 horizontal (210×148)', w: 210, h: 148 }
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

// Medidas reales de producto. Elegir una fija el tamaño de celda en mm y calcula
// cuántas entran en la hoja — a diferencia de las plantillas, donde las celdas
// se estiran para llenar la página.
const PRODUCTS = [
   { id: 'foto-10x15', name: 'Foto 10×15', wMm: 100, hMm: 150 },
   { id: 'foto-13x18', name: 'Foto 13×18', wMm: 130, hMm: 180 },
   { id: 'foto-9x13', name: 'Foto 9×13', wMm: 90, hMm: 130 },
   { id: 'carnet-3x4', name: 'Carnet 3×4', wMm: 30, hMm: 40 },
   { id: 'carnet-4x4', name: 'Carnet 4×4', wMm: 40, hMm: 40 },
   { id: 'carnet-2.5x3.5', name: 'Carnet 2,5×3,5', wMm: 25, hMm: 35 },
   { id: 'pasaporte-3.5x4.5', name: 'Pasaporte 3,5×4,5', wMm: 35, hMm: 45 },
   { id: 'sticker-5', name: 'Sticker 5×5', wMm: 50, hMm: 50 },
   { id: 'sticker-7', name: 'Sticker 7×7', wMm: 70, hMm: 70 },
   { id: 'tarjeta', name: 'Tarjeta 9×5', wMm: 90, hMm: 50 },
   { id: 'credencial', name: 'Credencial 8,6×5,4', wMm: 86, hMm: 54 },
   { id: 'etiqueta', name: 'Etiqueta 6×4', wMm: 60, hMm: 40 }
];

export default class LayoutTemplates {
   constructor(props = {}) {
      this.props = props || {};
      // Copia propia: `ensureGrid`/`ensurePreset` agregan entradas derivadas;
      // no deben contaminar el catálogo entre instancias.
      this.pageSizes = { ...PAGE_SIZES };
      this.templates = [...TEMPLATES];
      this.presets = PRESETS;
      this.products = PRODUCTS;
   }

   /** Catálogo de tamaños de producto. */
   allProducts() {
      return this.products;
   }

   product(id) {
      return this.products.find((p) => p.id === id) || null;
   }

   /**
    * Devuelve (creándola si hace falta) una plantilla con esta grilla. Los
    * productos necesitan grillas arbitrarias — 4×5 stickers, por ejemplo — que
    * no están en el catálogo fijo. Al registrarla acá, todo lo demás
    * (capacidad, geometría, splitters) sigue funcionando vía `get(id)`.
    */
   ensureGrid(cols, rows) {
      const c = Math.max(1, Math.round(cols));
      const r = Math.max(1, Math.round(rows));
      const id = `grid-${c}x${r}`;

      let tpl = this.templates.find((t) => t.id === id);
      if (!tpl) {
         tpl = { id, name: `${c} × ${r}`, cols: c, rows: r, derived: true };
         this.templates.push(tpl);
      }
      return tpl;
   }

   /**
    * Cuántas piezas de este producto entran en la hoja, respetando márgenes y
    * separación del preset.
    * @returns {{cols:number, rows:number, total:number, fits:boolean}}
    */
   gridForProduct(product, pageId, presetId) {
      const page = this.page(pageId);
      const preset = this.preset(presetId);

      const usableW = page.w - preset.marginMm * 2;
      const usableH = page.h - preset.marginMm * 2;

      // n piezas ocupan n*lado + (n-1)*gap, así que se despeja n.
      const fit = (usable, side) =>
         Math.max(0, Math.floor((usable + preset.gapMm) / (side + preset.gapMm)));

      const cols = fit(usableW, product.wMm);
      const rows = fit(usableH, product.hMm);

      return { cols, rows, total: cols * rows, fits: cols > 0 && rows > 0 };
   }

   /**
    * Devuelve (creándolo si hace falta) un preset de márgenes/separación
    * personalizado. Se rehidrata desde su id después de recargar, igual que las
    * grillas derivadas.
    * @param {number} marginMm
    * @param {number} gapMm
    * @returns {{id:string,name:string,marginMm:number,gapMm:number,derived:true}}
    */
   ensurePreset(marginMm, gapMm) {
      const m = Math.max(0, Math.min(50, Number(marginMm) || 0));
      const g = Math.max(0, Math.min(50, Number(gapMm) || 0));
      const id = `custom-${m.toFixed(1)}-${g.toFixed(1)}`;

      let preset = this.presets.find((p) => p.id === id);
      if (!preset) {
         preset = { id, name: 'Personalizado', marginMm: m, gapMm: g, derived: true };
         this.presets.push(preset);
      }
      return preset;
   }

   preset(id) {
      const found = this.presets.find((p) => p.id === id);
      if (found) return found;

      const custom = /^custom-([\d.]+)-([\d.]+)$/.exec(String(id || ''));
      if (custom) return this.ensurePreset(Number(custom[1]), Number(custom[2]));

      return this.presets[2];
   }

   createSheet(seq = 1) {
      return {
         id: `sheet-${seq}-${Date.now()}`,
         pageId: 'carta',
         templateId: 'm2x2',
         presetId: 'normal',
         fitMode: 'smart',
         imageScale: 1,
         // Sin esto, toda hoja nueva llega con `placement` undefined y el primer
         // render (`sheet.placement[idx]`) revienta la vista entera.
         placement: {}
      };
   }

   all() {
      return this.templates;
   }

   /**
    * Plantilla por id. Las grillas derivadas de un producto (`grid-3x5`) se
    * registran al elegir el producto, pero **no se persisten**: tras un F5 el id
    * queda en el estado y la tabla vuelve vacía. Sin rehidratarlas, `get()`
    * devolvía 2×2, la capacidad bajaba de 15 a 4 y el siguiente commit borraba
    * las celdas 4..14. Se reconstruyen desde el propio id.
    */
   get(id) {
      const found = this.templates.find((t) => t.id === id);
      if (found) return found;

      const m = /^grid-(\d+)x(\d+)$/.exec(String(id || ''));
      if (m) return this.ensureGrid(Number(m[1]), Number(m[2]));

      return this.templates[2];
   }

   pages() {
      return Object.entries(this.pageSizes).map(([id, p]) => ({ id, ...p }));
   }

   page(id) {
      if (this.pageSizes[id]) return this.pageSizes[id];
      return this.pageSizes.a4;
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
