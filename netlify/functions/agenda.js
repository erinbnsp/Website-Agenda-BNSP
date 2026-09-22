const { connectLambda } = require("@netlify/blobs");
const { requireUser } = require("../lib/auth");
const { readState, writeState } = require("../lib/db");
const { insertAgendaRow } = require("../lib/sheets");
const { notifyAgendaBaru } = require("../lib/telegram");

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

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

exports.handler = async (event) => {
  try {
    connectLambda(event); // WAJIB dipanggil sebelum getStore(), lihat catatan di README
    const user = requireUser(event);
    if (!user) return json(401, { error: "Belum login" });

    if (event.httpMethod === "GET") {
      const state = await readState();
      let items = state.agenda;
      const tanggal = (event.queryStringParameters || {}).tanggal;
      if (tanggal) items = items.filter((a) => a.tanggal === tanggal);
      items = items.slice().sort((a, b) => (a.tanggal + a.jam).localeCompare(b.tanggal + b.jam));
      return json(200, { items });
    }

    if (event.httpMethod === "POST") {
      if (user.role !== "sekretaris") {
        return json(403, { error: "Hanya Sekretaris yang boleh menambah agenda" });
      }
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return json(400, { error: "Body tidak valid" });
      }
      const { tanggal, jam, asalSurat, keterangan, tags, noDisposisi, noSurat } = body;
      if (!tanggal || !jam || !asalSurat || !keterangan) {
        return json(400, { error: "tanggal, jam, asalSurat, dan keterangan wajib diisi" });
      }

      const state = await readState();
      const item = {
        id: state.nextAgendaId++,
        tanggal,
        jam,
        asalSurat: String(asalSurat).trim(),
        keterangan: String(keterangan).trim(),
        tags: Array.isArray(tags) ? tags.filter((t) => VALID_TAGS.includes(t)) : [],
        noDisposisi: noDisposisi ? String(noDisposisi).trim() : "",
        noSurat: noSurat ? String(noSurat).trim() : "",
        status: "baru",
        attachments: [],
        createdBy: user.username,
        createdByName: user.name,
        createdAt: new Date().toISOString(),
      };
      state.agenda.push(item);
      await writeState(state);

      // Sinkron Sheets & notifikasi Telegram dijalankan BERSAMAAN (bukan antri satu-satu)
      // — keduanya panggilan jaringan yang saling independen, jadi total waktunya
      // jadi sepanjang yang paling lama saja, bukan penjumlahan keduanya.
      // Keduanya best-effort: kalau gagal, agenda tetap sudah tersimpan.
      const siteUrl = process.env.URL || `https://${event.headers.host || ""}`;
      await Promise.all([insertAgendaRow(item, siteUrl), notifyAgendaBaru(item, siteUrl)]);

      return json(201, { item });
    }

    return json(405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[agenda] error:", err);
    return json(500, { error: "Server error: " + err.message });
  }
};
