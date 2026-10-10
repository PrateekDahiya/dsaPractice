// state.js — shared mutable state (questions, current question/language, solved sets). Split from app.js; plain classic script.
// Load order (index.html): own-editor, state, core, questions, editor, run, results, history, performance, add-question, shell.


let questions = [];

let currentQuestion = null;

let currentLang = "cpp";
