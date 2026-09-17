const { getStore, connectLambda } = require("@netlify/blobs");
const { requireUser } = require("../lib/auth");
const { readState } = require("../lib/db");

function filesStore() {
  return getStore("pdf-files");
}

exports.handler = async (event) => {
  try {
    connectLambda(event); // WAJIB dipanggil sebelum getStore(), lihat catatan di README
    const user = requireUser(event);
    if (!user) return { statusCode: 401, body: "Belum login" };

    const q = event.queryStringParameters || {};
    const agendaId = Number(q.agendaId);
    const fileId = q.fileId;
    if (!agendaId || !fileId) return { statusCode: 400, body: "agendaId & fileId wajib diisi" };

    const state = await readState();
    const item = state.agenda.find((a) => a.id === agendaId);
    const entry = item && (item.attachments || []).find((f) => f.id === fileId);
    if (!entry) return { statusCode: 404, body: "File tidak ditemukan" };

    const bytes = await filesStore().get(fileId, { type: "arrayBuffer" });
    if (!bytes) return { statusCode: 404, body: "File tidak ditemukan" };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(entry.name)}"`,
        "Cache-Control": "private, no-store",
      },
      body: Buffer.from(bytes).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("[attachment-view] error:", err);
    return { statusCode: 500, body: "Server error: " + err.message };
  }
};
