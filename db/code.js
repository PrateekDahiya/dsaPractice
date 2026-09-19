const { getPool } = require('./pool');

async function dbSaveCode(questionId, language, code, userId = null) {
  const pool = getPool();
  if (userId != null) {
    const [rows] = await pool.query('SELECT id FROM code_saves WHERE userId=? AND questionId=? AND language=? LIMIT 1', [userId, questionId, language]);
    if (rows.length) await pool.query('UPDATE code_saves SET code=?, updatedAt=CURRENT_TIMESTAMP WHERE userId=? AND questionId=? AND language=?', [code, userId, questionId, language]);
    else await pool.query('INSERT INTO code_saves (questionId, language, code, userId) VALUES (?,?,?,?)', [questionId, language, code, userId]);
  } else {
    const [rows] = await pool.query('SELECT id FROM code_saves WHERE questionId=? AND language=? AND userId IS NULL LIMIT 1', [questionId, language]);
    if (rows.length) await pool.query('UPDATE code_saves SET code=?, updatedAt=CURRENT_TIMESTAMP WHERE questionId=? AND language=? AND userId IS NULL', [code, questionId, language]);
    else {
      try { await pool.query('INSERT INTO code_saves (questionId, language, code, userId) VALUES (?,?,?,NULL)', [questionId, language, code]); }
      catch (e) { await pool.query(`INSERT INTO code_saves (questionId, language, code) VALUES (?,?,?) ON DUPLICATE KEY UPDATE code=VALUES(code), updatedAt=CURRENT_TIMESTAMP`, [questionId, language, code]); }
    }
  }
}
async function dbGetCode(questionId, language, userId = null) {
  const pool = getPool();
  if (userId != null) {
    try {
      const [rows] = await pool.query('SELECT code FROM code_saves WHERE questionId=? AND language=? AND userId=? LIMIT 1', [questionId, language, userId]);
      return rows[0]?.code || null;
    } catch { const [rows] = await pool.query('SELECT code FROM code_saves WHERE questionId=? AND language=? LIMIT 1', [questionId, language]); return rows[0]?.code || null; }
  } else {
    try {
      const [rows] = await pool.query('SELECT code FROM code_saves WHERE questionId=? AND language=? AND userId IS NULL LIMIT 1', [questionId, language]);
      return rows[0]?.code || null;
    } catch {
      try { const [rows2] = await pool.query('SELECT code FROM code_saves WHERE questionId=? AND language=? LIMIT 1', [questionId, language]); return rows2[0]?.code || null; } catch { return null; }
    }
  }
}

module.exports = { dbSaveCode, dbGetCode };
