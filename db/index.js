const { getPool } = require('./pool');
const { initDb } = require('./init');
const { migrateFromFiles, dbLoadQuestions, dbGetQuestion, dbCreateQuestion } = require('./questions');
const { createUser, findUserByUsername, findUserById, findUserByEmail } = require('./users');
const { dbSaveCode, dbGetCode } = require('./code');
const { dbCreateSubmission, dbGetSubmissions } = require('./submissions');
const { getSolvedIds, getStats, getLeaderboard, getUserDashboard } = require('./stats');

module.exports = {
  getPool, initDb, migrateFromFiles,
  dbLoadQuestions, dbGetQuestion, dbCreateQuestion,
  createUser, findUserByUsername, findUserById, findUserByEmail,
  dbSaveCode, dbGetCode,
  dbCreateSubmission, dbGetSubmissions,
  getSolvedIds, getStats, getLeaderboard, getUserDashboard
};
