// Netlify Function: atiende todas las rutas /api/* de CotizaTuWeb.
import { createApp } from '../../src/app.js';
import { blobsStore } from '../../src/store.js';

const app = createApp({
  // El almacenamiento se abre en cada solicitud: Netlify inyecta ahí sus credenciales.
  getStore: () => blobsStore('cotizatuweb'),
  env: process.env,
});

export default async (request, context) => app.handle(request, { ip: context.ip });

export const config = { path: '/api/*' };
