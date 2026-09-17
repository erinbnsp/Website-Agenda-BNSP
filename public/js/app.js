const state = {
  user: null,
  currentDate: new Date(),
  viewMode: "daily", // "list" = semua jadwal, "daily" = per tanggal — default saat login: per tanggal (hari ini)
  searchQuery: "",
  filterTags: [],
};

const TAG_CLASS = {};
const TAG_PILL_COLOR = {};
const DISPOSISI_OPTIONS = [
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

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Terjadi kesalahan (${res.status})`);
  return data;
}

async function apiUpload(path, file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(path, { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Gagal mengunggah file (${res.status})`);
  return data;
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2500);
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtDateLabel(d) {
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function roleLabel(role) {
  return { sekretaris: "Sekretaris", kepala: "Kepala Sekretariat" }[role] || role;
}
function greetingWord() {
  const h = new Date().getHours();
  if (h < 11) return "pagi";
  if (h < 15) return "siang";
  if (h < 19) return "sore";
  return "malam";
}

// "Sudah dibaca" untuk badge notifikasi lonceng — disimpan per user & per tanggal,
// jadi otomatis tidak nyangkut ke hari berikutnya (key-nya beda tiap hari).
function notifSeenKey() {
  const username = (state.user && state.user.username) || "guest";
  return `notif_seen_${username}_${fmtDate(new Date())}`;
}
function getNotifSeenCount() {
  try {
    return Number(localStorage.getItem(notifSeenKey())) || 0;
  } catch {
    return 0;
  }
}
function markNotifSeen(count) {
  try {
    localStorage.setItem(notifSeenKey(), String(count));
  } catch {
    /* localStorage tidak tersedia (mode privat dsb) — abaikan, badge tetap jalan normal cuma tidak "ingat" antar reload */
  }
}
function filterItems(items) {
  let result = items;
  if (state.searchQuery) {
    const q = state.searchQuery;
    result = result.filter(
      (i) =>
        (i.asalSurat || "").toLowerCase().includes(q) ||
        (i.keterangan || "").toLowerCase().includes(q) ||
        (i.noSurat || "").toLowerCase().includes(q) ||
        (i.noDisposisi || "").toLowerCase().includes(q)
    );
  }
  if (state.filterTags.length > 0) {
    result = result.filter((i) => (i.tags || []).some((t) => state.filterTags.includes(t)));
  }
  return result;
}
// Menghitung & menampilkan statistik dari data yang SUDAH di-fetch (tidak fetch ulang) —
// dipisah dari loadStats() supaya tampilan "Semua Jadwal" bisa berbagi 1 kali fetch
// yang sama untuk statistik & daftar agenda, bukan fetch 2x untuk hal yang sama.
function computeAndRenderStats(items) {
  const todayStr = fmtDate(new Date());
  const in7 = new Date();
  in7.setDate(in7.getDate() + 7);
  const in7Str = fmtDate(in7);

  const todayItems = items.filter((i) => i.tanggal === todayStr);
  const totalToday = todayItems.length;

  // "Dokumen Terunggah": di tampilan "Per Tanggal" ikut tanggal yang sedang dibuka;
  // di tampilan "Semua Jadwal" diakumulasi semua (tidak dibatasi tanggal manapun).
  let totalDocs;
  if (state.viewMode === "daily") {
    const docsRefDateStr = fmtDate(state.currentDate);
    totalDocs = items.reduce((sum, i) => {
      const uploadedOnRefDate = (i.attachments || []).filter((a) => a.uploadedAt && fmtDate(new Date(a.uploadedAt)) === docsRefDateStr);
      return sum + uploadedOnRefDate.length;
    }, 0);
  } else {
    totalDocs = items.reduce((sum, i) => sum + (i.attachments || []).length, 0);
  }

  const upcoming = items.filter((i) => i.tanggal > todayStr && i.tanggal <= in7Str).length;

  document.getElementById("statToday").textContent = totalToday;
  document.getElementById("statDocs").textContent = totalDocs;
  document.getElementById("statUpcoming").textContent = upcoming;

  // Disimpan supaya panel preview lonceng tidak perlu fetch ulang saat diklik
  state.todayItemsCache = todayItems;
  state.lastTotalToday = totalToday;

  // Badge notifikasi lonceng: jumlah agenda HARI INI juga — otomatis balik ke 0
  // tiap ganti hari karena dihitung ulang dari tanggal berjalan, bukan angka yang disimpan manual.
  // Hanya ditampilkan kalau jumlahnya LEBIH BANYAK dari yang terakhir "dibaca" (diklik) —
  // begitu diklik, badge hilang; muncul lagi otomatis kalau ada agenda baru ditambahkan setelahnya.
  const badge = document.getElementById("notifBadge");
  const seen = getNotifSeenCount();
  if (totalToday > 0 && totalToday > seen) {
    badge.textContent = totalToday > 99 ? "99+" : totalToday;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

// Dipakai untuk polling berkala (setInterval) — fetch sendiri karena tidak selalu
// dijalankan bersamaan dengan render daftar agenda.
async function loadStats() {
  const { items } = await api("/api/agenda");
  computeAndRenderStats(items);
}

// ---------- Bootstrap ----------
async function boot() {
  try {
    const { user } = await api("/api/me");
    state.user = user;
    showApp();
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById("loginView").classList.remove("hidden");
  document.getElementById("appView").classList.add("hidden");
}

async function showApp() {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
  document.getElementById("userName").textContent = state.user.name;
  document.getElementById("userRole").textContent = roleLabel(state.user.role);
  document.getElementById("addAgendaBtn").classList.toggle("hidden", state.user.role !== "sekretaris");

  document.getElementById("greetingText").textContent = `Selamat ${greetingWord()}, ${state.user.name} 👋`;
  document.getElementById("todayDateText").textContent = fmtDateLabel(new Date());
  document.getElementById("avatarInitial").textContent = (state.user.name || "?").charAt(0).toUpperCase();

  await refreshAgendaView();

  // Cek berkala (tiap 20 detik) supaya badge notifikasi & angka statistik ikut
  // update otomatis kalau ada agenda baru yang ditambahkan orang lain, tanpa
  // perlu reload manual. Dipasang sekali saja walau showApp() sempat terpanggil ulang.
  if (!state._statsPollingStarted) {
    state._statsPollingStarted = true;
    setInterval(loadStats, 20000);
  }
}

// ---------- View mode ----------
async function refreshAgendaView() {
  if (state.viewMode === "list") {
    // 1x fetch dipakai bareng untuk statistik & daftar agenda — sebelumnya masing-masing
    // fetch sendiri-sendiri padahal query-nya identik (optimasi: separuh jumlah request).
    const { items } = await api("/api/agenda");
    computeAndRenderStats(items);
    renderAgendaList(items);
  } else {
    loadStats();
    await loadAgenda();
  }
}

function switchViewMode(mode) {
  state.viewMode = mode;
  document.getElementById("viewListBtn").classList.toggle("active", mode === "list");
  document.getElementById("viewDailyBtn").classList.toggle("active", mode === "daily");
  document.getElementById("listViewWrap").classList.toggle("hidden", mode !== "list");
  document.getElementById("dailyViewWrap").classList.toggle("hidden", mode !== "daily");
  refreshAgendaView();
}

function relativeDayLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d - today) / 86400000);
  const full = fmtDateLabel(d);
  let labelPart;
  if (diffDays === 0) labelPart = "Hari Ini";
  else if (diffDays === 1) labelPart = "Besok";
  else if (diffDays === -1) labelPart = "Kemarin";
  else if (diffDays > 1) labelPart = `${diffDays} hari lagi`;
  else labelPart = `${Math.abs(diffDays)} hari lalu`;
  return `📅 ${labelPart} • ${full}`;
}

function scrollToTodayOrNearest(behavior) {
  const todayEl = document.querySelector(".date-group-today");
  if (todayEl) return todayEl.scrollIntoView({ behavior, block: "start" });
  const next = Array.from(document.querySelectorAll(".date-group")).find((g) => !g.classList.contains("date-group-past"));
  if (next) next.scrollIntoView({ behavior, block: "start" });
}

// ---------- Daily view ----------
async function loadAgenda() {
  document.getElementById("dateLabel").textContent = fmtDateLabel(state.currentDate);
  const { items: rawItems } = await api(`/api/agenda?tanggal=${fmtDate(state.currentDate)}`);
  const items = filterItems(rawItems);
  const grid = document.getElementById("agendaGrid");
  const empty = document.getElementById("emptyState");
  grid.innerHTML = "";
  if (items.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  items.forEach((item, idx) => grid.appendChild(renderCard(item, idx + 1)));
}

// ---------- List view (semua jadwal, lalu & akan datang) ----------
function renderAgendaList(rawItems) {
  const items = filterItems(rawItems);
  const emptyEl = document.getElementById("listEmptyState");
  const jumpBtn = document.getElementById("jumpTodayBtn");
  const container = document.getElementById("agendaListContainer");
  container.innerHTML = "";

  if (items.length === 0) {
    emptyEl.classList.remove("hidden");
    jumpBtn.classList.add("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  jumpBtn.classList.remove("hidden");

  const groups = [];
  items.forEach((item) => {
    const last = groups[groups.length - 1];
    if (!last || last.tanggal !== item.tanggal) groups.push({ tanggal: item.tanggal, items: [item] });
    else last.items.push(item);
  });

  const todayStr = fmtDate(new Date());
  groups.forEach((group) => {
    const section = document.createElement("div");
    section.className = "date-group";
    if (group.tanggal === todayStr) section.classList.add("date-group-today");
    if (group.tanggal < todayStr) section.classList.add("date-group-past");

    const header = document.createElement("div");
    header.className = "date-group-header";
    header.textContent = relativeDayLabel(group.tanggal);
    section.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "agenda-grid";
    group.items.forEach((item, idx) => grid.appendChild(renderCard(item, idx + 1)));
    section.appendChild(grid);

    container.appendChild(section);
  });

  requestAnimationFrame(() => scrollToTodayOrNearest("auto"));
}

// ---------- Card rendering ----------
function renderCard(item, num) {
  const card = document.createElement("div");
  const primaryTagClass = item.tags.map((t) => TAG_CLASS[t]).find(Boolean);
  card.className = "agenda-card" + (primaryTagClass ? " " + primaryTagClass : "");
  card.dataset.id = item.id;

  const canEdit = state.user.role === "sekretaris";

  card.innerHTML = `
    ${canEdit ? '<button class="close-x" title="Hapus">&times;</button>' : ""}
    <span class="agenda-num">${num}</span>
    <span class="agenda-time">🕐 ${item.jam}</span>
    <p><span class="label">Asal Surat:</span> <strong>${escapeHtml(item.asalSurat)}</strong></p>
    <p><span class="label">Ket:</span> ${escapeHtml(item.keterangan)}</p>
    <div class="tags-row">
      ${item.tags.map((t) => `<span class="tag-pill ${TAG_PILL_COLOR[t] || ""}">${t}</span>`).join("")}
      ${item.noDisposisi ? `<span class="tag-pill pill-disposisi">No. Disposisi: ${escapeHtml(item.noDisposisi)}</span>` : ""}
    </div>
    ${item.noSurat ? `<div class="no-surat-row">${escapeHtml(item.noSurat)}</div>` : ""}
    <div class="attachments-list"></div>
    <div class="card-actions"></div>
  `;

  renderAttachments(card, item, canEdit);
  const actions = card.querySelector(".card-actions");

  if (canEdit) {
    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.onclick = () => openAgendaModal(item);
    actions.appendChild(editBtn);

    card.querySelector(".close-x").onclick = async () => {
      if (!confirm("Hapus agenda ini?")) return;
      await api(`/api/agenda-item?id=${item.id}`, "DELETE");
      toast("Agenda dihapus");
      refreshAgendaView();
    };
  }


  if (canEdit) {
    const uploadBtn = document.createElement("button");
    uploadBtn.textContent = "📎 Upload PDF";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".pdf,application/pdf";
    fileInput.className = "hidden";
    fileInput.onchange = async () => {
      if (!fileInput.files.length) return;
      try {
        uploadBtn.disabled = true;
        uploadBtn.textContent = "Mengunggah...";
        await apiUpload(`/api/attachment-upload?agendaId=${item.id}`, fileInput.files[0]);
        toast("File berhasil diunggah");
        refreshAgendaView();
      } catch (e) {
        alert(e.message);
        uploadBtn.disabled = false;
        uploadBtn.textContent = "📎 Upload PDF";
      }
    };
    uploadBtn.onclick = () => fileInput.click();
    actions.appendChild(uploadBtn);
    actions.appendChild(fileInput);
  }

  return card;
}

function renderAttachments(card, item, canEdit) {
  const wrap = card.querySelector(".attachments-list");
  const attachments = item.attachments || [];
  if (attachments.length === 0) return;

  wrap.innerHTML = attachments
    .map(
      (a) => `
      <div class="attachment-row" data-att-id="${a.id}">
        <span>📄</span>
        <span class="attachment-name" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</span>
        <span class="attachment-size">${formatFileSize(a.size)}</span>
        <button class="attachment-action attachment-view">👁 Lihat</button>
        ${canEdit ? `<button class="attachment-del" title="Hapus file">&times;</button>` : ""}
      </div>`
    )
    .join("");

  wrap.querySelectorAll(".attachment-view").forEach((btn) => {
    const row = btn.closest(".attachment-row");
    const attId = row.dataset.attId;
    const attachment = attachments.find((a) => a.id === attId);
    btn.onclick = () => openPdfViewer(item, attachment);
  });

  if (canEdit) {
    wrap.querySelectorAll(".attachment-del").forEach((btn) => {
      const row = btn.closest(".attachment-row");
      const attId = row.dataset.attId;
      btn.onclick = async () => {
        if (!confirm("Hapus file ini?")) return;
        await api("/api/attachment-delete", "POST", { agendaId: item.id, fileId: attId });
        toast("File dihapus");
        refreshAgendaView();
      };
    });
  }
}

function openPdfViewer(item, attachment) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card pdf-viewer-card">
      <div class="pdf-viewer-header">
        <span class="pdf-viewer-title" title="${escapeHtml(attachment.name)}">📄 ${escapeHtml(attachment.name)}</span>
        <button class="ghost-btn">Tutup</button>
      </div>
      <div class="pdf-viewer-body" id="pdfViewerBody">
        <p class="pdf-viewer-status">Memuat PDF...</p>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector(".ghost-btn").onclick = close;
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  renderPdfIntoViewer(`/api/attachment-view?agendaId=${item.id}&fileId=${attachment.id}`, backdrop.querySelector("#pdfViewerBody"));
}

// Render PDF pakai PDF.js (canvas) — supaya konsisten tampil langsung di semua
// platform. Sebelumnya pakai <iframe> yang mengandalkan fitur bawaan browser,
// dan Chrome di Android tidak punya PDF viewer bawaan untuk iframe (beda
// dengan Safari iOS), jadi malah nyuruh download. Pakai PDF.js, hasilnya sama
// di Android, iPhone, maupun desktop.
async function renderPdfIntoViewer(url, container) {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`Gagal memuat file (${res.status})`);
    const arrayBuffer = await res.arrayBuffer();

    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    container.innerHTML = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const unscaledViewport = page.getViewport({ scale: 1 });
      const targetWidth = container.clientWidth || 800;
      const scale = targetWidth / unscaledViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.className = "pdf-page-canvas";
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      container.appendChild(canvas);

      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    }
  } catch (err) {
    container.innerHTML = `
      <p class="pdf-viewer-status">Gagal menampilkan PDF di sini (${escapeHtml(err.message)}).</p>
      <a class="primary-btn pdf-fallback-link" href="${url}" target="_blank" rel="noopener">Buka PDF di tab baru</a>
    `;
  }
}

// ---------- Agenda modal (add/edit) ----------
function setupTagsDropdown(container) {
  const trigger = container.querySelector(".multiselect-trigger");
  const panel = container.querySelector(".multiselect-panel");
  const summary = container.querySelector(".multiselect-summary");
  const checkboxes = Array.from(panel.querySelectorAll('input[type="checkbox"]'));

  function updateSummary() {
    const selected = checkboxes.filter((c) => c.checked).map((c) => c.value);
    summary.textContent = selected.length ? selected.join(", ") : "Pilih opsi";
  }

  function closePanel() {
    panel.classList.add("hidden");
    trigger.classList.remove("open");
    document.removeEventListener("click", handleOutsideClick);
  }
  function openPanel() {
    panel.classList.remove("hidden");
    trigger.classList.add("open");
    document.addEventListener("click", handleOutsideClick);
  }
  function handleOutsideClick(e) {
    if (!container.contains(e.target)) closePanel();
  }

  trigger.onclick = (e) => {
    e.stopPropagation();
    if (panel.classList.contains("hidden")) openPanel();
    else closePanel();
  };
  checkboxes.forEach((cb) => cb.addEventListener("change", updateSummary));
  updateSummary();

  return {
    getSelected: () => checkboxes.filter((c) => c.checked).map((c) => c.value),
    destroy: () => document.removeEventListener("click", handleOutsideClick),
  };
}

function openAgendaModal(existing) {
  const isEdit = !!existing;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card">
      <h3>${isEdit ? "Edit Agenda" : "Tambah Agenda"}</h3>
      <label>Tanggal</label>
      <input type="date" id="mTanggal" value="${isEdit ? existing.tanggal : fmtDate(state.currentDate)}" />
      <label>Jam</label>
      <input type="time" id="mJam" value="${isEdit ? existing.jam : "08:00"}" />
      <label>Asal Surat</label>
      <input type="text" id="mAsal" value="${isEdit ? escapeHtml(existing.asalSurat) : ""}" placeholder="Contoh: LAN" />
      <label>Keterangan</label>
      <textarea id="mKet" placeholder="Contoh: Diklat PKN 1. Via Zoom">${isEdit ? escapeHtml(existing.keterangan) : ""}</textarea>
      <label>No. Disposisi <span class="optional-label">(opsional)</span></label>
      <input type="text" id="mNoDisposisi" value="${isEdit ? escapeHtml(existing.noDisposisi || "") : ""}" placeholder="Contoh: 5836" />
      <label>No. Surat <span class="optional-label">(opsional)</span></label>
      <input type="text" id="mNoSurat" value="${isEdit ? escapeHtml(existing.noSurat || "") : ""}" placeholder="Contoh: B-17434/Dt.07.02/PP.08/08/2026" />
      <label>Disposisi</label>
      <div class="multiselect" id="mTagsSelect">
        <button type="button" class="multiselect-trigger" id="mTagsTrigger">
          <span class="multiselect-summary" id="mTagsSummary">Pilih opsi</span>
          <span class="multiselect-arrow">▾</span>
        </button>
        <div class="multiselect-panel hidden" id="mTagsPanel">
          ${DISPOSISI_OPTIONS.map(
            (t) =>
              `<label class="multiselect-option"><input type="checkbox" value="${t}" ${isEdit && existing.tags.includes(t) ? "checked" : ""}/> ${t}</label>`
          ).join("")}
        </div>
      </div>
      <div class="modal-actions">
        <button class="ghost-btn" id="mCancel">Batal</button>
        <button class="primary-btn" id="mSave">Simpan</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const tagsSelect = setupTagsDropdown(backdrop.querySelector("#mTagsSelect"));

  backdrop.querySelector("#mCancel").onclick = () => {
    tagsSelect.destroy();
    backdrop.remove();
  };

  backdrop.querySelector("#mSave").onclick = async () => {
    const payload = {
      tanggal: backdrop.querySelector("#mTanggal").value,
      jam: backdrop.querySelector("#mJam").value,
      asalSurat: backdrop.querySelector("#mAsal").value.trim(),
      keterangan: backdrop.querySelector("#mKet").value.trim(),
      noDisposisi: backdrop.querySelector("#mNoDisposisi").value.trim(),
      noSurat: backdrop.querySelector("#mNoSurat").value.trim(),
      tags: tagsSelect.getSelected(),
    };
    if (!payload.tanggal || !payload.jam || !payload.asalSurat || !payload.keterangan) {
      alert("Mohon lengkapi semua field.");
      return;
    }
    try {
      if (isEdit) {
        await api(`/api/agenda-item?id=${existing.id}`, "PUT", payload);
        toast("Agenda diperbarui");
      } else {
        await api("/api/agenda", "POST", payload);
        toast("Agenda ditambahkan");
      }
      tagsSelect.destroy();
      backdrop.remove();
      state.currentDate = new Date(payload.tanggal + "T00:00:00");
      refreshAgendaView();
    } catch (e) {
      alert(e.message);
    }
  };
}

// ---------- Event bindings ----------
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("loginError");
  errEl.classList.add("hidden");
  try {
    const { user } = await api("/api/login", "POST", {
      username: document.getElementById("loginUsername").value.trim(),
      password: document.getElementById("loginPassword").value,
    });
    state.user = user;
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await api("/api/logout", "POST");
  state.user = null;
  window.location.href = "/";
});

document.getElementById("addAgendaBtn").addEventListener("click", () => openAgendaModal(null));
document.getElementById("viewListBtn").addEventListener("click", () => switchViewMode("list"));
document.getElementById("viewDailyBtn").addEventListener("click", () => switchViewMode("daily"));
document.getElementById("jumpTodayBtn").addEventListener("click", () => {
  if (state.viewMode === "daily") {
    // Di tampilan "Per Tanggal" tidak ada elemen grup-tanggal untuk di-scroll,
    // jadi "Lompat ke Hari Ini" di sini artinya: pindah tanggal aktif ke hari ini.
    state.currentDate = new Date();
    refreshAgendaView();
  } else {
    scrollToTodayOrNearest("smooth");
  }
});

document.getElementById("prevDay").addEventListener("click", () => {
  state.currentDate.setDate(state.currentDate.getDate() - 1);
  refreshAgendaView(); // pakai ini (bukan loadAgenda() langsung) supaya statistik ikut dihitung ulang untuk tanggal barunya
});
document.getElementById("nextDay").addEventListener("click", () => {
  state.currentDate.setDate(state.currentDate.getDate() + 1);
  refreshAgendaView();
});
document.getElementById("todayBtn").addEventListener("click", () => {
  state.currentDate = new Date();
  refreshAgendaView();
});

// ---------- Sidebar buka/tutup ----------
document.getElementById("sidebarToggleBtn").addEventListener("click", () => {
  document.querySelector(".app-shell").classList.toggle("sidebar-collapsed");
});

// ---------- Notifikasi lonceng: preview agenda hari ini ----------
function renderNotifPanelList() {
  const list = document.getElementById("notifPanelList");
  const items = state.todayItemsCache || [];
  if (items.length === 0) {
    list.innerHTML = `<p class="notif-empty">Tidak ada agenda untuk hari ini.</p>`;
    return;
  }
  list.innerHTML = items
    .map(
      (i) => `
      <div class="notif-item">
        <span class="notif-item-time">${i.jam}</span>
        <div>
          <div class="notif-item-title">${escapeHtml(i.asalSurat)}</div>
          <div class="notif-item-sub">${escapeHtml(i.keterangan)}</div>
        </div>
      </div>`
    )
    .join("");
}

(function setupNotifPanel() {
  const wrap = document.querySelector(".notif-wrap");
  const btn = document.getElementById("notifBellBtn");
  const panel = document.getElementById("notifPanel");
  function close() {
    panel.classList.add("hidden");
    document.removeEventListener("click", onOutside);
  }
  function open() {
    renderNotifPanelList();
    panel.classList.remove("hidden");
    document.addEventListener("click", onOutside);
    // Tandai sudah dibaca -> badge langsung hilang. Akan muncul lagi otomatis
    // kalau nanti totalnya bertambah lagi (dicek ulang tiap loadStats()).
    markNotifSeen(state.lastTotalToday || 0);
    document.getElementById("notifBadge").classList.add("hidden");
  }
  function onOutside(e) {
    if (!wrap.contains(e.target)) close();
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.contains("hidden") ? open() : close();
  });
})();

// ---------- User menu dropdown ----------
(function setupUserMenu() {
  const trigger = document.getElementById("userMenuTrigger");
  const panel = document.getElementById("userMenuPanel");
  function close() {
    panel.classList.add("hidden");
    document.removeEventListener("click", onOutside);
  }
  function open() {
    panel.classList.remove("hidden");
    document.addEventListener("click", onOutside);
  }
  function onOutside(e) {
    if (!trigger.parentElement.contains(e.target)) close();
  }
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.contains("hidden") ? open() : close();
  });
})();

// ---------- Filter panel (berdasarkan tag) ----------
(function setupFilterPanel() {
  const btn = document.getElementById("filterBtn");
  const panel = document.getElementById("filterPanel");
  function close() {
    panel.classList.add("hidden");
    document.removeEventListener("click", onOutside);
  }
  function open() {
    panel.classList.remove("hidden");
    document.addEventListener("click", onOutside);
  }
  function onOutside(e) {
    if (!btn.parentElement.contains(e.target)) close();
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.contains("hidden") ? open() : close();
  });

  document.querySelectorAll(".filterTagChk").forEach((chk) => {
    chk.addEventListener("change", () => {
      state.filterTags = Array.from(document.querySelectorAll(".filterTagChk:checked")).map((c) => c.value);
      refreshAgendaView();
    });
  });
  document.getElementById("filterClearBtn").addEventListener("click", () => {
    document.querySelectorAll(".filterTagChk").forEach((c) => (c.checked = false));
    state.filterTags = [];
    refreshAgendaView();
  });
})();

// ---------- Search ----------
// Di-debounce 300ms — supaya ngetik cepat tidak nembak request ke server di
// setiap huruf yang diketik, cukup 1x request setelah berhenti mengetik sebentar.
let searchDebounceTimer = null;
document.getElementById("searchInput").addEventListener("input", (e) => {
  const value = e.target.value.trim().toLowerCase();
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    state.searchQuery = value;
    refreshAgendaView();
  }, 300);
});

boot();
