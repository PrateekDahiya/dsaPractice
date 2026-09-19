// Shim — delegates to modular db/* (keeps require('./db') working)
// New structure: db/pool.js, db/init.js, db/questions.js, db/users.js, db/code.js, db/submissions.js, db/stats.js, db/index.js
module.exports = require('./db/index');
