// Compartir por link (estilo conclave): el estado del diseño viaja en la URL.
// Formato: /font/{fontId}?t=<texto>&s=<size>&b=1&i=1&u=1&al=center&ls=0&m=0&r=0&c=%23000000&bg=transparent
const ALIGNMENTS = new Set(['left', 'center', 'right']);

function clamp(value, min, max, fallback) {
   const n = Number(value);
   if (!Number.isFinite(n)) return fallback;
   return Math.min(max, Math.max(min, Math.round(n)));
}

function safeColor(value, fallback) {
   if (value === 'transparent') return 'transparent';
   return /^#[0-9a-fA-F]{3,8}$/.test(String(value)) ? value : fallback;
}

export default class ShareService {
   constructor(props) {
      this.props = props || {};
   }

   forFont(fontId, design = {}) {
      const params = new URLSearchParams();
      if (design.texto) params.set('t', design.texto);
      params.set('s', String(clamp(design.fontSize ?? 48, 12, 200, 48)));
      if (design.bold) params.set('b', '1');
      if (design.italic) params.set('i', '1');
      if (design.underline) params.set('u', '1');
      params.set('al', ALIGNMENTS.has(design.align) ? design.align : 'center');
      params.set('ls', String(clamp(design.letterSpacing ?? 0, -5, 30, 0)));
      if (design.mirrored) params.set('m', '1');
      params.set('r', String(clamp(design.rotation ?? 0, 0, 270, 0)));
      params.set('c', safeColor(design.textColor, '#000000'));
      params.set('bg', safeColor(design.bgColor, 'transparent'));

      const query = params.toString();
      return `${window.location.origin}/font/${encodeURIComponent(fontId)}${query ? `?${query}` : ''}`;
   }

   parse() {
      const search = new URLSearchParams(window.location.search);
      if (![...search.keys()].length && !window.location.pathname.startsWith('/font/')) {
         return null;
      }
      const fontId = decodeURIComponent(window.location.pathname.split('/').pop() || '');
      return {
         fontId,
         design: {
            texto: search.get('t') ?? '',
            fontSize: clamp(search.get('s'), 12, 200, 48),
            bold: search.get('b') === '1',
            italic: search.get('i') === '1',
            underline: search.get('u') === '1',
            align: ALIGNMENTS.has(search.get('al')) ? search.get('al') : 'center',
            letterSpacing: clamp(search.get('ls'), -5, 30, 0),
            mirrored: search.get('m') === '1',
            rotation: clamp(search.get('r'), 0, 270, 0),
            textColor: safeColor(search.get('c'), '#000000'),
            bgColor: safeColor(search.get('bg'), 'transparent')
         }
      };
   }
}
