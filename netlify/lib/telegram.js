// Notifikasi Telegram — sifatnya "best-effort", sama seperti sinkronisasi Sheets:
// kalau belum di-setup atau API-nya error, agenda tetap berhasil dibuat,
// errornya cuma di-log (tidak dilempar ke pemanggil).
//
// Catatan teknis: ini SEND-ONLY (bot cuma mengirim, tidak menerima/membalas).
// Mengirim pesan = 1 panggilan HTTPS keluar, jadi cocok jalan di serverless
// Netlify Functions. Yang TIDAK bisa di serverless itu mode "polling"
// (bot nongkrong terus menunggu pesan masuk) — dan itu memang tidak dibutuhkan
// untuk kebutuhan notifikasi satu arah seperti ini.

// TELEGRAM_CHAT_ID boleh diisi lebih dari satu, dipisah koma — bisa campur
// chat pribadi & grup dalam satu env var yang sama, contoh:
// "111111111,-1001234567890,222222222"
function getChatIds() {
  return (process.env.TELEGRAM_CHAT_ID || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function isConfigured() {
  return !!(process.env.TELEGRAM_BOT_TOKEN && getChatIds().length > 0);
}

// Telegram MarkdownV2 mewajibkan karakter-karakter ini di-escape, kalau tidak
// pesan akan ditolak API dengan error "can't parse entities".
function escapeMarkdown(text) {
  return String(text == null ? "" : text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

async function sendMessage(chatId, text, buttonUrl, buttonLabel) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
      ...(buttonUrl
        ? { reply_markup: { inline_keyboard: [[{ text: buttonLabel || "Buka Agenda", url: buttonUrl }]] } }
        : {}),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(data.description || `HTTP ${res.status}`);
  }
}

// Nama hari & bulan dalam Bahasa Indonesia, supaya pesan notifikasi enak dibaca
// ("Kamis, 18 September 2026") bukan sekadar "2026-09-18".
const NAMA_HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const NAMA_BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function formatTanggalIndo(tanggalStr) {
  const d = new Date(`${tanggalStr}T00:00:00`);
  if (isNaN(d.getTime())) return tanggalStr; // jaga-jaga kalau formatnya tidak terduga
  return `${NAMA_HARI[d.getDay()]}, ${d.getDate()} ${NAMA_BULAN[d.getMonth()]} ${d.getFullYear()}`;
}

// Keterangan panjang dipotong supaya notifikasi tetap ringkas & enak dibaca di HP —
// detail lengkapnya tetap bisa dilihat dengan membuka websitenya.
function ringkas(teks, maksimal = 160) {
  const t = String(teks || "").trim();
  return t.length > maksimal ? `${t.slice(0, maksimal).trimEnd()}…` : t;
}

// Dipanggil setelah agenda baru berhasil dibuat.
async function notifyAgendaBaru(item, siteUrl) {
  try {
    if (!isConfigured()) {
      console.warn("[telegram] Belum dikonfigurasi (cek TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID) — notifikasi dilewati.");
      return;
    }

    const disposisi = (item.tags || []).join(" • ");
    const lines = [
      "🔔 *AGENDA BARU*",
      "━━━━━━━━━━━━━━━",
      "",
      `🗓 *${escapeMarkdown(formatTanggalIndo(item.tanggal))}*`,
      `🕐 Pukul *${escapeMarkdown(item.jam)}* WIB`,
      "",
      `🏛 *Asal Surat*`,
      `${escapeMarkdown(item.asalSurat)}`,
      "",
      `📝 *Keterangan*`,
      `${escapeMarkdown(ringkas(item.keterangan))}`,
    ];

    if (disposisi) {
      lines.push("", `🏷 *Disposisi*`, `${escapeMarkdown(disposisi)}`);
    }

    const nomor = [];
    if (item.noSurat) nomor.push(`No\\. Surat: ${escapeMarkdown(item.noSurat)}`);
    if (item.noDisposisi) nomor.push(`No\\. Disposisi: ${escapeMarkdown(item.noDisposisi)}`);
    if (nomor.length) lines.push("", ...nomor.map((n) => `📄 ${n}`));

    lines.push("", "━━━━━━━━━━━━━━━", `_Dibuat oleh ${escapeMarkdown(item.createdByName || "Sekretaris")}_`);

    const text = lines.join("\n");

    // Link diberi penanda "?u=amir" supaya begitu dibuka, websitenya memastikan
    // yang masuk adalah akun Kepala Sekretariat — bukan akun lain yang mungkin
    // masih tertinggal login di HP itu.
    const linkTujuan = `${siteUrl.replace(/\/$/, "")}/?u=amir`;

    // Dikirim ke semua penerima SEKALIGUS (bukan antri satu-satu) — dan kalau
    // salah satu chat ID bermasalah (misal bot di-block orang itu), penerima
    // lain tetap dapat notifikasinya, tidak ikut gagal semua.
    const chatIds = getChatIds();
    const results = await Promise.allSettled(chatIds.map((id) => sendMessage(id, text, linkTujuan, "📂 Buka Agenda Sekretariat")));
    const failed = results.filter((r) => r.status === "rejected");

    if (failed.length > 0) {
      console.error(
        `[telegram] ${failed.length}/${chatIds.length} penerima gagal dikirimi notifikasi:`,
        failed.map((f) => f.reason.message).join("; ")
      );
    }
    if (failed.length < chatIds.length) {
      console.log(`[telegram] Notifikasi agenda #${item.id} terkirim ke ${chatIds.length - failed.length}/${chatIds.length} penerima.`);
    }
  } catch (err) {
    console.error("[telegram] Gagal kirim notifikasi:", err.message);
  }
}

module.exports = { notifyAgendaBaru, isConfigured };
