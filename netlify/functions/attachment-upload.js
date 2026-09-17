const Busboy = require("busboy");
const crypto = require("crypto");
const { getStore, connectLambda } = require("@netlify/blobs");
const { requireUser } = require("../lib/auth");
const { readState, writeState } = require("../lib/db");
const { upsertAgendaRow } = require("../lib/sheets");

const MAX_SIZE = 4 * 1024 * 1024; // 4MB, aman di bawah limit payload function Netlify

function filesStore() {
  return getStore("pdf-files");
}
function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

function parseMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType = (event.headers && (event.headers["content-type"] || event.headers["Content-Type"])) || "";
    const busboy = Busboy({ headers: { "content-type": contentType } });

    let buffer = Buffer.alloc(0);
    let fileName = null;
    let mimeType = null;
    let tooBig = false;
    let sawFile = false;

    busboy.on("file", (fieldname, file, info) => {
      sawFile = true;
      fileName = info.filename;
      mimeType = info.mimeType || info.mimetype;
      file.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > MAX_SIZE) tooBig = true;
      });
    });
    busboy.on("finish", () => {
      if (!sawFile) return reject(new Error("NO_FILE"));
      if (tooBig) return reject(new Error("TOO_LARGE"));
      resolve({ fileName, mimeType, buffer });
    });
    busboy.on("error", reject);

    const bodyBuffer = event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body || "", "binary");
    busboy.end(bodyBuffer);
  });
}

exports.handler = async (event) => {
  try {
    connectLambda(event); // WAJIB dipanggil sebelum getStore(), lihat catatan di README
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

    const user = requireUser(event);
    if (!user || user.role !== "sekretaris") {
      return json(403, { error: "Hanya Sekretaris yang boleh mengunggah file" });
    }

    const agendaId = Number((event.queryStringParameters || {}).agendaId);
    if (!agendaId) return json(400, { error: "agendaId wajib diisi" });

    const state = await readState();
    const item = state.agenda.find((a) => a.id === agendaId);
    if (!item) return json(404, { error: "Agenda tidak ditemukan" });

    let parsed;
    try {
      parsed = await parseMultipart(event);
    } catch (e) {
      if (e.message === "TOO_LARGE") return json(413, { error: "Ukuran file maksimal 4MB" });
      if (e.message === "NO_FILE") return json(400, { error: "Tidak ada file yang dikirim" });
      return json(400, { error: "Gagal membaca file: " + e.message });
    }

    const isPdf = parsed.mimeType === "application/pdf" && (parsed.fileName || "").toLowerCase().endsWith(".pdf");
    if (!isPdf) return json(400, { error: "Hanya file PDF yang diperbolehkan" });

    const fileId = crypto.randomBytes(12).toString("hex");
    await filesStore().set(fileId, parsed.buffer);

    item.attachments = item.attachments || [];
    const entry = {
      id: fileId,
      name: parsed.fileName,
      size: parsed.buffer.length,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user.name,
    };
    item.attachments.push(entry);
    await writeState(state);
    await upsertAgendaRow(item); // kolom "Dokumen" di Google Sheets ikut ter-update

    return json(201, { attachment: entry, item });
  } catch (err) {
    console.error("[attachment-upload] error:", err);
    return json(500, { error: "Server error: " + err.message });
  }
};
