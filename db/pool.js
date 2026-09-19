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
function getPool() {
  if (!pool) pool = mysql.createPool(getConfig());
  return pool;
}

module.exports = { getPool, getConfig };
