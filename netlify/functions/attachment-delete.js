const { getStore, connectLambda } = require("@netlify/blobs");
const { requireUser } = require("../lib/auth");
const { readState, writeState } = require("../lib/db");
const { upsertAgendaRow } = require("../lib/sheets");

function filesStore() {
  return getStore("pdf-files");
}
function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  try {
    connectLambda(event); // WAJIB dipanggil sebelum getStore(), lihat catatan di README
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const user = requireUser(event);
    if (!user || user.role !== "sekretaris") {
      return json(403, { error: "Hanya Sekretaris yang boleh menghapus file" });
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Body tidak valid" });
    }

    const agendaId = Number(body.agendaId);
    const fileId = body.fileId;
    if (!agendaId || !fileId) return json(400, { error: "agendaId & fileId wajib diisi" });

    const state = await readState();
    const item = state.agenda.find((a) => a.id === agendaId);
    if (!item) return json(404, { error: "Agenda tidak ditemukan" });

    item.attachments = (item.attachments || []).filter((f) => f.id !== fileId);
    await writeState(state);
    await filesStore().delete(fileId);
    const siteUrl = process.env.URL || `https://${event.headers.host || ""}`;
    await upsertAgendaRow(item, siteUrl); // kolom "Dokumen" di Google Sheets ikut ter-update (link ke file berikutnya, atau kosong kalau habis)

    return json(200, { ok: true });
  } catch (err) {
    console.error("[attachment-delete] error:", err);
    return json(500, { error: "Server error: " + err.message });
  }
};
