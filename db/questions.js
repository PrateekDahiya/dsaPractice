const fs = require('fs');
const path = require('path');
const { getPool } = require('./pool');

async function migrateFromFiles(questionsDir) {
  if (!fs.existsSync(questionsDir)) return;
  const files = fs.readdirSync(questionsDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const pool = getPool();
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(questionsDir, file), 'utf8');
      const q = JSON.parse(raw);
      if (!q.id) continue;
      const stat = fs.statSync(path.join(questionsDir, file));
      const createdAt = q.createdAt ? new Date(q.createdAt) : new Date(stat.mtimeMs);
      await pool.query(
        `INSERT INTO questions (id,title,difficulty,tags,problemStatement,constraints,examples,functionName,pythonFunctionName,cppFunctionName,params,starterCode,visibleTestCases,hiddenTestCases,createdAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE title=VALUES(title), difficulty=VALUES(difficulty)`,
        [q.id, q.title, q.difficulty, JSON.stringify(q.tags||[]), q.problemStatement, JSON.stringify(q.constraints||[]), JSON.stringify(q.examples||[]), q.functionName, q.pythonFunctionName||null, q.cppFunctionName||null, JSON.stringify(q.params), JSON.stringify(q.starterCode), JSON.stringify(q.visibleTestCases), JSON.stringify(q.hiddenTestCases), createdAt]
      );
    } catch (e) { console.warn('migrate skip', file, e.message); }
  }
  console.log('DB: migrate from files done');
}

async function dbLoadQuestions() {
  try {
    const [rows] = await getPool().query('SELECT q.*, u.username as addedByUsername FROM questions q LEFT JOIN users u ON q.addedBy = u.id ORDER BY q.createdAt DESC');
    return rows.map(r => ({
      id: r.id, title: r.title, difficulty: r.difficulty,
      tags: typeof r.tags==='string' ? JSON.parse(r.tags) : r.tags || [],
      problemStatement: r.problemStatement,
      constraints: typeof r.constraints==='string' ? JSON.parse(r.constraints) : r.constraints || [],
      examples: typeof r.examples==='string' ? JSON.parse(r.examples) : r.examples || [],
      functionName: r.functionName, pythonFunctionName: r.pythonFunctionName, cppFunctionName: r.cppFunctionName,
      params: typeof r.params==='string' ? JSON.parse(r.params) : r.params,
      starterCode: typeof r.starterCode==='string' ? JSON.parse(r.starterCode) : r.starterCode,
      visibleTestCases: typeof r.visibleTestCases==='string' ? JSON.parse(r.visibleTestCases) : r.visibleTestCases,
      hiddenTestCases: typeof r.hiddenTestCases==='string' ? JSON.parse(r.hiddenTestCases) : r.hiddenTestCases,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
      addedBy: r.addedBy || null,
      addedByUsername: r.addedByUsername || null,
      _createdAt: r.createdAt ? new Date(r.createdAt).getTime() : Date.now(),
      _file: r.id+'.json'
    }));
  } catch (e) {
    console.error('DB load failed, falling back to files:', e.message);
    return null;
  }
}

async function dbGetQuestion(id) {
  const [rows] = await getPool().query('SELECT q.*, u.username as addedByUsername FROM questions q LEFT JOIN users u ON q.addedBy = u.id WHERE q.id=?', [id]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id, title: r.title, difficulty: r.difficulty,
    tags: typeof r.tags==='string' ? JSON.parse(r.tags) : r.tags || [],
    problemStatement: r.problemStatement,
    constraints: typeof r.constraints==='string' ? JSON.parse(r.constraints) : r.constraints || [],
    examples: typeof r.examples==='string' ? JSON.parse(r.examples) : r.examples || [],
    functionName: r.functionName, pythonFunctionName: r.pythonFunctionName, cppFunctionName: r.cppFunctionName,
    params: typeof r.params==='string' ? JSON.parse(r.params) : r.params,
    starterCode: typeof r.starterCode==='string' ? JSON.parse(r.starterCode) : r.starterCode,
    visibleTestCases: typeof r.visibleTestCases==='string' ? JSON.parse(r.visibleTestCases) : r.visibleTestCases,
    hiddenTestCases: typeof r.hiddenTestCases==='string' ? JSON.parse(r.hiddenTestCases) : r.hiddenTestCases,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
    addedBy: r.addedBy || null,
    addedByUsername: r.addedByUsername || null,
  };
}

async function dbCreateQuestion(q, addedBy=null, addedByUsername=null) {
  const pool = getPool();
  const createdAt = q.createdAt ? new Date(q.createdAt) : new Date();
  await pool.query(
    `INSERT INTO questions (id,title,difficulty,tags,problemStatement,constraints,examples,functionName,pythonFunctionName,cppFunctionName,params,starterCode,visibleTestCases,hiddenTestCases,createdAt,addedBy,addedByUsername)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [q.id, q.title, q.difficulty, JSON.stringify(q.tags||[]), q.problemStatement, JSON.stringify(q.constraints||[]), JSON.stringify(q.examples||[]), q.functionName, q.pythonFunctionName||null, q.cppFunctionName||null, JSON.stringify(q.params), JSON.stringify(q.starterCode), JSON.stringify(q.visibleTestCases), JSON.stringify(q.hiddenTestCases), createdAt, addedBy, addedByUsername]
  );
}

module.exports = { migrateFromFiles, dbLoadQuestions, dbGetQuestion, dbCreateQuestion };
