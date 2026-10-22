import http from 'node:http';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { createApp } from './app.js';
import { SERVER_CONFIG, validateServerConfig } from './config.js';
import { createStore } from './store.js';

const config = validateServerConfig();
const pool = new pg.Pool({ connectionString: config.databaseURL });
await pool.query('SELECT 1');

const store = createStore({ pool });
const server = http.createServer(createApp({
  store,
  clientKey: config.clientKey,
  sessionSecret: config.sessionSecret,
  publicDir: fileURLToPath(config.publicDir),
  secureCookies: config.secureCookies,
}));

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[nod-pronouncer] received ${signal}, shutting down`);
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
}

process.once('SIGTERM', () => { shutdown('SIGTERM').catch(console.error); });
process.once('SIGINT', () => { shutdown('SIGINT').catch(console.error); });

server.listen(config.port, '0.0.0.0', () => {
  console.log(`[nod-pronouncer] web ready on port ${config.port}`);
});
