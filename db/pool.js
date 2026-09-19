const mysql = require('mysql2/promise');

function getConfig() {
  if (!process.env.DB_HOST || !process.env.DB_USERNAME || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
    throw new Error('Missing DB env: DB_HOST, DB_USERNAME, DB_PASSWORD, DB_NAME required (see .env)');
  }
  return {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USERNAME || process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  };
}

let pool = null;
let warmed = false;
function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...getConfig(),
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      // Hikari-like: maxPoolSize = connectionLimit, minIdle = 2
    });
  }
  return pool;
}
// Hikari-style warmup: create 5 connections on start and keep them idle
async function warmPool(minIdle = 3) {
  const p = getPool();
  if (warmed) return;
  warmed = true;
  const conns = [];
  try {
    for (let i = 0; i < minIdle; i++) {
      const c = await p.getConnection();
      // verify with ping
      await c.ping();
      conns.push(c);
    }
  } finally {
    conns.forEach(c => { try { c.release(); } catch {} });
  }
  console.log(`DB pool warmed: ${minIdle} connections ready (Hikari-like)`);
}

module.exports = { getPool, getConfig, warmPool };
