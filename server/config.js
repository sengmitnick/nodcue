export const SERVER_CONFIG = {
  port: Number(process.env.NOD_SERVER_PORT || 3200),
  databaseURL: String(process.env.DATABASE_URL || '').trim(),
  publicDir: new URL('./public/', import.meta.url),
  clientKey: process.env.NOD_CLIENT_KEY || 'nod-pronouncer-local-client',
  sessionSecret: process.env.NOD_SESSION_SECRET || 'nod-pronouncer-local-session-change-me',
  production: process.env.NODE_ENV === 'production',
  secureCookies: process.env.NODE_ENV === 'production',
};

export function validateServerConfig(config = SERVER_CONFIG) {
  if (!config.databaseURL) throw new Error('DATABASE_URL is required');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('NOD_SERVER_PORT must be a valid TCP port');
  }
  if (config.production && config.clientKey === 'nod-pronouncer-local-client') {
    throw new Error('NOD_CLIENT_KEY is required in production');
  }
  if (config.production && config.sessionSecret === 'nod-pronouncer-local-session-change-me') {
    throw new Error('NOD_SESSION_SECRET is required in production');
  }
  return config;
}
