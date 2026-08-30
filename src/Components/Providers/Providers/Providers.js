// ── Composition root ─────────────────────────────────────────────────────
// Boots every singleton service in order, then steps back. AppShell.init()
// awaits `slice.build('Providers', { singleton: true })` before mounting any
// section. After init(), recover a service anywhere with:
//   slice.getComponent('FontsCatalog') / slice.getComponent('ToastProvider')
export default class Providers {
   constructor(props) {
      this.props = props || {};
      this._ready = false;
   }

   async init() {
      if (this._ready) return this;

      // 1) Datos: catálogo de fuentes usado por Designer y Canvas.
      await slice.build('FontsCatalog', { singleton: true });

      // 2) Infraestructura compartida.
      await slice.build('HtmlService', { singleton: true });
      await slice.build('ShareService', { singleton: true });
      await slice.build('ToolTipProvider', { singleton: true });
      await slice.build('LayoutTemplates', { singleton: true });
      await slice.build('SheetGeometry', { singleton: true });

      // Estado del módulo Plantillas de Hoja: pool compartido + múltiples hojas.
      const firstSheet = {
         id: 'sheet-1',
         pageId: 'carta',
         templateId: 'm2x2',
         presetId: 'normal',
         fitMode: 'smart',
         imageScale: 1,
         placement: {}
      };
      slice.context.create('sheet', {
         activeId: firstSheet.id,
         pool: [],
         sheets: [firstSheet],
         zoom: 0.7
      });

      // 3) Estado compartido del Designer (toolbar ↔ sección ↔ cards).
      slice.context.create('designer', {
         texto: '',
         fontSize: 48,
         textColor: '#000000',
         bgColor: 'transparent',
         styles: {
            bold: false,
            italic: false,
            underline: false,
            align: 'center',
            letterSpacing: 0,
            mirrored: false,
            rotation: 0
         },
         category: 'corrido'
      });

      // 2) Notificaciones: provider único de toasts + bridge por eventos,
      //    para emitir desde cualquier punto sin acoplarse al servicio.
      const toasts = await slice.build('ToastProvider', { singleton: true });
      toasts.setPosition?.('bottom-right');

      if (slice.events?.register) {
         slice.events.register('toast', {
            show: {
               description: 'Show a toast notification',
               payload: { message: 'string', type: 'string', duration: 'number' }
            }
         });
         slice.events.subscribe('toast:show', (payload = {}) => {
            toasts.show(payload.message ?? '', {
               type: payload.type ?? 'info',
               duration: payload.duration ?? undefined
            });
         });
      }

      this._ready = true;
      return this;
   }
}
