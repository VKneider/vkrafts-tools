import { Canvas, IText, FabricImage, Path, Rect, Circle, Triangle, Line, Polygon, Ellipse } from 'fabric';

const PRESET_COLORS = [
   ['Negro', '#000000'], ['Blanco', '#FFFFFF'], ['Rojo', '#EF4444'], ['Azul', '#3B82F6'],
   ['Verde', '#22C55E'], ['Amarillo', '#EAB308'], ['Rosa', '#EC4899'], ['Morado', '#8B5CF6']
];

function regularPoints(sides, radius) {
   const points = [];
   for (let i = 0; i < sides; i++) {
      const angle = ((Math.PI * 2) / sides) * i - Math.PI / 2;
      points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
   }
   return points;
}

function starPoints() {
   const points = [];
   const outer = 50;
   const inner = 25;
   for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
   }
   return points;
}

function heartPoints() {
   const points = [];
   const scale = 50;
   for (let t = 0; t <= 2 * Math.PI; t += 0.1) {
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      points.push({ x: (x * scale) / 16, y: (y * scale) / 16 });
   }
   return points;
}

function arrowPoints() {
   return [
      { x: -50, y: -10 }, { x: 30, y: -10 }, { x: 30, y: -20 }, { x: 60, y: 0 },
      { x: 30, y: 20 }, { x: 30, y: 10 }, { x: -50, y: 10 }
   ];
}

export default class CanvasSection extends HTMLElement {

   constructor(props) {
      super();
      slice.attachTemplate(this);

      this.$toolbar = this.querySelector('.canvassection__toolbar');
      this.$tabsSlot = this.querySelector('.canvassection__tabs');
      this.$panels = this.querySelectorAll('.canvassection__panel');
      this.$textoTitle = this.querySelector('.canvassection__texto-title');
      this.$figTitle = this.querySelector('.canvassection__fig-title');
      this.$textInputSlot = this.querySelector('.canvassection__text-input');
      this.$fontSelectSlot = this.querySelector('.canvassection__font-select');
      this.$sizeValue = this.querySelector('.canvassection__size-value');
      this.$sizeRange = this.querySelector('.canvassection__size-range');
      this.$swatchesText = this.querySelector('.canvassection__swatches--text');
      this.$customTextColor = this.querySelector('.canvassection__custom-text-color');
      this.$textToggles = this.querySelector('.canvassection__text-toggles');
      this.$addSlot = this.querySelector('.canvassection__add-slot');
      this.$shapeGrid = this.querySelector('.canvassection__shape-grid');
      this.$swatchesFill = this.querySelector('.canvassection__swatches--fill');
      this.$swatchesStroke = this.querySelector('.canvassection__swatches--stroke');
      this.$strokeValue = this.querySelector('.canvassection__stroke-value');
      this.$strokeRange = this.querySelector('.canvassection__stroke-range');
      this.$radiusRow = this.querySelector('.canvassection__radius-row');
      this.$radiusValue = this.querySelector('.canvassection__radius-value');
      this.$radiusRange = this.querySelector('.canvassection__radius-range');
      this.$brushToggle = this.querySelector('.canvassection__brush-toggle');
      this.$swatchesBrush = this.querySelector('.canvassection__swatches--brush');
      this.$customBrushColor = this.querySelector('.canvassection__custom-brush-color');
      this.$brushValue = this.querySelector('.canvassection__brush-value');
      this.$brushRange = this.querySelector('.canvassection__brush-range');
      this.$transform = this.querySelector('.canvassection__transform');
      this.$stage = this.querySelector('.canvassection__stage');
      this.$checker = this.querySelector('.canvassection__checker');
      this.$canvasEl = this.querySelector('.canvassection__canvas');
      this.$menu = this.querySelector('.canvassection__menu');
      this.$menuSlot = this.querySelector('.canvassection__menu-slot');

      slice.controller.setComponentProps(this, props);
   }

   async init() {
      // Servicios singletons booteados por Providers (composition root).
      this._catalog = slice.getComponent('FontsCatalog');
      this._toasts = slice.getComponent('ToastProvider');

      // --- estado (migrado de los useState de vkrafts2) ---
      this._selectedObject = null;
      this._copiedObject = null;
      this._textValue = 'Texto';
      this._selectedFont = this._catalog.getAll()[0];
      this._fontSize = 48;
      this._textColor = '#000000';
      this._shapeFill = 'transparent';
      this._shapeStroke = '#000000';
      this._shapeStrokeWidth = 2;
      this._shapeCornerRadius = 0;
      this._isBrushMode = false;
      this._brushColor = '#000000';
      this._brushWidth = 5;
      this._activeTab = 'texto';
      this._history = [];
      this._historyIndex = -1;

      await this._buildToolbar();
      await this._buildTabs();
      await this._buildTextPanel();
      await this._buildShapesPanel();
      await this._buildDrawingPanel();

      this._initFabric();
      this._bindDocumentListeners();

      // Tooltips del registry para toolbar, shapes y controles marcados.
      slice.getComponent('ToolTipProvider')?.scope(this);
   }

   update() {
      this.resizeCanvas();
   }

   beforeDestroy() {
      window.removeEventListener('resize', this._onResize);
      document.removeEventListener('keydown', this._onKeyDown);
      document.removeEventListener('paste', this._onPaste);
      document.removeEventListener('click', this._onDocClickHideMenu);
      this.$stage?.removeEventListener('contextmenu', this._onContextMenu);
      const tips = slice.getComponent('ToolTipProvider');
      if (tips) {
         this.querySelectorAll('[data-tooltip]').forEach((el) => tips.detach(el));
      }
      if (this._fabric) {
         this._fabric.dispose();
         this._fabric = null;
      }
   }

   // ---------- construcción de UI con componentes Slice ----------

   async _toolbarButton(def) {
      const btn = await slice.build('Button', {
         value: def.value ?? '',
         icon: def.icon ? { name: def.icon } : null,
         variant: def.variant || 'outlined',
         size: 'sm',
         onClick: def.onClick
      });
      if (!btn) return null;
      if (def.title) {
         btn.dataset.tooltip = def.title;
         btn.dataset.tooltipPlacement = 'bottom';
      }
      if (def.key) btn.dataset.key = def.key;
      this.$toolbar.appendChild(btn);
      return btn;
   }

   async _buildToolbar() {
      this._btnUndo = await this._toolbarButton({
         icon: 'undo-2', title: 'Deshacer (Ctrl+Z)', key: 'undo',
         onClick: () => this.undo()
      });
      this._btnRedo = await this._toolbarButton({
         icon: 'redo-2', title: 'Rehacer (Ctrl+Y)', key: 'redo',
         onClick: () => this.redo()
      });
      await this._toolbarButton({
         value: 'PNG', icon: 'download', title: 'Exportar PNG',
         onClick: () => this.exportAsPNG()
      });
      await this._toolbarButton({
         value: 'SVG', icon: 'file-text', title: 'Exportar SVG',
         onClick: () => this.exportAsSVG()
      });
      await this._toolbarButton({
         value: 'Limpiar', icon: 'trash-2', variant: 'danger', title: 'Limpiar canvas',
         onClick: () => this.clearCanvas()
      });

      const deleteBtn = await slice.build('Button', {
         value: 'Eliminar', icon: { name: 'trash-2' }, variant: 'danger', size: 'sm',
         onClick: () => this.deleteSelected()
      });
      if (deleteBtn) this.$menuSlot.appendChild(deleteBtn);

      this._refreshHistoryButtons();
   }

   async _buildTabs() {
      const tabs = await slice.build('Tabs', {
         items: [
            { id: 'texto', label: 'Texto' },
            { id: 'figuras', label: 'Figuras' },
            { id: 'dibujo', label: 'Dibujo' }
         ],
         activeTab: this._activeTab,
         onChange: (id) => this.switchTab(id)
      });
      if (tabs) this.$tabsSlot.appendChild(tabs);
      this._tabs = tabs;
      this._applyPanelsVisibility();
   }

   switchTab(id) {
      this._activeTab = id;
      if (this._tabs && this._tabs.activeTab !== id) this._tabs.activeTab = id;
      this._applyPanelsVisibility();
   }

   _applyPanelsVisibility() {
      this.$panels.forEach((p) => { p.hidden = p.dataset.panel !== this._activeTab; });
   }

   async _panelButton(parent, def) {
      const btn = await slice.build('Button', {
         value: def.value ?? '',
         icon: def.icon ? { name: def.icon } : null,
         variant: def.variant || 'outlined',
         size: 'sm',
         onClick: def.onClick
      });
      if (!btn) return null;
      if (def.title) {
         btn.dataset.tooltip = def.title;
         btn.dataset.tooltipPlacement = 'bottom';
      }
      if (def.key) btn.dataset.key = def.key;
      parent.appendChild(btn);
      return btn;
   }

   async _buildTextPanel() {
      const input = await slice.build('Input', { placeholder: 'Escribe el texto...' });
      if (input) {
         input.addEventListener('input', () => {
            this._textValue = input.value;
            if (this._isTextSelected()) this._selectedObject.set('text', input.value);
            this._fabric?.renderAll();
         });
         this._textInput = input;
         this.$textInputSlot.appendChild(input);
      }

      const options = this._catalog.getAll().map((f) => ({ ...f, text: `${f.codigo} · ${f.fontFamily}` }));
      this._fontOptions = options;
      const select = await slice.build('Select', {
         options,
         visibleProp: 'text',
         searchable: true,
         placeholder: 'Fuente',
         onChange: () => {
            const val = select.value;
            if (Array.isArray(val)) return;
            this._selectedFont = val;
            if (this._isTextSelected()) {
               this._selectedObject.set('fontFamily', val.fontFamily);
               this._fabric.renderAll();
            }
         }
      });
      if (select) {
         select.value = [options[0]];
         this._fontSelect = select;
         this.$fontSelectSlot.appendChild(select);
      }

      this.$sizeRange.addEventListener('input', () => {
         this._fontSize = Number(this.$sizeRange.value);
         this.$sizeValue.textContent = String(this._fontSize);
         if (this._isTextSelected()) {
            this._selectedObject.set('fontSize', this._fontSize);
            this._fabric.renderAll();
         }
      });

      this._makeSwatches(this.$swatchesText, PRESET_COLORS, () => this._textColor, (v) => {
         this._textColor = v;
         this.$customTextColor.value = v;
         if (this._isTextSelected()) {
            this._selectedObject.set('fill', v);
            this._fabric.renderAll();
         }
      });
      this.$customTextColor.addEventListener('input', () => {
         this._textColor = this.$customTextColor.value;
         if (this._isTextSelected()) {
            this._selectedObject.set('fill', this._textColor);
            this._fabric.renderAll();
         }
      });

      this._btnBold = await this._panelButton(this.$textToggles, {
         icon: 'bold', title: 'Negrita', key: 'bold', onClick: () => this.toggleTextProp('fontWeight')
      });
      this._btnItalic = await this._panelButton(this.$textToggles, {
         icon: 'italic', title: 'Cursiva', key: 'italic', onClick: () => this.toggleTextProp('fontStyle')
      });
      this._btnUnderline = await this._panelButton(this.$textToggles, {
         icon: 'underline', title: 'Subrayado', key: 'underline', onClick: () => this.toggleTextProp('underline')
      });

      this._addBtn = await this._panelButton(this.$addSlot, {
         value: 'Agregar Texto', variant: 'filled',
         onClick: () => this.addOrUpdateText()
      });
      this.$textToggles.hidden = true;
   }

   async _buildShapesPanel() {
      const shapes = [
         ['Rectángulo', 'square', () => this.addRectangle()],
         ['Círculo', 'circle', () => this.addCircle()],
         ['Triángulo', 'triangle', () => this.addTriangle()],
         ['Estrella', 'star', () => this.addStar()],
         ['Línea', 'minus', () => this.addLine()],
         ['Hexágono', 'hexagon', () => this.addHexagon()],
         ['Pentágono', 'pentagon', () => this.addPentagon()],
         ['Elipse', 'egg', () => this.addEllipse()],
         ['Flecha', 'arrow-right', () => this.addArrow()],
         ['Corazón', 'heart', () => this.addHeart()],
         ['Diamante', 'diamond', () => this.addDiamond()]
      ];
      for (const [title, icon, fn] of shapes) {
         await this._panelButton(this.$shapeGrid, { icon, title, onClick: fn });
      }

      const fillPresets = [['Transparente', 'transparent'], ...PRESET_COLORS];
      this._makeSwatches(this.$swatchesFill, fillPresets, () => this._shapeFill, (v) => {
         this._shapeFill = v;
         if (this._isShapeSelected()) this.updateSelectedShape('fill', v);
      });
      this._makeSwatches(this.$swatchesStroke, PRESET_COLORS, () => this._shapeStroke, (v) => {
         this._shapeStroke = v;
         if (this._isShapeSelected()) this.updateSelectedShape('stroke', v);
      });

      this.$strokeRange.addEventListener('input', () => {
         this._shapeStrokeWidth = Number(this.$strokeRange.value);
         this.$strokeValue.textContent = String(this._shapeStrokeWidth);
         if (this._isShapeSelected()) this.updateSelectedShape('strokeWidth', this._shapeStrokeWidth);
      });

      this.$radiusRange.addEventListener('input', () => {
         this._shapeCornerRadius = Number(this.$radiusRange.value);
         this.$radiusValue.textContent = String(this._shapeCornerRadius);
         if (this._isShapeSelected()) this.updateSelectedShape('rx', this._shapeCornerRadius);
      });
   }

   async _buildDrawingPanel() {
      this._brushBtn = await this._panelButton(this.$brushToggle, {
         // `_panelButton` ya envuelve el icono en `{ name: def.icon }`: acá va el
         // nombre, no el objeto (si no, Icon recibía `name: { name: ... }`).
         value: 'Modo Pincel', icon: 'paintbrush', variant: 'outlined',
         onClick: () => this.toggleBrushMode()
      });

      this._makeSwatches(this.$swatchesBrush, PRESET_COLORS, () => this._brushColor, (v) => {
         this._brushColor = v;
         this.$customBrushColor.value = v;
      });
      this.$customBrushColor.addEventListener('input', () => {
         this._brushColor = this.$customBrushColor.value;
      });

      this.$brushRange.addEventListener('input', () => {
         this._brushWidth = Number(this.$brushRange.value);
         this.$brushValue.textContent = String(this._brushWidth);
      });
   }

   _makeSwatches(container, presets, getCurrent, onPick) {
      const buttons = presets.map(([label, value]) => {
         const b = document.createElement('button');
         b.type = 'button';
         b.className = 'canvassection__swatch';
         b.dataset.value = value;
         b.title = label;
         b.addEventListener('click', () => onPick(value));
         container.appendChild(b);
         return b;
      });
      const repaint = () => {
         const current = getCurrent();
         buttons.forEach((b) => {
            const v = b.dataset.value;
            b.classList.toggle('canvassection__swatch--active', v === current);
            b.style.background = v === 'transparent'
               ? 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px'
               : v;
         });
      };
      repaint();
      container._repaint = repaint;
   }

   // ---------- fabric ----------

   _initFabric() {
      const fabric = new Canvas(this.$canvasEl, {
         width: this.$checker.clientWidth,
         height: this.$checker.clientHeight,
         backgroundColor: 'transparent',
         selection: true
      });
      this._fabric = fabric;

      fabric.on('selection:created', (e) => this._setSelected(e.selected?.[0] || null));
      fabric.on('selection:updated', (e) => this._setSelected(e.selected?.[0] || null));
      fabric.on('selection:cleared', () => this._setSelected(null));

      const saveState = () => this._saveState();
      fabric.on('object:added', saveState);
      fabric.on('object:modified', saveState);
      fabric.on('object:removed', saveState);

      this._history = [JSON.stringify(fabric.toJSON())];
      this._historyIndex = 0;
      this._refreshHistoryButtons();

      fabric.on('mouse:down', this._onMouseDown = (e) => this.brushDown(e));
      fabric.on('mouse:move', this._onMouseMove = (e) => this.brushMove(e));
      fabric.on('mouse:up', this._onMouseUp = () => this.brushUp());
      this.applyBrushMode();
   }

   _bindDocumentListeners() {
      window.addEventListener('resize', this._onResize = () => this.resizeCanvas());
      document.addEventListener('keydown', this._onKeyDown = (e) => this.handleKeyDown(e));
      document.addEventListener('paste', this._onPaste = (e) => this.handlePaste(e));
      document.addEventListener('click', this._onDocClickHideMenu = () => { this.$menu.hidden = true; });

      this.$stage.addEventListener('contextmenu', this._onContextMenu = (e) => {
         e.preventDefault();
         if (!this._fabric) return;
         const target = this._fabric.findTarget(e, false);
         this.$menu.hidden = !target;
         if (target) {
            this.$menu.style.left = `${e.clientX}px`;
            this.$menu.style.top = `${e.clientY}px`;
         }
      });
   }

   resizeCanvas() {
      if (!this._fabric || !this.isConnected) return;
      this._fabric.setDimensions({
         width: this.$checker.clientWidth,
         height: this.$checker.clientHeight
      });
      this._fabric.renderAll();
   }

   _pointer(e) {
      const rect = this._fabric.upperCanvasEl.getBoundingClientRect();
      return { x: e.e.clientX - rect.left, y: e.e.clientY - rect.top };
   }

   // ---------- selección ----------

   _setSelected(obj) {
      this._selectedObject = obj || null;
      this._applySelectionUI();
   }

   _isTextSelected() {
      return this._selectedObject?.type === 'i-text' || this._selectedObject?.type === 'IText';
   }

   _isShapeSelected() {
      return !!this._selectedObject &&
         ['rect', 'circle', 'triangle', 'line', 'polygon', 'ellipse'].includes(this._selectedObject.type);
   }

   _applySelectionUI() {
      const obj = this._selectedObject;
      const isText = this._isTextSelected();
      const isShape = this._isShapeSelected();

      this.$transform.hidden = !obj;
      this.$textToggles.hidden = !isText;
      this.$shapeGrid.hidden = isShape;
      this._addBtn && (this._addBtn.hidden = !!obj);

      this.$textoTitle.textContent = isText ? 'Editar Texto' : 'Agregar Texto';
      this.$figTitle.textContent = isShape ? 'Editar Figura' : 'Agregar Figura';

      if (obj && isText) {
         this._textInput.value = obj.text || '';
         const match = this._fontOptions.find((o) => o.fontFamily === obj.fontFamily);
         if (match && this._fontSelect) this._fontSelect.value = [match];
         this._fontSize = obj.fontSize || 48;
         this.$sizeRange.value = String(this._fontSize);
         this.$sizeValue.textContent = String(this._fontSize);
         this._textColor = obj.fill || '#000000';
         this.$customTextColor.value = this._textColor;
         this.$swatchesText._repaint?.();
         this._paintTextToggles(obj);
         if (this._isBrushMode) this.toggleBrushMode();
         this.switchTab('texto');
      } else if (obj && isShape) {
         const fill = obj.fill == null ? 'transparent' : obj.fill;
         this._shapeFill = fill;
         this._shapeStroke = obj.stroke || '#000000';
         this._shapeStrokeWidth = obj.strokeWidth || 2;
         this.$strokeRange.value = String(this._shapeStrokeWidth);
         this.$strokeValue.textContent = String(this._shapeStrokeWidth);
         const rounded = obj.type === 'rect' || obj.type === 'polygon';
         this.$radiusRow.hidden = !rounded;
         if (rounded) {
            this._shapeCornerRadius = obj.rx || 0;
            this.$radiusRange.value = String(this._shapeCornerRadius);
            this.$radiusValue.textContent = String(this._shapeCornerRadius);
         }
         this.$swatchesFill._repaint?.();
         this.$swatchesStroke._repaint?.();
         if (this._isBrushMode) this.toggleBrushMode();
         this.switchTab('figuras');
      } else if (!obj) {
         this.$radiusRow.hidden = true;
      }
   }

   _paintTextToggles(obj) {
      const states = {
         bold: obj.get('fontWeight') === 'bold',
         italic: obj.get('fontStyle') === 'italic',
         underline: !!obj.get('underline')
      };
      Object.entries(states).forEach(([key, active]) => {
         const btn = this.$textToggles.querySelector(`[data-key="${key}"]`);
         if (btn) btn.classList.toggle('canvassection__toggle--on', active);
      });
   }

   // ---------- texto ----------

   addOrUpdateText() {
      if (!this._fabric) return;
      if (this._selectedObject && this._isTextSelected()) {
         this._selectedObject.set({
            text: this._textValue,
            fontFamily: this._selectedFont.fontFamily,
            fontSize: this._fontSize,
            fill: this._textColor
         });
      } else {
         const text = new IText(this._textValue, {
            left: this._fabric.width / 2 - 100,
            top: this._fabric.height / 2 - 30,
            fontFamily: this._selectedFont.fontFamily,
            fontSize: this._fontSize,
            fill: this._textColor
         });
         this._fabric.add(text);
         this._fabric.setActiveObject(text);
      }
      this._fabric.renderAll();
   }

   toggleTextProp(prop) {
      if (!this._isTextSelected()) return;
      const obj = this._selectedObject;
      let next;
      if (prop === 'fontWeight') next = obj.get('fontWeight') === 'bold' ? 'normal' : 'bold';
      else if (prop === 'fontStyle') next = obj.get('fontStyle') === 'italic' ? 'normal' : 'italic';
      else next = !obj.get(prop);
      obj.set(prop, next);
      this._paintTextToggles(obj);
      this._fabric.renderAll();
   }

   // ---------- figuras ----------

   _addShape(shape) {
      this._fabric.add(shape);
      this._fabric.setActiveObject(shape);
      this._fabric.renderAll();
   }

   addRectangle() {
      this._addShape(new Rect({
         left: this._fabric.width / 2, top: this._fabric.height / 2,
         width: 100, height: 100,
         fill: this._shapeFill, stroke: this._shapeStroke, strokeWidth: this._shapeStrokeWidth,
         rx: this._shapeCornerRadius, ry: this._shapeCornerRadius,
         originX: 'center', originY: 'center'
      }));
   }

   addCircle() {
      this._addShape(new Circle({
         left: this._fabric.width / 2, top: this._fabric.height / 2, radius: 50,
         fill: this._shapeFill, stroke: this._shapeStroke, strokeWidth: this._shapeStrokeWidth,
         originX: 'center', originY: 'center'
      }));
   }

   addTriangle() {
      this._addShape(new Triangle({
         left: this._fabric.width / 2, top: this._fabric.height / 2, width: 100, height: 100,
         fill: this._shapeFill, stroke: this._shapeStroke, strokeWidth: this._shapeStrokeWidth,
         originX: 'center', originY: 'center'
      }));
   }

   addLine() {
      this._addShape(new Line([0, 0, 150, 0], {
         left: this._fabric.width / 2 - 75, top: this._fabric.height / 2,
         stroke: this._shapeStroke, strokeWidth: this._shapeStrokeWidth,
         originX: 'center', originY: 'center'
      }));
   }

   addEllipse() {
      this._addShape(new Ellipse({
         left: this._fabric.width / 2, top: this._fabric.height / 2, rx: 60, ry: 40,
         fill: this._shapeFill, stroke: this._shapeStroke, strokeWidth: this._shapeStrokeWidth,
         originX: 'center', originY: 'center'
      }));
   }

   addPolygon(points) {
      this._addShape(new Polygon(points, {
         left: this._fabric.width / 2, top: this._fabric.height / 2,
         fill: this._shapeFill, stroke: this._shapeStroke, strokeWidth: this._shapeStrokeWidth,
         rx: this._shapeCornerRadius, ry: this._shapeCornerRadius,
         originX: 'center', originY: 'center'
      }));
   }

   addStar() { this.addPolygon(starPoints()); }
   addHexagon() { this.addPolygon(regularPoints(6, 50)); }
   addPentagon() { this.addPolygon(regularPoints(5, 50)); }
   addDiamond() {
      this.addPolygon([{ x: 0, y: -50 }, { x: 50, y: 0 }, { x: 0, y: 50 }, { x: -50, y: 0 }]);
   }
   addArrow() { this.addPolygon(arrowPoints()); }
   addHeart() { this.addPolygon(heartPoints()); }

   updateSelectedShape(property, value) {
      if (!this._fabric || !this._selectedObject || !this._isShapeSelected()) return;
      this._selectedObject.set(property, value);
      if (property === 'rx') this._selectedObject.set('ry', value);
      this._fabric.renderAll();
   }

   // ---------- pincel ----------

   toggleBrushMode() {
      this._isBrushMode = !this._isBrushMode;
      this.applyBrushMode();
      this._toasts?.show(this._isBrushMode ? 'Modo pincel activado' : 'Modo selección activado', { type: 'info', duration: 1800 });
   }

   applyBrushMode() {
      if (!this._fabric) return;
      if (this._isBrushMode) {
         this._fabric.selection = false;
         this._fabric.defaultCursor = 'crosshair';
         this._fabric.hoverCursor = 'crosshair';
         this._brushBtn?.classList.add('canvassection__toggle--on');
      } else {
         this._fabric.selection = true;
         this._fabric.defaultCursor = 'default';
         this._fabric.hoverCursor = 'move';
         this._brushBtn?.classList.remove('canvassection__toggle--on');
         this._drawing = false;
         this._currentPath = null;
      }
      this._fabric.renderAll();
   }

   brushDown(e) {
      if (!this._isBrushMode) return;
      const pointer = this._pointer(e);
      const path = new Path(`M ${pointer.x} ${pointer.y}`, {
         stroke: this._brushColor,
         strokeWidth: this._brushWidth,
         fill: null,
         strokeLineCap: 'round',
         strokeLineJoin: 'round',
         selectable: false,
         evented: false
      });
      this._fabric.add(path);
      this._currentPath = path;
      this._drawing = true;
   }

   brushMove(e) {
      if (!this._isBrushMode || !this._drawing || !this._currentPath) return;
      const pointer = this._pointer(e);
      if (Array.isArray(this._currentPath.path)) {
         this._currentPath.path.push(['L', pointer.x, pointer.y]);
         this._currentPath.set({ dirty: true });
      }
      this._fabric.renderAll();
   }

   brushUp() {
      if (!this._isBrushMode) return;
      this._drawing = false;
      if (this._currentPath) {
         this._currentPath.set({ selectable: true, evented: true });
      }
      this._currentPath = null;
   }

   // ---------- transformaciones / borrado ----------

   flipHorizontal() {
      if (!this._selectedObject || !this._fabric) return;
      this._selectedObject.set('flipX', !this._selectedObject.flipX);
      this._fabric.renderAll();
   }

   rotate90() {
      if (!this._selectedObject || !this._fabric) return;
      const current = this._selectedObject.angle || 0;
      this._selectedObject.rotate(current + 90);
      this._fabric.renderAll();
   }

   deleteSelected() {
      if (!this._fabric) return;
      const active = this._fabric.getActiveObject();
      if (!active) return;

      const isMulti = ['activeselection', 'activeSelection', 'ActiveSelection'].includes(active.type)
         || Array.isArray(active._objects);
      const objects = isMulti && typeof active.getObjects === 'function' ? active.getObjects() : [active];

      // Una sola entrada de historial para toda la selección: antes borrar
      // cinco objetos costaba cinco Ctrl+Z para recuperarlos.
      this._batch(() => {
         objects.forEach((o) => this._fabric.remove(o));
         this._fabric.discardActiveObject();
      });

      this._setSelected(null);
      this._fabric.renderAll();
      this.$menu.hidden = true;
      this._toasts?.show(`${objects.length > 1 ? `${objects.length} elementos` : 'Elemento'} eliminado`, { type: 'success', duration: 1800 });
   }

   /**
    * Con `_batch` vaciar el canvas ya se deshace con un solo Ctrl+Z, pero la
    * confirmación se queda: es un botón que borra TODO, y contar con que el
    * usuario conozca el atajo no es una red de seguridad.
    */
   clearCanvas() {
      if (!this._fabric) return;
      const objects = this._fabric.getObjects();
      if (objects.length === 0) {
         this._toasts?.show('El canvas ya está vacío', { type: 'info' });
         return;
      }

      slice.events.emit('confirm:request', {
         title: 'Vaciar el canvas',
         message: `Se eliminan los ${objects.length} elementos del lienzo.`,
         confirmLabel: 'Vaciar',
         danger: true,
         onConfirm: () => this._doClearCanvas(objects)
      });
   }

   _doClearCanvas(objects) {
      this._batch(() => objects.forEach((o) => this._fabric.remove(o)));
      this._fabric.renderAll();
      this._setSelected(null);
      this._toasts?.show(`${objects.length} elementos eliminados del canvas`, { type: 'success' });
   }

   // ---------- historial ----------

   /**
    * Agrupa varias operaciones en UNA sola entrada de historial.
    *
    * `object:added` / `object:removed` guardan estado en cada disparo, así que
    * cualquier operación en bucle (borrar una selección múltiple, vaciar el
    * canvas) generaba una entrada por objeto: deshacer un canvas de veinte
    * elementos eran veinte Ctrl+Z. Acá se silencia el historial durante el
    * bucle y se guarda una única vez al final.
    */
   _batch(fn) {
      const previous = this._skipHistory;
      this._skipHistory = true;
      try {
         fn();
      } finally {
         this._skipHistory = previous;
      }
      this._saveState();
   }

   _saveState() {
      if (!this._fabric || this._skipHistory) return;
      const json = JSON.stringify(this._fabric.toJSON());
      this._history = this._history.slice(0, this._historyIndex + 1);
      this._history.push(json);
      if (this._history.length > 50) {
         this._history.shift();
      } else {
         this._historyIndex++;
      }
      this._refreshHistoryButtons();
   }

   _restore(index) {
      if (!this._fabric) return;
      this._skipHistory = true;
      this._fabric.loadFromJSON(JSON.parse(this._history[index])).then(() => {
         this._fabric.renderAll();
         this._historyIndex = index;
         this._setSelected(null);
         this._skipHistory = false;
         this._refreshHistoryButtons();
      });
   }

   undo() {
      if (!this._fabric || this._historyIndex <= 0) return;
      this._restore(this._historyIndex - 1);
   }

   redo() {
      if (!this._fabric || this._historyIndex >= this._history.length - 1) return;
      this._restore(this._historyIndex + 1);
   }

   _refreshHistoryButtons() {
      if (this._btnUndo) this._btnUndo.disabled = this._historyIndex <= 0;
      if (this._btnRedo) this._btnRedo.disabled = this._historyIndex >= this._history.length - 1;
   }

   // ---------- exportación ----------

   // Las descargas pasan por DownloadService: hacerlo a mano acá dejaba el
   // anchor fuera del documento (Firefox ignora el click) y revocaba la object
   // URL en la línea siguiente, lo que cancelaba la descarga del SVG.
   get _downloads() {
      return slice.getComponent('DownloadService');
   }

   exportAsPNG() {
      if (!this._fabric) return;
      const href = this._fabric.toDataURL({ format: 'png', quality: 1, multiplier: 2 });
      this._downloads?.url(href, 'canvas-design.png');
   }

   exportAsSVG() {
      if (!this._fabric) return;
      this._downloads?.text(
         this._fabric.toSVG(),
         'canvas-design.svg',
         'image/svg+xml;charset=utf-8'
      );
   }

   // ---------- teclado y portapapeles ----------

   handleKeyDown(e) {
      if (!this._fabric) return;
      const active = this._fabric.getActiveObject();
      const editing = active instanceof IText && active.isEditing;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey && !editing) {
         e.preventDefault(); this.undo(); return;
      }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) && !editing) {
         e.preventDefault(); this.redo(); return;
      }
      if (mod && e.key.toLowerCase() === 'c' && !editing && active) {
         this._copiedObject = active;
         this._toasts?.show('Elemento copiado', { type: 'success', duration: 1500 });
         return;
      }
      if (mod && e.key.toLowerCase() === 'v' && !editing && this._copiedObject) {
         e.preventDefault();
         this.pasteCopied();
         return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editing && active) {
         e.preventDefault(); this.deleteSelected();
      }
   }

   async pasteCopied() {
      if (!this._fabric || !this._copiedObject) return;
      const cloned = await this._copiedObject.clone();
      cloned.set({ left: (cloned.left || 0) + 20, top: (cloned.top || 0) + 20 });
      this._fabric.add(cloned);
      this._fabric.setActiveObject(cloned);
      this._fabric.renderAll();
      this._toasts?.show('Elemento pegado', { type: 'success', duration: 1500 });
   }

   handlePaste(e) {
      if (!this._fabric) return;
      const active = this._fabric.getActiveObject();
      if ((active instanceof IText && active.isEditing) || this._copiedObject) return;

      const items = e.clipboardData?.items;
      if (items) {
         for (const item of Array.from(items)) {
            if (item.type.startsWith('image/')) {
               e.preventDefault();
               const blob = item.getAsFile();
               if (blob) {
                  const reader = new FileReader();
                  reader.onload = async (event) => {
                     const img = await FabricImage.fromURL(event.target?.result);
                     const maxSize = Math.min(this._fabric.width, this._fabric.height) * 0.6;
                     const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                     img.scale(scale);
                     img.set({
                        left: this._fabric.width / 2,
                        top: this._fabric.height / 2,
                        originX: 'center',
                        originY: 'center'
                     });
                     this._fabric.add(img);
                     this._fabric.setActiveObject(img);
                     this._fabric.renderAll();
                     this._toasts?.show('Imagen pegada', { type: 'success' });
                  };
                  reader.readAsDataURL(blob);
               }
               return;
            }
         }
      }

      const clipboardText = e.clipboardData?.getData('text');
      if (clipboardText) {
         e.preventDefault();
         const text = new IText(clipboardText, {
            left: this._fabric.width / 2 - 50 + Math.random() * 50,
            top: this._fabric.height / 2 - 20 + Math.random() * 50,
            fontFamily: this._selectedFont.fontFamily,
            fontSize: this._fontSize,
            fill: this._textColor,
            originX: 'center',
            originY: 'center'
         });
         this._fabric.add(text);
         this._fabric.setActiveObject(text);
         this._fabric.renderAll();
         this._toasts?.show('Texto pegado desde el portapapeles', { type: 'success' });
      }
   }
}

customElements.define('slice-canvas-section', CanvasSection);
