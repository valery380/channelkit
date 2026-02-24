import { API, escHtml, formatTime, formatDate, truncate, shortUrl, channelIcons } from '../utils.js';
import { state } from '../app.js';

function typeLabel(entry) {
  if (entry.type === "async-outbound")
    return '<span style="color:var(--accent);font-size:11px;font-weight:600">ASYNC ↗</span>';
  return "";
}

function statusIcon(status) {
  if (status === "success")
    return '<span class="status-ok"><svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="currentColor"><path d="m424-296 282-282-56-56-226 226-114-114-56 56 170 170Zm56 216q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg></span>';
  if (status === "error")
    return '<span class="status-err"><svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg></span>';
  return '<span class="status-noroute"><svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="currentColor"><path d="M280-440h400v-80H280v80Zm200 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg></span>';
}

function renderRow(entry, isNew) {
  const tr = document.createElement("tr");
  if (isNew) tr.classList.add("new-entry");
  tr.innerHTML = `
    <td class="time-cell mono">${formatTime(entry.timestamp)}</td>
    <td class="channel-icon">${entry.type === "async-outbound" ? "🔄" : channelIcons[entry.channel] || "📨"}</td>
    <td class="from-cell">
      <div class="name">${escHtml(entry.senderName || "")}</div>
      <div class="number mono">${escHtml(entry.from)}</div>
    </td>
    <td class="text-preview">${typeLabel(entry)} ${truncate(entry.text)}</td>
    <td class="route-cell mono">${escHtml(shortUrl(entry.route))}</td>
    <td>${statusIcon(entry.status)}</td>
    <td class="latency mono">${entry.latency != null ? entry.latency + "ms" : "—"}</td>
  `;

  tr.addEventListener("click", () => {
    const existing = tr.nextElementSibling;
    if (existing && existing.classList.contains("detail-row")) {
      existing.remove();
      return;
    }
    document.querySelectorAll(".detail-row").forEach((el) => el.remove());

    const detailTr = document.createElement("tr");
    detailTr.classList.add("detail-row");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.innerHTML = `
      <div class="detail open">
        <div class="detail-grid">
          <div class="detail-item"><label>ID</label><p class="mono">${escHtml(entry.id)}</p></div>
          <div class="detail-item"><label>Timestamp</label><p>${formatDate(entry.timestamp)}</p></div>
          <div class="detail-item"><label>Channel</label><p>${escHtml(entry.channel)}</p></div>
          <div class="detail-item"><label>From</label><p>${escHtml(entry.senderName || "")} (${escHtml(entry.from)})</p></div>
          <div class="detail-item"><label>Type</label><p>${escHtml(entry.type)}</p></div>
          <div class="detail-item"><label>Group</label><p>${escHtml(entry.groupName || entry.groupId || "—")}</p></div>
          <div class="detail-item"><label>Webhook</label><p class="mono">${escHtml(entry.route || "—")}</p></div>
          <div class="detail-item"><label>Status</label><p>${escHtml(entry.status)}</p></div>
          <div class="detail-item"><label>Latency</label><p>${entry.latency != null ? entry.latency + "ms" : "—"}</p></div>
        </div>
        <div class="detail-item" style="margin-top:12px"><label>Full Message</label><div class="detail-response">${escHtml(entry.text || "—")}</div></div>
        <div class="detail-item" style="margin-top:8px"><label>Response</label><div class="detail-response">${escHtml(entry.responseText || "—")}</div></div>
      </div>
    `;
    detailTr.appendChild(td);
    tr.after(detailTr);
  });

  return tr;
}

let logBody, emptyState, filterChannel, filterSearch, searchTimeout;

function getFiltered() {
  let results = state.allEntries;
  const ch = filterChannel.value;
  const q = filterSearch.value.toLowerCase();
  if (ch) results = results.filter((e) => e.channel === ch);
  if (q)
    results = results.filter(
      (e) =>
        (e.text || "").toLowerCase().includes(q) ||
        (e.from || "").toLowerCase().includes(q) ||
        (e.senderName || "").toLowerCase().includes(q) ||
        (e.responseText || "").toLowerCase().includes(q),
    );
  return results;
}

function renderEntries(entries, isNew) {
  if (isNew && entries.length === 1) {
    logBody.prepend(renderRow(entries[0], true));
    emptyState.style.display = "none";
    return;
  }
  logBody.innerHTML = "";
  if (entries.length === 0) {
    emptyState.style.display = "";
    return;
  }
  emptyState.style.display = "none";
  entries.forEach((e) => logBody.appendChild(renderRow(e, false)));
}

function applyFilters() {
  renderEntries(getFiltered(), false);
}

async function clearMessages() {
  if (!confirm("Clear all message logs? This cannot be undone.")) return;
  await fetch(API + "/api/logs", { method: "DELETE" });
  state.allEntries = [];
  renderEntries([], false);
  updateStats();
}

export function updateStats() {
  fetch(API + "/api/logs/stats")
    .then((r) => r.json())
    .then((s) => {
      document.getElementById("stat-total").textContent = s.total;
      document.getElementById("stat-errors").textContent = s.errorCount || 0;
      document.getElementById("stat-latency").textContent = s.avgLatency + "ms";
      document.getElementById("stat-uptime").textContent =
        (window.__formatUptime || ((ms) => { const sec = Math.floor(ms/1000); return sec + 's'; }))(s.uptime);
    })
    .catch(() => {});
}

// Called by app.js on WebSocket newEntry
export function onNewEntry(entry) {
  state.allEntries.unshift(entry);
  if (state.allEntries.length > 1000) state.allEntries.pop();
  if (!logBody) return; // not rendered yet
  const filtered = getFiltered();
  if (filtered[0] && filtered[0].id === entry.id)
    renderEntries([entry], true);
  updateStats();
}

export function render(container) {
  container.innerHTML = `
    <div class="filters">
      <select id="filter-channel">
        <option value="">All Channels</option>
        <option value="whatsapp">WhatsApp</option>
        <option value="telegram">Telegram</option>
        <option value="sms">SMS</option>
        <option value="voice">📞 Voice</option>
        <option value="email">📧 Email</option>
      </select>
      <input type="text" id="filter-search" placeholder="Search messages, senders, responses..." />
      <button id="logs-clear-btn" style="background:none;border:1px solid var(--border);padding:6px 12px;border-radius:6px;font-size:13px;cursor:pointer;color:var(--dim)">Clear</button>
      <button id="logs-send-btn" style="background:var(--accent);color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;margin-left:auto">Send Message</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th></th>
            <th>From</th>
            <th>Message</th>
            <th>Webhook</th>
            <th>Status</th>
            <th>Latency</th>
          </tr>
        </thead>
        <tbody id="log-body"></tbody>
      </table>
      <div class="empty" id="empty-state">
        <div class="empty-icon">📭</div>
        <div>No messages yet. Waiting for traffic...</div>
      </div>
    </div>
  `;
}

export function init() {
  logBody = document.getElementById("log-body");
  emptyState = document.getElementById("empty-state");
  filterChannel = document.getElementById("filter-channel");
  filterSearch = document.getElementById("filter-search");

  filterChannel.addEventListener("change", applyFilters);
  filterSearch.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(applyFilters, 200);
  });

  document.getElementById("logs-clear-btn").addEventListener("click", clearMessages);
  document.getElementById("logs-send-btn").addEventListener("click", () => {
    // Import send module dynamically
    import('./send.js').then(m => m.openSendModal());
  });

  // Load existing entries
  fetch(API + "/api/logs")
    .then((r) => r.json())
    .then((entries) => {
      state.allEntries = entries;
      renderEntries(getFiltered(), false);
      updateStats();
    })
    .catch(() => {});
}

export function destroy() {
  logBody = null;
  emptyState = null;
  filterChannel = null;
  filterSearch = null;
}
