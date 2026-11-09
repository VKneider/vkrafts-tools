import {
   createSliceServer,
   sliceErrorHandler,
   sliceFallback
} from 'slicejs-web-framework/api/framework/server.js';

const onVercel = !!process.env.VERCEL;
const mode = onVercel ? 'production' : undefined;

const server = createSliceServer({ mode });

// En Vercel no se llama a start(): el export es directamente el handler de la
// función. La versión actual de Slice movió el fallback fuera de la factory, así
// que hay que cerrar la cadena a mano o `/` queda sin ruta ("Cannot GET /").
server.app.use(sliceFallback({ mode }));
server.app.use(sliceErrorHandler({ mode }));

if (!onVercel) {
   server.start();
}

export default server.app;
