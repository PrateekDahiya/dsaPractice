const { getPool } = require('./pool');

async function dbCreateSubmission({questionId, title, language, mode, code, passed, total, results, userId}) {
  const [res] = await getPool().query(`INSERT INTO submissions (questionId, title, language, mode, code, passed, total, results, userId) VALUES (?,?,?,?,?,?,?,?,?)`, [questionId, title||null, language, mode, code, passed, total, JSON.stringify(results), userId||null]);
  return res.insertId;
}
async function dbGetSubmissions(questionId, limit=50, userId=null) {
  let rows; const pool = getPool();
  if (userId != null) {
    if (questionId) [rows] = await pool.query('SELECT * FROM submissions WHERE questionId=? AND userId=? ORDER BY createdAt DESC LIMIT ?', [questionId, userId, limit]);
    else [rows] = await pool.query('SELECT * FROM submissions WHERE userId=? ORDER BY createdAt DESC LIMIT ?', [userId, limit]);
  } else {
    if (questionId) {
      [rows] = await pool.query('SELECT * FROM submissions WHERE questionId=? AND userId IS NULL ORDER BY createdAt DESC LIMIT ?', [questionId, limit]);
      if (!rows.length) {
        const [rows2] = await pool.query('SELECT * FROM submissions WHERE questionId=? ORDER BY createdAt DESC LIMIT ?', [questionId, limit]);
        try { const [cnt] = await pool.query('SELECT COUNT(*) as c FROM submissions WHERE userId IS NOT NULL'); if (cnt[0].c === 0) rows = rows2; } catch { rows = rows2; }
      }
    } else {
      [rows] = await pool.query('SELECT * FROM submissions WHERE userId IS NULL ORDER BY createdAt DESC LIMIT ?', [limit]);
      if (!rows.length) {
        const [rows2] = await pool.query('SELECT * FROM submissions ORDER BY createdAt DESC LIMIT ?', [limit]);
        try { const [cnt] = await pool.query('SELECT COUNT(*) as c FROM submissions WHERE userId IS NOT NULL'); if (cnt[0].c === 0) rows = rows2; } catch { rows = rows2; }
      }
    }
  }
  return rows.map(r => ({
    id: r.id, questionId: r.questionId, title: r.title, language: r.language, mode: r.mode, code: r.code, passed: r.passed, total: r.total,
    results: typeof r.results==='string' ? JSON.parse(r.results) : r.results,
    userId: r.userId || null, ts: new Date(r.createdAt).getTime(), createdAt: new Date(r.createdAt).toISOString()
  }));
}

module.exports = { dbCreateSubmission, dbGetSubmissions };
