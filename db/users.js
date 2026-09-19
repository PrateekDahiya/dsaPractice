const { getPool } = require('./pool');

async function createUser({username, email, password_hash, passwordHash, role}) {
  const hash = password_hash || passwordHash;
  if (!username || !hash) throw new Error('Missing required fields: username, password_hash');
  let finalEmail = email;
  if (!finalEmail || !String(finalEmail).trim()) finalEmail = `${username}@placeholder.local`;
  finalEmail = String(finalEmail).trim().toLowerCase();
  const r = role || 'user';
  const [res] = await getPool().query(`INSERT INTO users (username, email, password_hash, role) VALUES (?,?,?,?)`, [username, finalEmail, hash, r]);
  return res.insertId;
}
async function findUserByUsername(username) {
  const [rows] = await getPool().query(`SELECT * FROM users WHERE username=? LIMIT 1`, [username]);
  return rows[0] || null;
}
async function findUserById(id) {
  const [rows] = await getPool().query(`SELECT * FROM users WHERE id=? LIMIT 1`, [id]);
  return rows[0] || null;
}
async function findUserByEmail(email) {
  const [rows] = await getPool().query(`SELECT * FROM users WHERE email=? LIMIT 1`, [email]);
  return rows[0] || null;
}

module.exports = { createUser, findUserByUsername, findUserById, findUserByEmail };
