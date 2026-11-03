import {
   Archive,
   ArrowLeft,
   ArrowRight,
   Bold,
   Calendar,
   ChartColumn,
   Check,
   ChevronDown,
   ChevronLeft,
   Copy,
   createElement,
   Diamond,
   Download,
   Egg,
   EllipsisVertical,
   Expand,
   FileText,
   FlipHorizontal2,
   FolderOpen,
   GitMerge,
   Globe,
   Heart,
   Hexagon,
   Image,
   Info,
   Italic,
   Layers,
   List,
   Menu,
   Minimize,
   Minus,
   Package,
   Paintbrush,
   Palette,
   Pen,
   PenTool,
   Pentagon,
   Plus,
   RefreshCw,
   RotateCw,
   Shield,
   Share2,
   Sparkles,
   SquareCheckBig,
   Square,
   Star,
   TextAlignCenter,
   TextAlignEnd,
   TextAlignStart,
   Trash2,
   Triangle,
   Type,
   Underline,
   Undo2,
   Redo2,
   Users,
   Moon,
   Sun,
   Lock,
   Printer,
   LayoutGrid,
   Images,
   WandSparkles,
   X,
   Circle,
   CircleCheck,
   ZoomIn,
   ZoomOut
} from 'lucide';

// Lucide IconNode registry. Public names are kebab-case; add an entry here to
// expose any other lucide icon (tree-shaking keeps the bundle to what is listed).
const ICONS = {
   'align-center': TextAlignCenter,
   'align-left': TextAlignStart,
   'align-right': TextAlignEnd,
   'archive': Archive,
   'arrow-left': ArrowLeft,
   'arrow-right': ArrowRight,
   'bar-chart-3': ChartColumn,
   'bold': Bold,
   'calendar': Calendar,
   'chart-column': ChartColumn,
   'check': Check,
   'chevron-down': ChevronDown,
   'chevron-left': ChevronLeft,
   'circle': Circle,
   'circle-check': CircleCheck,
   'copy': Copy,
   'diamond': Diamond,
   'dots-vertical': EllipsisVertical,
   'download': Download,
   'egg': Egg,
   'expand': Expand,
   'file-text': FileText,
   'flip-horizontal-2': FlipHorizontal2,
   'folder-open': FolderOpen,
   'git-merge': GitMerge,
   'globe': Globe,
   'heart': Heart,
   'hexagon': Hexagon,
   'image': Image,
   'images': Images,
   'info-circle': Info,
   'italic': Italic,
   'layers': Layers,
   'list': List,
   'menu': Menu,
   'minimize': Minimize,
   'minus': Minus,
   'moon': Moon,
   'sun': Sun,
   'lock': Lock,
   'printer': Printer,
   'layout-grid': LayoutGrid,
   'grid-2x2': LayoutGrid,
   'package': Package,
   'paintbrush': Paintbrush,
   'palette': Palette,
   'pen': Pen,
   'pen-tool': PenTool,
   'pentagon': Pentagon,
   'plus': Plus,
   'redo-2': Redo2,
   'refresh': RefreshCw,
   'rotate-cw': RotateCw,
   'share-2': Share2,
   'share-nodes': Share2,
   'shield': Shield,
   'sparkles': Sparkles,
   'square': Square,
   'square-check': SquareCheckBig,
   'star': Star,
   'text-align-center': TextAlignCenter,
   'text-align-end': TextAlignEnd,
   'text-align-start': TextAlignStart,
   'trash-2': Trash2,
   'triangle': Triangle,
   'type': Type,
   'underline': Underline,
   'undo-2': Undo2,
   'users': Users,
   'wand-sparkles': WandSparkles,
   'x': X,
   'zoom-in': ZoomIn,
   'zoom-out': ZoomOut
};

// Nombres que usan los componentes nuevos (los del set generado de lucide).
// El objetivo es que un mismo `name` funcione en las dos copias del frontend.
const LEGACY_ALIASES = {
   'bars': 'menu',
   'check-circle': 'circle-check',
   'close': 'x',
   'code-merge': 'git-merge',
   'draw-square': 'square',
   'edit': 'pen-tool',
   'file-lines': 'file-text',
   'grid': 'layout-grid',
   'letter-bold': 'bold',
   'letter-italic': 'italic',
   'letter-underline': 'underline',
   'pen-nib': 'pen-tool',
   'redo': 'redo-2',
   'text-size': 'type',
   'trash-bin': 'trash-2',
   'undo': 'undo-2',
   'wand-magic-sparkles': 'sparkles',
   'arrow-up-right-down-left': 'flip-horizontal-2',
   'x': 'x'
};

const SIZES = { small: 16, medium: 20, large: 24 };
const STROKE_WIDTHS = { filled: 2.25, outlined: 1.5 };

export default class Icon extends HTMLElement {

   static props = {
      name: {
         type: 'string',
         default: 'image'
      },
      size: {
         type: 'string',
         default: 'small'
      },
      color: {
         type: 'string',
         default: 'currentColor'
      },
      // Kept for API compatibility with existing consumers (e.g. Button).
      // Lucide is stroke-based: filled renders heavier, outlined lighter.
      iconStyle: {
         type: 'string',
         default: 'filled'
      }
   };

   constructor(props) {
      super();
      slice.attachTemplate(this);
      this.$icon = this.querySelector('.icon');
      slice.controller.setComponentProps(this, props);
   }

   get name() {
      return this._name;
   }

   set name(value) {
      if (typeof value !== 'string' || !value) {
         console.warn(
            `[Icon] "name" must be a lucide key string (e.g. "palette"). Received:`,
            value,
            `\n→ Tip: pass { icon: { name: 'palette' } } to Button, or a string to Icon.`
         );
         return;
      }
      const legacy = LEGACY_ALIASES[value];
      this._name = ICONS[value] ? value : (ICONS[legacy] ? legacy : value);
      if (!ICONS[this._name]) {
         console.warn(`[Icon] "${value}" is not available. Add it to the lucide ICONS map in Icon.js.`);
         return;
      }
      this.render();
   }

   get iconStyle() {
      return this._iconStyle;
   }

   set iconStyle(value) {
      if (value !== 'filled' && value !== 'outlined') value = 'filled';
      this._iconStyle = value;
      if (ICONS[this._name]) this.render();
   }

   get size() {
      return this._size;
   }

   set size(value) {
      const preset = SIZES[value];
      this._size = preset ? preset : (parseInt(value, 10) || 24);
      this.render();
   }

   get color() {
      return this._color;
   }

   set color(value) {
      this._color = value;
      if (this.$icon) {
         this.$icon.style.color = value === 'black' ? 'currentColor' : value;
      }
   }

   render() {
      if (!this.$icon || !this._size) return;
      const node = ICONS[this._name];
      if (!node) return;

      const svg = createElement(node, {
         width: this._size,
         height: this._size,
         'stroke-width': STROKE_WIDTHS[this._iconStyle] ?? 2
      });
      this.$icon.replaceChildren(svg);
   }
}

customElements.define('slice-icon', Icon);
