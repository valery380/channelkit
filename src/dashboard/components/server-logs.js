import { API, escHtml } from '../utils.js';
import { state } from '../app.js';

function renderServerLog() {
  const el = document.getElementById("server-log");
  if (!el) return;
  if (state.serverLogLines.length === 0) {
    el.innerHTML = '<div style="color:#666">No log output captured yet.</div>';
  } else {
    el.innerHTML = state.serverLogLines
      .map((l) => `<div class="${l.level === "stderr" ? "log-err" : ""}">${escHtml(l.text)}</div>`)
      .join("");
  }
  document.getElementById("log-count").textContent = state.serverLogLines.length + " lines";
  if (document.getElementById("log-autoscroll").checked)
    el.scrollTop = el.scrollHeight;
}

async function loadServerLogs() {
  try {
    const lines = await fetch(API + "/api/server-logs").then((r) => r.json());
    state.serverLogLines = lines;
    renderServerLog();
  } catch {}
}

async function clearServerLog() {
  await fetch(API + "/api/server-logs", { method: "DELETE" });
  state.serverLogLines = [];
  renderServerLog();
}

export function onServerLog(msg) {
  state.serverLogLines.push(msg);
  if (state.serverLogLines.length > 500) state.serverLogLines.shift();
  // Check if the server-log element exists (meaning this panel is active)
  const el = document.getElementById("server-log");
  if (el) {
    const div = document.createElement("div");
    if (msg.level === "stderr") div.className = "log-err";
    div.textContent = msg.text;
    const placeholder = el.querySelector('div[style*="color:#666"]');
    if (placeholder) placeholder.remove();
    el.appendChild(div);
    document.getElementById("log-count").textContent = state.serverLogLines.length + " lines";
    if (document.getElementById("log-autoscroll").checked)
      el.scrollTop = el.scrollHeight;
  }
}

export function render(container) {
  container.innerHTML = `
    <div class="log-toolbar">
      <button id="clear-server-log-btn">Clear</button>
      <label><input type="checkbox" id="log-autoscroll" checked /> Auto-scroll</label>
      <span id="log-count" style="color: var(--dim); font-size: 12px"></span>
    </div>
    <div class="server-log mono" id="server-log">
      <div style="color: #666">Waiting for log output…</div>
    </div>
  `;
}

export function init() {
  document.getElementById("clear-server-log-btn").addEventListener("click", clearServerLog);
  loadServerLogs();
}

export function destroy() {}
