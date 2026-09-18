// Notifikasi Telegram — sifatnya "best-effort", sama seperti sinkronisasi Sheets:
// kalau belum di-setup atau API-nya error, agenda tetap berhasil dibuat,
// errornya cuma di-log (tidak dilempar ke pemanggil).
//
// Catatan teknis: ini SEND-ONLY (bot cuma mengirim, tidak menerima/membalas).
// Mengirim pesan = 1 panggilan HTTPS keluar, jadi cocok jalan di serverless
// Netlify Functions. Yang TIDAK bisa di serverless itu mode "polling"
// (bot nongkrong terus menunggu pesan masuk) — dan itu memang tidak dibutuhkan
// untuk kebutuhan notifikasi satu arah seperti ini.

function isConfigured() {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

// Telegram MarkdownV2 mewajibkan karakter-karakter ini di-escape, kalau tidak
// pesan akan ditolak API dengan error "can't parse entities".
function escapeMarkdown(text) {
  return String(text == null ? "" : text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

async function sendMessage(text, buttonUrl, buttonLabel) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
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

// Dipanggil setelah agenda baru berhasil dibuat.
async function notifyAgendaBaru(item, siteUrl) {
  try {
    if (!isConfigured()) {
      console.warn("[telegram] Belum dikonfigurasi (cek TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID) — notifikasi dilewati.");
      return;
    }

    const disposisi = (item.tags || []).join(", ");
    const lines = [
      "*Agenda Baru*",
      "",
      `📅 ${escapeMarkdown(item.tanggal)} · ${escapeMarkdown(item.jam)}`,
      `📨 Asal Surat: *${escapeMarkdown(item.asalSurat)}*`,
      `📝 ${escapeMarkdown(item.keterangan)}`,
    ];
    if (disposisi) lines.push(`🏷️ ${escapeMarkdown(disposisi)}`);
    if (item.noSurat) lines.push(`✉️ No\\. Surat: ${escapeMarkdown(item.noSurat)}`);

    await sendMessage(lines.join("\n"), siteUrl, "📂 Buka Website Agenda");
    console.log(`[telegram] Notifikasi agenda #${item.id} terkirim.`);
  } catch (err) {
    console.error("[telegram] Gagal kirim notifikasi:", err.message);
  }
}

module.exports = { notifyAgendaBaru, isConfigured };
