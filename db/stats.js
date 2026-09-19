const { getPool } = require('./pool');

function toISODate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const dt = d instanceof Date ? d : new Date(d);
  if (dt.getUTCHours() === 18 && dt.getUTCMinutes() === 30) {
    const adj = new Date(dt.getTime() + (5.5 * 3600000));
    return adj.toISOString().slice(0, 10);
  }
  return dt.toISOString().slice(0, 10);
}
function buildEmptyCalendar(days = 365) {
  const today = new Date();
  today.setUTCHours(0,0,0,0);
  const cal = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(today);
    dt.setUTCDate(today.getUTCDate() - i);
    cal.push({ date: dt.toISOString().slice(0, 10), count: 0 });
  }
  return cal;
}
async function getSolvedIds(userId) {
  if (!userId) return [];
  const [rows] = await getPool().query(`SELECT DISTINCT questionId FROM submissions WHERE userId=? AND passed=total AND mode='submit'`, [userId]);
  return rows.map(r => r.questionId);
}
async function getStats(userId) {
  const pool = getPool();
  let total = 0;
  let totalByDiff = { Easy: 0, Medium: 0, Hard: 0 };
  try {
    const [cRows] = await pool.query('SELECT COUNT(*) as cnt FROM questions');
    total = cRows[0]?.cnt || 0;
    const [dRows] = await pool.query('SELECT difficulty, COUNT(*) as cnt FROM questions GROUP BY difficulty');
    for (const r of dRows) totalByDiff[r.difficulty] = r.cnt;
  } catch {}
  if (!userId) {
    return { solved: 0, total, byDifficulty: { Easy: { solved: 0, total: totalByDiff.Easy||0 }, Medium: { solved: 0, total: totalByDiff.Medium||0 }, Hard: { solved: 0, total: totalByDiff.Hard||0 } }, recent: [], perDay: [], streaks: { current: 0, longest: 0, totalActive: 0, calendar: buildEmptyCalendar(365) } };
  }
  try {
    const [solvedDiffRows] = await pool.query(`SELECT q.difficulty as difficulty, COUNT(DISTINCT s.questionId) as cnt FROM submissions s JOIN questions q ON q.id=s.questionId WHERE s.userId=? AND s.passed=s.total AND s.mode='submit' GROUP BY q.difficulty`, [userId]);
    const solvedByDiffMap = {};
    for (const r of solvedDiffRows) solvedByDiffMap[r.difficulty] = r.cnt;
    const byDifficulty = {
      Easy: { solved: solvedByDiffMap.Easy || 0, total: totalByDiff.Easy || 0 },
      Medium: { solved: solvedByDiffMap.Medium || 0, total: totalByDiff.Medium || 0 },
      Hard: { solved: solvedByDiffMap.Hard || 0, total: totalByDiff.Hard || 0 },
    };
    const [solvedCntRows] = await pool.query(`SELECT COUNT(DISTINCT questionId) as cnt FROM submissions WHERE userId=? AND passed=total AND mode='submit'`, [userId]);
    const solved = solvedCntRows[0]?.cnt || 0;
    const [recentRows] = await pool.query(`SELECT s.questionId as questionId, q.title as title, q.difficulty as difficulty, MAX(s.createdAt) as solvedAt FROM submissions s JOIN questions q ON q.id=s.questionId WHERE s.userId=? AND s.passed=s.total AND s.mode='submit' GROUP BY s.questionId, q.title, q.difficulty ORDER BY solvedAt DESC LIMIT 10`, [userId]);
    const recent = recentRows.map(r => ({ questionId: r.questionId, title: r.title, difficulty: r.difficulty, solvedAt: r.solvedAt ? new Date(r.solvedAt).toISOString() : null }));
    const [perDayRows] = await pool.query(`SELECT DATE_FORMAT(DATE(createdAt), '%Y-%m-%d') as d, COUNT(DISTINCT questionId) as cnt FROM submissions WHERE userId=? AND passed=total AND mode='submit' GROUP BY DATE_FORMAT(DATE(createdAt), '%Y-%m-%d') ORDER BY d ASC`, [userId]);
    const perDay = perDayRows.map(r => ({ date: toISODate(r.d), count: r.cnt }));
    const [dateRows] = await pool.query(`SELECT DATE_FORMAT(DATE(createdAt), '%Y-%m-%d') as d FROM submissions WHERE userId=? AND passed=total AND mode='submit' GROUP BY DATE_FORMAT(DATE(createdAt), '%Y-%m-%d') ORDER BY d ASC`, [userId]);
    const [countPerDateRows] = await pool.query(`SELECT DATE_FORMAT(DATE(createdAt), '%Y-%m-%d') as d, COUNT(DISTINCT questionId) as cnt FROM submissions WHERE userId=? AND passed=total AND mode='submit' GROUP BY DATE_FORMAT(DATE(createdAt), '%Y-%m-%d')`, [userId]);
    const countMap = {};
    for (const r of countPerDateRows) countMap[toISODate(r.d)] = r.cnt;
    const distinctDates = dateRows.map(r => toISODate(r.d)).sort();
    const dateSet = new Set(distinctDates);
    let longest = 0, curRun = 0, prev = null;
    for (const ds of distinctDates) {
      if (prev) { const diff = (new Date(ds) - new Date(prev)) / 86400000; curRun = diff === 1 ? curRun + 1 : 1; } else curRun = 1;
      if (curRun > longest) longest = curRun;
      prev = ds;
    }
    if (distinctDates.length === 0) longest = 0;
    let todayStr;
    try { const [todayRows] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') as today"); todayStr = toISODate(todayRows[0].today); } catch { todayStr = new Date().toISOString().slice(0,10); }
    let current = 0;
    if (dateSet.has(todayStr)) {
      current = 1;
      let cursor = new Date(todayStr);
      while (true) { cursor.setUTCDate(cursor.getUTCDate() - 1); const cs = cursor.toISOString().slice(0,10); if (dateSet.has(cs)) current += 1; else break; }
    }
    const totalActive = distinctDates.length;
    const calendar = [];
    const baseToday = new Date(todayStr); baseToday.setUTCHours(0,0,0,0);
    for (let i = 364; i >= 0; i--) { const dt = new Date(baseToday); dt.setUTCDate(baseToday.getUTCDate() - i); const ds = dt.toISOString().slice(0,10); calendar.push({ date: ds, count: countMap[ds] || 0 }); }
    return { solved, total, byDifficulty, recent, perDay, streaks: { current, longest, totalActive, calendar } };
  } catch (e) {
    return { solved: 0, total, byDifficulty: { Easy: { solved: 0, total: totalByDiff.Easy||0 }, Medium: { solved: 0, total: totalByDiff.Medium||0 }, Hard: { solved: 0, total: totalByDiff.Hard||0 } }, recent: [], perDay: [], streaks: { current: 0, longest: 0, totalActive: 0, calendar: buildEmptyCalendar(365) } };
  }
}
async function getLeaderboard(filter = 'all', limit = 50) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  let f = String(filter || 'all').toLowerCase().trim();
  if (f === 'all-time' || f === 'alltime') f = 'all';
  if (!['all', 'weekly', 'monthly'].includes(f)) {
    if (['week','7d','last7'].includes(f)) f = 'weekly';
    else if (['month','30d','last30'].includes(f)) f = 'monthly';
    else f = 'all';
  }
  try {
    let dateClause = '';
    if (f === 'weekly') dateClause = ` AND s.createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
    else if (f === 'monthly') dateClause = ` AND s.createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
    const sql = `SELECT u.id, u.username, u.avatar, COUNT(DISTINCT s.questionId) as solvedCount, MAX(s.createdAt) as lastSolvedAt FROM users u LEFT JOIN submissions s ON s.userId = u.id AND s.passed = s.total AND s.mode='submit'${dateClause} GROUP BY u.id, u.username, u.avatar ORDER BY solvedCount DESC, lastSolvedAt ASC LIMIT ?`;
    const [rows] = await getPool().query(sql, [lim]);
    return rows.map(r => ({ id: r.id, username: r.username, avatar: r.avatar || null, solvedCount: Number(r.solvedCount) || 0, lastSolvedAt: r.lastSolvedAt ? new Date(r.lastSolvedAt).toISOString() : null }));
  } catch { return []; }
}
async function getUserDashboard(userId) {
  const stats = await getStats(userId);
  let submissions = [], solvedIds = [];
  try {
    if (userId) {
      const { dbGetSubmissions } = require('./submissions');
      const { getSolvedIds: gsi } = require('./stats');
      submissions = await require('./submissions').dbGetSubmissions(null, 50, userId);
      solvedIds = await getSolvedIds(userId);
    }
  } catch {}
  return { stats, submissions, solvedIds };
}

module.exports = { toISODate, buildEmptyCalendar, getSolvedIds, getStats, getLeaderboard, getUserDashboard };
