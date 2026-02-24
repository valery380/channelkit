import { API, escHtml } from '../utils.js';
import { tunnelState, state } from '../app.js';

export function updateTunnelUI() {
  const btn = document.getElementById("tunnel-btn");
  const btnText = document.getElementById("tunnel-btn-text");
  const bar = document.getElementById("tunnel-bar");
  const urlEl = document.getElementById("tunnel-url");
  const warn = document.getElementById("tunnel-warn");
  const hasToken = document.getElementById("tunnel-has-token");

  if (!btn || !bar) return;

  if (tunnelState.active && tunnelState.url) {
    btn.classList.add("active");
    btnText.textContent = "External";
    bar.classList.add("active");
    urlEl.textContent = tunnelState.url;
    const updateBtn = document.getElementById("update-endpoints-btn");
    if (state.tunnelHasToken) {
      warn.style.display = "none";
      hasToken.style.display = "";
      if (updateBtn) updateBtn.style.display = "none";
    } else {
      warn.style.display = "";
      hasToken.style.display = "none";
      if (updateBtn) updateBtn.style.display = state.hasSmsWebhookChannels ? "inline-flex" : "none";
    }
  } else {
    btn.classList.remove("active");
    btnText.textContent = "Externalize";
    bar.classList.remove("active");
    urlEl.textContent = "";
  }
  btn.disabled = false;
}

export async function toggleTunnel() {
  const btn = document.getElementById("tunnel-btn");
  const btnText = document.getElementById("tunnel-btn-text");
  btn.disabled = true;

  if (tunnelState.active) {
    btnText.textContent = "Stopping\u2026";
    try {
      await fetch(API + "/api/tunnel/stop", { method: "POST" });
      tunnelState.active = false;
      tunnelState.url = null;
    } catch (err) {
      alert("Failed to stop tunnel: " + err.message);
    }
  } else {
    btnText.textContent = "Starting\u2026";
    try {
      const res = await fetch(API + "/api/tunnel/start", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        tunnelState.active = true;
        tunnelState.url = data.url;
      } else {
        alert("Failed to start tunnel: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      alert("Failed to start tunnel: " + err.message);
    }
  }
  updateTunnelUI();
}

export function copyTunnelUrl() {
  if (!tunnelState.url) return;
  navigator.clipboard.writeText(tunnelState.url).then(() => {
    const el = document.getElementById("tunnel-copied");
    el.style.opacity = "1";
    setTimeout(() => { el.style.opacity = "0"; }, 1500);
  });
}

export async function updateExternalEndpoints() {
  const btn = document.getElementById("update-endpoints-btn");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Updating\u2026";
  try {
    const res = await fetch(API + "/api/tunnel/update-webhooks", { method: "POST" });
    const data = await res.json();
    if (!res.ok) { alert("Failed to update endpoints: " + (data.error || res.status)); return; }
    const lines = [];
    if (data.updated.length > 0) lines.push("Updated: " + data.updated.join(", "));
    if (data.errors.length > 0) lines.push("Errors: " + data.errors.map(e => e.name + " — " + e.error).join("; "));
    if (data.updated.length === 0 && data.errors.length === 0) lines.push("No SMS channels in webhook mode found.");
    alert(lines.join("\n"));
  } catch (err) {
    alert("Failed to update endpoints: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

export function showTunnelHelp() {
  document.getElementById("tunnel-help-overlay").classList.add("open");
}

export function closeTunnelHelp() {
  document.getElementById("tunnel-help-overlay").classList.remove("open");
}

export function showTunnelSetup() {
  const setup = document.getElementById("tunnel-setup");
  setup.classList.add("open");
  fetch(API + "/api/tunnel/config")
    .then((r) => r.json())
    .then((cfg) => {
      if (cfg.token) document.getElementById("ts-token").value = cfg.token;
      if (cfg.public_url) document.getElementById("ts-hostname").value = cfg.public_url.replace(/^https?:\/\//, "");
      document.getElementById("ts-clear-btn").style.display = cfg.token ? "" : "none";
    })
    .catch(() => {});
}

export function hideTunnelSetup() {
  document.getElementById("tunnel-setup").classList.remove("open");
}

export async function saveTunnelConfig() {
  const token = document.getElementById("ts-token").value.trim();
  let hostname = document.getElementById("ts-hostname").value.trim();
  if (!token || !hostname) { alert("Both tunnel token and public hostname are required."); return; }
  if (!hostname.startsWith("http")) hostname = "https://" + hostname;
  const res = await fetch(API + "/api/tunnel/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, public_url: hostname }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error || "Failed to save"); return; }
  state.tunnelHasToken = true;
  hideTunnelSetup();
  if (tunnelState.active) {
    await fetch(API + "/api/tunnel/stop", { method: "POST" });
    tunnelState.active = false;
    tunnelState.url = null;
    updateTunnelUI();
    alert("Token saved. Click Externalize again to connect with your stable URL.");
  } else {
    alert("Token saved. Click Externalize to connect with your stable URL.");
  }
}

export async function clearTunnelConfig() {
  if (!confirm("Remove the tunnel token? The next Externalize will use a random URL.")) return;
  await fetch(API + "/api/tunnel/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: null, public_url: null }),
  });
  state.tunnelHasToken = false;
  document.getElementById("ts-token").value = "";
  document.getElementById("ts-hostname").value = "";
  document.getElementById("ts-clear-btn").style.display = "none";
  hideTunnelSetup();
  updateTunnelUI();
}

export async function toggleExposeDashboard(enabled) {
  await fetch(API + "/api/tunnel/expose-dashboard", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export function onTunnelStatus(msg) {
  tunnelState.active = msg.active;
  tunnelState.url = msg.url || null;
  if (msg.exposeDashboard !== undefined) {
    const cb = document.getElementById("tunnel-expose");
    if (cb) cb.checked = msg.exposeDashboard;
  }
  updateTunnelUI();
}

// Initialize tunnel state on load
export function initTunnelState() {
  fetch(API + "/api/tunnel/status")
    .then((r) => r.json())
    .then((s) => {
      tunnelState.active = s.active;
      tunnelState.url = s.url;
      updateTunnelUI();
    })
    .catch(() => {});
  fetch(API + "/api/tunnel/config")
    .then((r) => r.json())
    .then((cfg) => {
      state.tunnelHasToken = !!cfg.token;
      const cb = document.getElementById("tunnel-expose");
      if (cb) cb.checked = !!cfg.expose_dashboard;
      updateTunnelUI();
    })
    .catch(() => {});
}
