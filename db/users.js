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
function validAvatarUrl(url) {
  if (url == null || url === '') return '';
  const s = String(url).trim().slice(0, 500);
  if (!/^https?:\/\/[^\s]+$/i.test(s)) throw new Error('avatar must be an http(s) URL');
  return s;
}
async function updateProfile(id, { avatar, bio }) {
  const sets = [];
  const vals = [];
  if (avatar !== undefined) {
    sets.push('avatar=?');
    vals.push(validAvatarUrl(avatar) || null);
  }
  if (bio !== undefined) {
    if (bio != null && String(bio).length > 500) throw new Error('bio must be at most 500 characters');
    sets.push('bio=?');
    vals.push(bio == null || String(bio).trim() === '' ? null : String(bio).slice(0, 500));
  }
  if (!sets.length) throw new Error('Nothing to update (avatar, bio)');
  vals.push(id);
  const [res] = await getPool().query(`UPDATE users SET ${sets.join(', ')} WHERE id=?`, vals);
  return res.affectedRows > 0;
}
async function getPublicProfile(id) {
  const [rows] = await getPool().query(
    `SELECT id, username, avatar, bio, createdAt FROM users WHERE id=? LIMIT 1`, [id]);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id, username: r.username, avatar: r.avatar || null, bio: r.bio || null,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  };
}
async function updatePassword(id, hash) {
  if (!id || !hash) throw new Error('Missing id/hash');
  const [res] = await getPool().query(`UPDATE users SET password_hash=? WHERE id=?`, [hash, id]);
  return res.affectedRows > 0;
}
async function deleteUser(id) {
  if (!id) throw new Error('Missing id');
  // FKs cascade: code_saves, submissions, manual_solved, bookmarks;
  // questions.addedBy goes SET NULL (content preserved).
  const [res] = await getPool().query(`DELETE FROM users WHERE id=?`, [id]);
  return res.affectedRows > 0;
}
async function exportUserData(id) {
  const pool = getPool();
  const user = await findUserById(id);
  if (!user) return null;
  const [[{ subTotal }]] = await pool.query(`SELECT COUNT(*) AS subTotal FROM submissions WHERE userId=?`, [id]);
  const [code] = await pool.query(`SELECT questionId, language, code, updatedAt FROM code_saves WHERE userId=? ORDER BY updatedAt DESC`, [id]);
  const [subs] = await pool.query(
    `SELECT id, questionId, title, language, mode, code, passed, total, avgTimeMs, maxTimeMs, maxMemKb, complexityTime, complexitySpace, createdAt
     FROM submissions WHERE userId=? ORDER BY createdAt DESC LIMIT 500`, [id]);
  const [manual] = await pool.query(`SELECT questionId, createdAt FROM manual_solved WHERE userId=?`, [id]);
  const [marks] = await pool.query(`SELECT questionId, createdAt FROM bookmarks WHERE userId=?`, [id]);
  return {
    exportedAt: new Date().toISOString(),
    user: publicUser(user),
    codeSaves: code.map((r) => ({ ...r, updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null })),
    submissions: subs.map((r) => ({ ...r, createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null })),
    submissionTotal: Number(subTotal) || 0,
    submissionTruncated: Number(subTotal) > subs.length,
    manualSolved: manual.map((r) => ({ ...r, createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null })),
    bookmarks: marks.map((r) => ({ ...r, createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null })),
  };
}

module.exports = { createUser, findUserByUsername, findUserById, findUserByEmail, publicUser, listUsers, setUserRole, updateProfile, getPublicProfile, updatePassword, deleteUser, exportUserData };
