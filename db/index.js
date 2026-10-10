const { getPool } = require('./pool');
const { initDb } = require('./init');
const { migrateFromFiles, dbLoadQuestions, dbGetQuestion, dbCreateQuestion, dbUpdateQuestion, dbDeleteQuestion } = require('./questions');
const { createUser, findUserByUsername, findUserById, findUserByEmail, publicUser, listUsers, setUserRole, updateProfile, getPublicProfile } = require('./users');
const { dbSaveCode, dbGetCode } = require('./code');
const { dbCreateSubmission, dbUpdateSubmissionComplexity, dbGetSubmissions } = require('./submissions');
const { getSolvedIds, getStats, getLeaderboard, getStreaks, getUserDashboard, getQuestionStats, getQuestionPerf, clearStatsCache } = require('./stats');
const { markDone, unmarkDone, getManualSolvedIds, isMarkedDone } = require('./manual');
const { addBookmark, removeBookmark, getBookmarkIds } = require('./bookmarks');
const { seedMethodDocs, searchMethods, getMethodDoc } = require('./methods');

module.exports = {
  getPool, initDb, migrateFromFiles,
  dbLoadQuestions, dbGetQuestion, dbCreateQuestion, dbUpdateQuestion, dbDeleteQuestion,
  createUser, findUserByUsername, findUserById, findUserByEmail, publicUser, listUsers, setUserRole, updateProfile, getPublicProfile,
  dbSaveCode, dbGetCode,
  dbCreateSubmission, dbUpdateSubmissionComplexity, dbGetSubmissions,
  getSolvedIds, getStats, getLeaderboard, getStreaks, getUserDashboard, getQuestionStats, getQuestionPerf, clearStatsCache,
  markDone, unmarkDone, getManualSolvedIds, isMarkedDone,
  addBookmark, removeBookmark, getBookmarkIds,
  seedMethodDocs, searchMethods, getMethodDoc
};
