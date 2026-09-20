const { signToken, setCookieHeader } = require("../lib/auth");

// Cuma 2 akun tetap sesuai kebutuhan testing ini. Password diambil dari
// environment variable Netlify, bukan ditulis di kode.
const ACCOUNTS = {
  lisa: { password: process.env.LISA_PASSWORD || "lisa123", role: "sekretaris", name: "Lisa" },
  amir: { password: process.env.AMIR_PASSWORD || "amir123", role: "kepala", name: "Amir" },
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Body tidak valid" }) };
  }

  const username = String(body.username || "").toLowerCase().trim();
  const acc = ACCOUNTS[username];
  if (!acc || acc.password !== body.password) {
    return { statusCode: 401, body: JSON.stringify({ error: "Username atau password salah" }) };
  }

  // "Ingat Saya": sesi login bertahan 30 hari alih-alih 12 jam. Yang disimpan
  // TETAP cuma token sesi terenkripsi di cookie (httpOnly, tidak bisa dibaca
  // JavaScript) — password aslinya sendiri TIDAK PERNAH disimpan di manapun
  // di sisi browser, supaya tetap aman walau "diingat".
  const REMEMBER_EXPIRY = 60 * 60 * 24 * 30; // 30 hari
  const DEFAULT_EXPIRY = 60 * 60 * 12; // 12 jam
  const expiresInSeconds = body.remember ? REMEMBER_EXPIRY : DEFAULT_EXPIRY;

  const user = { username, role: acc.role, name: acc.name };
  const token = signToken(user, expiresInSeconds);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": setCookieHeader(token, expiresInSeconds) },
    body: JSON.stringify({ user }),
  };
};
