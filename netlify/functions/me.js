const { requireUser } = require("../lib/auth");

exports.handler = async (event) => {
  const user = requireUser(event);
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: "Belum login" }) };
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: { username: user.username, role: user.role, name: user.name } }),
  };
};
