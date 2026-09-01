import { createSliceServer } from 'slicejs-web-framework/api/framework/server.js';

const server = createSliceServer();

if (!process.env.VERCEL) {
  server.start();
}

export default server.app;
