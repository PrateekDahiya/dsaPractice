const { getPool } = require('./pool');

async function addBookmark(userId, questionId) {
  if (!userId || !questionId) throw new Error('Missing userId/questionId');
  await getPool().query(
    `INSERT INTO bookmarks (userId, questionId) VALUES (?, ?) ON DUPLICATE KEY UPDATE createdAt=createdAt`,
    [userId, questionId]
  );
}
async function removeBookmark(userId, questionId) {
  if (!userId || !questionId) throw new Error('Missing userId/questionId');
  await getPool().query(`DELETE FROM bookmarks WHERE userId=? AND questionId=?`, [userId, questionId]);
}
async function getBookmarkIds(userId) {
  if (!userId) return [];
  try {
    const [rows] = await getPool().query(`SELECT questionId FROM bookmarks WHERE userId=?`, [userId]);
    return rows.map(r => r.questionId);
  } catch (e) {
    // table may not exist yet on old DB
    if (String(e.message).includes("doesn't exist") || String(e.message).includes("1146")) return [];
    throw e;
  }
}

module.exports = { addBookmark, removeBookmark, getBookmarkIds };
