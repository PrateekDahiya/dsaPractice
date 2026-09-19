const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

function getSecret() {
  return process.env.JWT_SECRET || "dev-secret";
}
function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}
function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}
function signToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: "7d" });
}
function verifyToken(token) {
  return jwt.verify(token, getSecret());
}
function authenticate(req) {
  const h = req.headers["authorization"] || req.headers["Authorization"] || "";
  if (!h || !h.startsWith("Bearer ")) return null;
  const token = h.slice(7).trim();
  if (!token) return null;
  try {
    const decoded = verifyToken(token);
    req.user = { id: decoded.id, username: decoded.username, role: decoded.role };
    return req.user;
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, authenticate, getSecret };
