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
    const text = lines.join("\n");

    // Dikirim ke semua penerima SEKALIGUS (bukan antri satu-satu) — dan kalau
    // salah satu chat ID bermasalah (misal bot di-block orang itu), penerima
    // lain tetap dapat notifikasinya, tidak ikut gagal semua.
    const chatIds = getChatIds();
    const results = await Promise.allSettled(chatIds.map((id) => sendMessage(id, text, siteUrl, "📂 Buka Website Agenda")));
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
