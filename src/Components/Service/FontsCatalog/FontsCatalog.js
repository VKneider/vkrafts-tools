// Migrated from vkrafts2/src/config/fonts.ts
// To add a font: load it in src/App/index.html (Google Fonts) and add an
// entry here with the exact family name.

const fuentesCorrido = [
   { id: 'c1', fontFamily: 'Dancing Script', categoria: 'corrido', codigo: 'C1' },
   { id: 'c2', fontFamily: 'Great Vibes', categoria: 'corrido', codigo: 'C2' },
   { id: 'c3', fontFamily: 'Pacifico', categoria: 'corrido', codigo: 'C3' },
   { id: 'c4', fontFamily: 'Satisfy', categoria: 'corrido', codigo: 'C4' },
   { id: 'c5', fontFamily: 'Lobster', categoria: 'corrido', codigo: 'C5' },
   { id: 'c6', fontFamily: 'Sacramento', categoria: 'corrido', codigo: 'C6' }
];

const fuentesImprenta = [
   { id: 'i1', fontFamily: 'Montserrat', categoria: 'imprenta', codigo: 'I1' },
   { id: 'i2', fontFamily: 'Playfair Display', categoria: 'imprenta', codigo: 'I2' },
   { id: 'i3', fontFamily: 'Bebas Neue', categoria: 'imprenta', codigo: 'I3' },
   { id: 'i4', fontFamily: 'Oswald', categoria: 'imprenta', codigo: 'I4' },
   { id: 'i5', fontFamily: 'Raleway', categoria: 'imprenta', codigo: 'I5' },
   { id: 'i6', fontFamily: 'Merriweather', categoria: 'imprenta', codigo: 'I6' }
];

export default class FontsCatalog {
   constructor(props = {}) {
      this.props = props || {};
      this.fonts = [...fuentesCorrido, ...fuentesImprenta];
      // WhatsApp number shown to customers (country code + number, no spaces).
      this.whatsappNumber = '5491112345678';
   }

   getAll() {
      return this.fonts;
   }

   getByCategory(categoria) {
      return this.fonts.filter((font) => font.categoria === categoria);
   }

   find(id) {
      return this.fonts.find((font) => font.id === id) || null;
   }
}
