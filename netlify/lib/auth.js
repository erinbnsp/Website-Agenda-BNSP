const crypto = require("crypto");

const SECRET = process.env.JWT_SECRET || "dev-secret-ganti-ini";
const COOKIE_NAME = "agenda_token";
const COOKIE_SECURE = process.env.COOKIE_SECURE !== "0"; // default aktif (wajib untuk Netlify production https)

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(input) {
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}
function hmac(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signToken(payload, expiresInSeconds = 60 * 60 * 12) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }));
  return `${header}.${body}.${hmac(`${header}.${body}`)}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  if (hmac(`${header}.${body}`) !== sig) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function getCookie(event, name) {
  const header = (event.headers && (event.headers.cookie || event.headers.Cookie)) || "";
  const found = header.split(";").map((s) => s.trim()).find((s) => s.startsWith(name + "="));
  if (!found) return null;
  return decodeURIComponent(found.slice(name.length + 1));
}

function setCookieHeader(token, maxAgeSeconds = 60 * 60 * 12) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${COOKIE_SECURE ? "; Secure" : ""}`;
}

function clearCookieHeader() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${COOKIE_SECURE ? "; Secure" : ""}`;
}

function requireUser(event) {
  return verifyToken(getCookie(event, COOKIE_NAME));
}

module.exports = { signToken, verifyToken, getCookie, setCookieHeader, clearCookieHeader, requireUser };
