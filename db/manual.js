const { getPool } = require('./pool');

async function markDone(userId, questionId) {
  if (!userId || !questionId) throw new Error('Missing userId/questionId');
  await getPool().query(
    `INSERT INTO manual_solved (userId, questionId) VALUES (?, ?) ON DUPLICATE KEY UPDATE createdAt=createdAt`,
    [userId, questionId]
  );
}
async function unmarkDone(userId, questionId) {
  if (!userId || !questionId) throw new Error('Missing userId/questionId');
  await getPool().query(`DELETE FROM manual_solved WHERE userId=? AND questionId=?`, [userId, questionId]);
}
async function getManualSolvedIds(userId) {
  if (!userId) return [];
  try {
    const [rows] = await getPool().query(`SELECT questionId FROM manual_solved WHERE userId=?`, [userId]);
    return rows.map(r => r.questionId);
  } catch (e) {
    // table may not exist yet on old DB
    if (String(e.message).includes("doesn't exist") || String(e.message).includes("1146")) return [];
    throw e;
  }
}
async function isMarkedDone(userId, questionId) {
  if (!userId || !questionId) return false;
  try {
    const [rows] = await getPool().query(`SELECT 1 FROM manual_solved WHERE userId=? AND questionId=? LIMIT 1`, [userId, questionId]);
    return rows.length > 0;
  } catch {
    return false;
  }
}

module.exports = { markDone, unmarkDone, getManualSolvedIds, isMarkedDone };
