const { getPool } = require('./pool');

async function initDb() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS questions (
      id VARCHAR(100) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      difficulty ENUM('Easy','Medium','Hard') NOT NULL,
      tags JSON,
      problemStatement TEXT NOT NULL,
      constraints JSON,
      examples JSON,
      functionName VARCHAR(100) NOT NULL,
      pythonFunctionName VARCHAR(100),
      cppFunctionName VARCHAR(100),
      params JSON NOT NULL,
      starterCode JSON NOT NULL,
      visibleTestCases JSON NOT NULL,
      hiddenTestCases JSON NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('user','admin') DEFAULT 'user',
      avatar VARCHAR(500),
      bio TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS code_saves (
      id INT AUTO_INCREMENT PRIMARY KEY,
      questionId VARCHAR(100) NOT NULL,
      language ENUM('cpp','javascript','python') NOT NULL,
      code MEDIUMTEXT NOT NULL,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_q_lang (questionId, language),
      FOREIGN KEY (questionId) REFERENCES questions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      questionId VARCHAR(100) NOT NULL,
      title VARCHAR(255),
      language ENUM('cpp','javascript','python') NOT NULL,
      mode ENUM('run','submit') NOT NULL,
      code MEDIUMTEXT NOT NULL,
      passed INT NOT NULL,
      total INT NOT NULL,
      results JSON NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_q (questionId),
      INDEX idx_created (createdAt),
      FOREIGN KEY (questionId) REFERENCES questions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      userId INT NOT NULL,
      questionId VARCHAR(100) NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (userId, questionId),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (questionId) REFERENCES questions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  try { await pool.query(`ALTER TABLE code_saves ADD COLUMN userId INT NULL`); } catch (e) { if (!String(e.message).toLowerCase().includes('duplicate')) {} }
  try { await pool.query(`ALTER TABLE code_saves ADD UNIQUE KEY uniq_user_q_lang (userId, questionId, language)`); } catch {}
  try { await pool.query(`ALTER TABLE code_saves ADD INDEX idx_user_q (userId, questionId)`); } catch {}
  try { await pool.query(`ALTER TABLE code_saves ADD CONSTRAINT fk_code_saves_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE`); } catch {}
  try { await pool.query(`ALTER TABLE submissions ADD COLUMN userId INT NULL`); } catch {}
  try { await pool.query(`ALTER TABLE submissions ADD INDEX idx_user_q (userId, questionId)`); } catch {}
  try { await pool.query(`ALTER TABLE submissions ADD UNIQUE KEY uniq_user_q_lang (userId, questionId, language)`); } catch {}
  try { await pool.query(`ALTER TABLE submissions ADD CONSTRAINT fk_submissions_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE`); } catch {}
  try { await pool.query(`ALTER TABLE users MODIFY COLUMN email VARCHAR(255) NULL`); } catch {}
  try { await pool.query(`ALTER TABLE code_saves DROP INDEX uniq_q_lang`); } catch {}
  try { await pool.query(`ALTER TABLE submissions DROP INDEX uniq_user_q_lang`); } catch {}

  // indexes for dashboard speed (composite covering)
  try { await pool.query(`CREATE INDEX idx_sub_user_passed_mode_created ON submissions (userId, passed, mode, createdAt)`); } catch {}
  try { await pool.query(`CREATE INDEX idx_sub_user_q_created ON submissions (userId, questionId, createdAt)`); } catch {}
  try { await pool.query(`CREATE INDEX idx_sub_user_passed_mode_qid ON submissions (userId, passed, mode, questionId)`); } catch {}
  try { await pool.query(`CREATE INDEX idx_questions_created ON questions (createdAt)`); } catch {}
  try { await pool.query(`CREATE INDEX idx_questions_difficulty ON questions (difficulty)`); } catch {}
  try { await pool.query(`ALTER TABLE questions ADD COLUMN addedBy INT NULL`); } catch {}
  try { await pool.query(`ALTER TABLE questions ADD COLUMN addedByUsername VARCHAR(50) NULL`); } catch {}
  try { await pool.query(`ALTER TABLE questions ADD INDEX idx_addedBy (addedBy)`); } catch {}
  try { await pool.query(`ALTER TABLE questions ADD CONSTRAINT fk_questions_addedBy FOREIGN KEY (addedBy) REFERENCES users(id) ON DELETE SET NULL`); } catch {}
  // Hikari-like warmup: pre-create 3 idle connections
  try {
    const { warmPool } = require('./pool');
    await warmPool(3);
  } catch (e) { console.warn('pool warmup skipped', e.message); }
  console.log('DB: questions, users, bookmarks, code_saves, submissions ready (pool warmed)');
  return pool;
}

module.exports = { initDb };
