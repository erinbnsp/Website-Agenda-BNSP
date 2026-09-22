// Sinkronisasi ke Google Sheets — sifatnya "best-effort":
// - Kalau env var belum di-setup, semua fungsi di sini diam-diam tidak
//   melakukan apapun (return langsung), TIDAK melempar error.
// - Kalau Google Sheets API error/timeout, error-nya cuma di-log ke console,
//   TIDAK dilempar ke pemanggil — supaya create/edit/hapus/upload agenda
//   tetap berhasil normal walau sinkronisasi ke spreadsheet-nya gagal.
const SHEET_TITLE = "Agenda";
const HEADER = ["ID", "Tanggal", "Jam", "Asal Surat", "Keterangan", "Disposisi", "No. Disposisi", "No. Surat", "Dokumen"];

// Ambil kredensial service account. Cara yang DIREKOMENDASIKAN: satu env var
// GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 berisi seluruh file JSON key yang
// di-encode base64 — ini jauh lebih aman dari corrupt newline dibanding
// paste private_key mentah ke kotak teks Netlify (base64 cuma huruf/angka,
// tidak mungkin rusak walau di-copy-paste lewat form web).
// Cara lama (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY terpisah)
// tetap didukung sebagai fallback untuk yang sudah terlanjur setup begitu.
function getServiceAccountCredentials() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (b64) {
    try {
      const decoded = Buffer.from(b64.trim(), "base64").toString("utf-8");
      const parsed = JSON.parse(decoded);
      if (parsed.client_email && parsed.private_key) {
        return { email: parsed.client_email, key: parsed.private_key };
      }
      console.error("[sheets] GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 valid base64/JSON tapi tidak ada client_email/private_key di dalamnya");
    } catch (err) {
      console.error("[sheets] GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 gagal di-decode:", err.message);
    }
    return null;
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }

  return null;
}

function isConfigured() {
  return !!(getServiceAccountCredentials() && process.env.GOOGLE_SHEET_ID);
}

// Cache di level modul: Netlify sering memakai ulang container yang sudah "hangat"
// untuk request berikutnya, dan isi modul ikut bertahan. Dengan menyimpan hasil
// autentikasi + info spreadsheet di sini, request berikutnya tidak perlu
// autentikasi & loadInfo() ulang (2 panggilan jaringan ke Google) — cukup langsung
// baca/tulis baris. Data barisnya sendiri TETAP diambil fresh tiap kali lewat
// getRows(), jadi tidak ada resiko data basi.
let cachedSheet = null;

async function getSheet() {
  if (cachedSheet) return cachedSheet;

  const creds = getServiceAccountCredentials();
  if (!creds || !process.env.GOOGLE_SHEET_ID) return null;

  const { GoogleSpreadsheet } = require("google-spreadsheet");
  const { JWT } = require("google-auth-library");

  const auth = new JWT({
    email: creds.email,
    key: creds.key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, auth);
  await doc.loadInfo();

  let sheet = doc.sheetsByTitle[SHEET_TITLE];
  if (!sheet) {
    sheet = await doc.addSheet({ title: SHEET_TITLE, headerValues: HEADER });
  } else {
    try {
      await sheet.loadHeaderRow();
    } catch {
      // Sheet ada tapi belum ada baris header (baru dibuat manual) -> buatkan
      await sheet.setHeaderRow(HEADER);
    }
  }

  cachedSheet = sheet;
  return sheet;
}

function rowValuesFromItem(item, siteUrl) {
  const attachments = item.attachments || [];
  let dokumenValue = "";

  if (attachments.length > 0) {
    const utama = attachments[0];
    const linkTujuan = `${siteUrl.replace(/\/$/, "")}/?agendaId=${item.id}&fileId=${utama.id}`;
    const label =
      attachments.length > 1
        ? `${utama.name} (+${attachments.length - 1} lainnya)`
        : utama.name;
    // Tanda kutip di nama file (kalau ada) wajib di-escape jadi "" sesuai
    // aturan formula Google Sheets, supaya formula HYPERLINK-nya tidak rusak.
    const labelAman = label.replace(/"/g, '""');
    dokumenValue = `=HYPERLINK("${linkTujuan}", "${labelAman}")`;
  }

  return {
    ID: String(item.id),
    Tanggal: item.tanggal,
    Jam: item.jam,
    "Asal Surat": item.asalSurat,
    Keterangan: item.keterangan,
    Disposisi: (item.tags || []).join(", "),
    "No. Disposisi": item.noDisposisi || "",
    "No. Surat": item.noSurat || "",
    Dokumen: dokumenValue,
  };
}

// Buat baris baru kalau agenda ini belum pernah disinkronkan, atau update baris
// yang sudah ada (dicocokkan lewat kolom ID) kalau sudah pernah — dipakai untuk
// create, edit, maupun setelah upload dokumen (supaya kolom Dokumen ikut update).
// Khusus AGENDA BARU — langsung tambah baris, TANPA baca seluruh spreadsheet
// dulu untuk mencari baris yang cocok. Ini aman dipakai di sini karena ID
// agenda baru sudah pasti belum pernah ada barisnya di spreadsheet manapun.
// Dipakai di jalur create supaya tidak menunggu pembacaan seluruh isi sheet
// (yang jadi makin lambat seiring datanya membesar) untuk hal yang hasilnya
// sudah pasti "tidak ketemu, buat baru saja".
async function insertAgendaRow(item, siteUrl) {
  try {
    if (!isConfigured()) {
      console.warn("[sheets] Belum dikonfigurasi (cek GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 dan GOOGLE_SHEET_ID di Environment Variables) — sinkronisasi dilewati.");
      return;
    }
    const sheet = await getSheet();
    if (!sheet) return;

    await sheet.addRow(rowValuesFromItem(item, siteUrl));
    console.log(`[sheets] Baris agenda #${item.id} berhasil ditambahkan.`);
  } catch (err) {
    console.error("[sheets] Gagal sinkron ke Google Sheets:", err.message);
  }
}

// Dipakai untuk edit, upload/hapus dokumen, dst — baris agenda-nya MUNGKIN
// sudah ada di spreadsheet, jadi tetap perlu dicari dulu lewat kolom ID.
async function upsertAgendaRow(item, siteUrl) {
  try {
    if (!isConfigured()) {
      console.warn("[sheets] Belum dikonfigurasi (cek GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 dan GOOGLE_SHEET_ID di Environment Variables) — sinkronisasi dilewati.");
      return;
    }
    const sheet = await getSheet();
    if (!sheet) return;

    const rows = await sheet.getRows();
    const existing = rows.find((r) => r.get("ID") === String(item.id));
    const values = rowValuesFromItem(item, siteUrl);

    if (existing) {
      Object.entries(values).forEach(([key, val]) => existing.set(key, val));
      await existing.save();
    } else {
      await sheet.addRow(values);
    }
    console.log(`[sheets] Baris agenda #${item.id} berhasil disinkron.`);
  } catch (err) {
    console.error("[sheets] Gagal sinkron ke Google Sheets:", err.message);
  }
}

async function deleteAgendaRow(itemId) {
  try {
    if (!isConfigured()) return;
    const sheet = await getSheet();
    if (!sheet) return;

    const rows = await sheet.getRows();
    const existing = rows.find((r) => r.get("ID") === String(itemId));
    if (existing) await existing.delete();
  } catch (err) {
    console.error("[sheets] Gagal hapus baris di Google Sheets:", err.message);
  }
}

module.exports = { insertAgendaRow, upsertAgendaRow, deleteAgendaRow, isConfigured };
