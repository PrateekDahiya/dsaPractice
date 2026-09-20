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
  try {
    const [rows] = await getPool().query(
      `SELECT DISTINCT questionId FROM (
         SELECT questionId FROM submissions WHERE userId=? AND passed=total AND mode='submit'
         UNION
         SELECT questionId FROM manual_solved WHERE userId=?
       ) u`,
      [userId, userId]
    );
    return rows.map(r => r.questionId);
  } catch (e) {
    // manual_solved table may not exist yet — fallback to submissions only
    if (String(e.message).includes("doesn't exist") || String(e.code).includes("1146") || String(e.message).includes("1146")) {
      const [rows] = await getPool().query(`SELECT DISTINCT questionId FROM submissions WHERE userId=? AND passed=total AND mode='submit'`, [userId]);
      return rows.map(r => r.questionId);
    }
    throw e;
  }
}
let statsCache = new Map(); // userId -> {data, ts}
async function getStats(userId) {
  const pool = getPool();
  // cache 15s per user (dashboard is hot)
  const cacheKey = String(userId||'anon');
  const cached = statsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 15000 && userId) return cached.data;
  const [[cRows],[dRows]] = await Promise.all([
    pool.query('SELECT COUNT(*) as cnt FROM questions').catch(()=>[ [{cnt:0}] ]),
    pool.query('SELECT difficulty, COUNT(*) as cnt FROM questions GROUP BY difficulty').catch(()=>[[]])
  ]);
  let total = cRows[0]?.cnt || 0;
  let totalByDiff = { Easy: 0, Medium: 0, Hard: 0 };
  for (const r of (dRows||[])) totalByDiff[r.difficulty] = r.cnt;
  if (!userId) {
    return { solved: 0, total, byDifficulty: { Easy: { solved: 0, total: totalByDiff.Easy||0 }, Medium: { solved: 0, total: totalByDiff.Medium||0 }, Hard: { solved: 0, total: totalByDiff.Hard||0 } }, recent: [], perDay: [], streaks: { current: 0, longest: 0, totalActive: 0, calendar: buildEmptyCalendar(365) } };
  }
  try {
    // 4 parallel queries instead of 7: combine perDay/date/count into one, today via JS (Asia/Kolkata)
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const [solvedDiffRows, solvedCntRows, recentRows, perDayRows] = await Promise.all([
      pool.query(`SELECT q.difficulty as difficulty, COUNT(DISTINCT s.questionId) as cnt FROM submissions s JOIN questions q ON q.id=s.questionId WHERE s.userId=? AND s.passed=s.total AND s.mode='submit' GROUP BY q.difficulty`, [userId]).then(([r])=>r).catch(() => []),
      pool.query(`SELECT COUNT(DISTINCT questionId) as cnt FROM submissions WHERE userId=? AND passed=total AND mode='submit'`, [userId]).then(([r])=>r).catch(() => [{cnt:0}]),
      pool.query(`SELECT s.questionId as questionId, q.title as title, q.difficulty as difficulty, MAX(s.createdAt) as solvedAt FROM submissions s JOIN questions q ON q.id=s.questionId WHERE s.userId=? AND s.passed=s.total AND s.mode='submit' GROUP BY s.questionId, q.title, q.difficulty ORDER BY solvedAt DESC LIMIT 10`, [userId]).then(([r])=>r).catch(() => []),
      pool.query(`SELECT DATE_FORMAT(DATE(CONVERT_TZ(createdAt,'+00:00','+05:30')), '%Y-%m-%d') as d, COUNT(DISTINCT questionId) as cnt FROM submissions WHERE userId=? AND passed=total AND mode='submit' GROUP BY DATE_FORMAT(DATE(CONVERT_TZ(createdAt,'+00:00','+05:30')), '%Y-%m-%d') ORDER BY d ASC`, [userId]).then(([r])=>r).catch(()=>[])
    ]);
    const solvedByDiffMap = {};
    for (const r of solvedDiffRows) solvedByDiffMap[r.difficulty] = r.cnt;
    // Merge manual_solved (user override for wrong test cases)
    let manualIds = [];
    let manualRecent = [];
    let manualPerDayMap = {};
    try {
      const [mRows] = await pool.query(
        `SELECT m.questionId as questionId, q.title as title, q.difficulty as difficulty, m.createdAt as solvedAt
         FROM manual_solved m JOIN questions q ON q.id=m.questionId WHERE m.userId=?`,
        [userId]
      ).catch(() => [[]]);
      manualIds = (mRows || []).map(r => r.questionId);
      for (const r of (mRows || [])) {
        manualRecent.push({ questionId: r.questionId, title: r.title, difficulty: r.difficulty, solvedAt: r.solvedAt ? new Date(r.solvedAt).toISOString() : null });
        const d = new Date(r.solvedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        manualPerDayMap[d] = (manualPerDayMap[d] || 0) + 1;
      }
    } catch {}
    // Auto ids (for dedupe)
    let autoIdSet = new Set();
    try {
      const [ar] = await pool.query(`SELECT DISTINCT questionId FROM submissions WHERE userId=? AND passed=total AND mode='submit'`, [userId]).catch(() => [[]]);
      for (const r of (ar || [])) autoIdSet.add(r.questionId);
    } catch {}
    // Union solved count
    const solvedUnionSet = new Set([...autoIdSet, ...manualIds]);
    const solved = solvedUnionSet.size;
    // byDifficulty: auto + manual-only (avoid double counting questions solved both ways)
    const manualOnlyByDiff = {};
    try {
      if (manualIds.length) {
        const onlyManual = manualIds.filter(id => !autoIdSet.has(id));
        if (onlyManual.length) {
          const [dr] = await pool.query(`SELECT difficulty, COUNT(*) as cnt FROM questions WHERE id IN (${onlyManual.map(() => '?').join(',')}) GROUP BY difficulty`, onlyManual).catch(() => [[]]);
          for (const r of (dr || [])) manualOnlyByDiff[r.difficulty] = Number(r.cnt);
        }
      }
    } catch {}
    const byDifficulty = {
      Easy: { solved: (Number(solvedByDiffMap.Easy) || 0) + (manualOnlyByDiff.Easy || 0), total: totalByDiff.Easy || 0 },
      Medium: { solved: (Number(solvedByDiffMap.Medium) || 0) + (manualOnlyByDiff.Medium || 0), total: totalByDiff.Medium || 0 },
      Hard: { solved: (Number(solvedByDiffMap.Hard) || 0) + (manualOnlyByDiff.Hard || 0), total: totalByDiff.Hard || 0 },
    };
    // Merge recent: auto recent + manual recent, dedupe by questionId keeping newest, sort desc, take 10
    const recentMap = new Map();
    for (const r of recentRows.map(r => ({ questionId: r.questionId, title: r.title, difficulty: r.difficulty, solvedAt: r.solvedAt ? new Date(r.solvedAt).toISOString() : null }))) recentMap.set(r.questionId, r);
    for (const r of manualRecent) {
      const ex = recentMap.get(r.questionId);
      if (!ex || new Date(r.solvedAt) > new Date(ex.solvedAt)) recentMap.set(r.questionId, r);
    }
    const recent = [...recentMap.values()].sort((a, b) => new Date(b.solvedAt) - new Date(a.solvedAt)).slice(0, 10);
    // Merge perDay: sum auto + manual per date (approximation for same-day dupes, rare)
    const perDayMap = {};
    for (const r of perDayRows) perDayMap[r.d] = (perDayMap[r.d] || 0) + Number(r.cnt);
    for (const [d, c] of Object.entries(manualPerDayMap)) perDayMap[d] = (perDayMap[d] || 0) + Number(c);
    const perDay = Object.entries(perDayMap).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
    // Streaks/calendar from merged perDay
    const countMap = {};
    for (const r of perDay) countMap[r.date] = r.count;
    const distinctDates = perDay.map(r => r.date).sort();
    const dateSet = new Set(distinctDates);
    let longest = 0, curRun = 0, prev = null;
    for (const ds of distinctDates) {
      if (prev) { const diff = (new Date(ds) - new Date(prev)) / 86400000; curRun = diff === 1 ? curRun + 1 : 1; } else curRun = 1;
      if (curRun > longest) longest = curRun;
      prev = ds;
    }
    if (distinctDates.length === 0) longest = 0;
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
    const result = { solved, total, byDifficulty, recent, perDay, streaks: { current, longest, totalActive, calendar } };
    statsCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
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
    if (f === 'weekly') dateClause = ` AND combined.createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
    else if (f === 'monthly') dateClause = ` AND combined.createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
    // Union auto submissions + manual overrides so leaderboard counts Mark as Done
    const sql = `SELECT u.id, u.username, u.avatar, COUNT(DISTINCT combined.questionId) as solvedCount, MAX(combined.createdAt) as lastSolvedAt
      FROM users u
      LEFT JOIN (
        SELECT userId, questionId, createdAt FROM submissions WHERE passed=total AND mode='submit'
        UNION
        SELECT userId, questionId, createdAt FROM manual_solved
      ) combined ON combined.userId = u.id${dateClause}
      GROUP BY u.id, u.username, u.avatar ORDER BY solvedCount DESC, lastSolvedAt ASC LIMIT ?`;
    const [rows] = await getPool().query(sql, [lim]);
    return rows.map(r => ({ id: r.id, username: r.username, avatar: r.avatar || null, solvedCount: Number(r.solvedCount) || 0, lastSolvedAt: r.lastSolvedAt ? new Date(r.lastSolvedAt).toISOString() : null }));
  } catch (e) {
    // fallback to submissions-only if manual_solved missing
    try {
      let dateClause = '';
      if (f === 'weekly') dateClause = ` AND s.createdAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
      else if (f === 'monthly') dateClause = ` AND s.createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
      const sql = `SELECT u.id, u.username, u.avatar, COUNT(DISTINCT s.questionId) as solvedCount, MAX(s.createdAt) as lastSolvedAt FROM users u LEFT JOIN submissions s ON s.userId = u.id AND s.passed = s.total AND s.mode='submit'${dateClause} GROUP BY u.id, u.username, u.avatar ORDER BY solvedCount DESC, lastSolvedAt ASC LIMIT ?`;
      const [rows] = await getPool().query(sql, [lim]);
      return rows.map(r => ({ id: r.id, username: r.username, avatar: r.avatar || null, solvedCount: Number(r.solvedCount) || 0, lastSolvedAt: r.lastSolvedAt ? new Date(r.lastSolvedAt).toISOString() : null }));
    } catch { return []; }
  }
}
function clearStatsCache(userId){
  if (userId) statsCache.delete(String(userId));
  else statsCache.clear();
}
async function getUserDashboard(userId) {
  if (!userId) {
    const stats = await getStats(null);
    return { stats, submissions: [], solvedIds: [] };
  }
  const [stats, submissions, solvedIds] = await Promise.all([
    getStats(userId),
    require('./submissions').dbGetSubmissions(null, 50, userId).catch(()=>[]),
    getSolvedIds(userId).catch(()=>[])
  ]);
  return { stats, submissions, solvedIds };
}

module.exports = { toISODate, buildEmptyCalendar, getSolvedIds, getStats, getLeaderboard, getUserDashboard, clearStatsCache };
