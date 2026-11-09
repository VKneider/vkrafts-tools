// Configuración compartida de Slice.js. Incluye:
//   · entorno de navegador + globales `slice`/`Slice` para `src/`
//   · globales de Node para `api/`, `scripts/` y archivos de config
//   · ignores de salida generada/vendored
//   · las reglas de diagnóstico del CLI (warnings, no bloquean el build)
//
// `slice setup lint` no sobrescribe un eslint.config.js existente, así que el
// proyecto adopta el preset explícitamente. Para reglas propias, agregar un
// objeto al final del array (ver `slicejs-cli/eslint-config.js`).
import slice from 'slicejs-cli/eslint-config.js';

export default [
   ...slice,

   // jsPDF se sirve vendorizado como asset estático desde src/public/vendor
   // (ver el comentario de carga en LayoutsSection.js). Es código de terceros:
   // no se lintea ni se "arregla" a mano porque el build lo copia tal cual.
   { ignores: ['src/public/**'] },

   // Las rutas de Slice usan `${param}` (no `:param`). Es sintaxis del router,
   // no un template string olvidado, así que la regla no aplica en routes.js.
   {
      files: ['src/routes.js'],
      rules: { 'no-template-curly-in-string': 'off' }
   }
];
