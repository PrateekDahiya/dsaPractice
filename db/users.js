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
function publicUser(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username, email: r.email || null, role: r.role || 'user',
    avatar: r.avatar || null, bio: r.bio || null,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  };
}
async function listUsers({ limit = 50, offset = 0, q = '' } = {}) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  let rows;
  if (q && String(q).trim()) {
    const like = `%${String(q).trim().slice(0, 50)}%`;
    [rows] = await getPool().query(
      `SELECT id, username, email, role, avatar, createdAt FROM users WHERE username LIKE ? OR email LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?`,
      [like, like, lim, off]);
  } else {
    [rows] = await getPool().query(
      `SELECT id, username, email, role, avatar, createdAt FROM users ORDER BY id DESC LIMIT ? OFFSET ?`,
      [lim, off]);
  }
  const [[{ c }]] = await getPool().query(`SELECT COUNT(*) AS c FROM users`);
  return { users: rows.map(publicUser), total: Number(c) || 0, limit: lim, offset: off };
}
async function setUserRole(id, role) {
  if (!['user', 'admin'].includes(role)) throw new Error('role must be user or admin');
  const [res] = await getPool().query(`UPDATE users SET role=? WHERE id=?`, [role, id]);
  return res.affectedRows > 0;
}

module.exports = { createUser, findUserByUsername, findUserById, findUserByEmail, publicUser, listUsers, setUserRole };
