const { connectLambda } = require("@netlify/blobs");
const { requireUser } = require("../lib/auth");
const { readState, writeState } = require("../lib/db");
const { upsertAgendaRow, deleteAgendaRow } = require("../lib/sheets");

const VALID_TAGS = [
  "Dipelajari/Dicermati",
  "Ditindaklanjuti",
  "Agar Dimonitor",
  "Dikoordinasikan",
  "Segera Buat Laporan",
  "Siapkan Bahan",
  "Bahas Dengan Saya",
  "Saran/Penjelasan",
  "Siapkan Jawaban",
  "Copy untuk Saya",
  "Dipedomani",
  "Untuk Diketahui",
  "File/Simpan/Arsip",
  "Agendakan",
  "Mendampingi Kepala",
  "Mewakili Kepala",
];
const VALID_STATUS = ["baru", "dilihat", "ditindaklanjuti", "selesai"];

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  try {
    connectLambda(event); // WAJIB dipanggil sebelum getStore(), lihat catatan di README
    const user = requireUser(event);
    if (!user) return json(401, { error: "Belum login" });

    const id = Number((event.queryStringParameters || {}).id);
    if (!id) return json(400, { error: "Parameter id wajib diisi" });

    const state = await readState();
    const item = state.agenda.find((a) => a.id === id);
    if (!item) return json(404, { error: "Agenda tidak ditemukan" });

    if (event.httpMethod === "GET") {
      return json(200, { item });
    }

    if (event.httpMethod === "PUT") {
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return json(400, { error: "Body tidak valid" });
      }

      if (user.role === "kepala") {
        if (!body.status || !VALID_STATUS.includes(body.status)) {
          return json(400, { error: "Status tidak valid" });
        }
        item.status = body.status;
        await writeState(state);
        return json(200, { item });
      }

      if (user.role !== "sekretaris") return json(403, { error: "Tidak punya akses" });

      if (body.tanggal) item.tanggal = body.tanggal;
      if (body.jam) item.jam = body.jam;
      if (body.asalSurat) item.asalSurat = String(body.asalSurat).trim();
      if (body.keterangan) item.keterangan = String(body.keterangan).trim();
      if (Array.isArray(body.tags)) item.tags = body.tags.filter((t) => VALID_TAGS.includes(t));
      if (body.noDisposisi !== undefined) item.noDisposisi = String(body.noDisposisi).trim();
      if (body.noSurat !== undefined) item.noSurat = String(body.noSurat).trim();
      if (body.status && VALID_STATUS.includes(body.status)) item.status = body.status;
      await writeState(state);
      await upsertAgendaRow(item); // sinkron perubahan ke Google Sheets juga
      return json(200, { item });
    }

    if (event.httpMethod === "DELETE") {
      if (user.role !== "sekretaris") return json(403, { error: "Hanya Sekretaris yang boleh menghapus agenda" });
      state.agenda = state.agenda.filter((a) => a.id !== id);
      await writeState(state);
      await deleteAgendaRow(id); // hapus baris terkait di Google Sheets juga
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[agenda-item] error:", err);
    return json(500, { error: "Server error: " + err.message });
  }
};
