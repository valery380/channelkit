import { API, escHtml, channelIcons, maskValue } from '../utils.js';
import { state, loadConfigData, tunnelState } from '../app.js';

// ─── Channel type definitions ──────────────────────────
const CHANNEL_FIELDS = {
  whatsapp: {
    note: "After adding, you'll pair via QR code. Optionally buy a Twilio number below.",
    fields: [
      { id: "ch-number", label: "Phone Number (optional)", placeholder: "+12025551234" },
    ],
  },
  telegram: {
    note: "Create a bot at @BotFather and paste the token here.",
    fields: [
      { id: "ch-bot-token", label: "Bot Token", placeholder: "123456:ABC-DEF1234..." },
    ],
  },
  "sms-twilio": {
    note: "Twilio console: Account SID and Auth Token from the dashboard.",
    fields: [
      { id: "ch-account-sid", label: "Account SID", placeholder: "ACxxxxxxx" },
      { id: "ch-auth-token", label: "Auth Token", placeholder: "" },
      { id: "ch-number", label: "Phone Number", placeholder: "+12025551234" },
    ],
  },
  "voice-twilio": {
    note: "Same credentials as SMS. Voice and SMS can share credentials but need separate channels.",
    fields: [
      { id: "ch-account-sid", label: "Account SID", placeholder: "ACxxxxxxx" },
      { id: "ch-auth-token", label: "Auth Token", placeholder: "" },
      { id: "ch-number", label: "Phone Number", placeholder: "+12025551234" },
    ],
  },
  "email-resend": {
    note: "Get your API key from resend.com.",
    fields: [
      { id: "ch-api-key", label: "API Key", placeholder: "re_xxxxxxx" },
      { id: "ch-from-email", label: "From Email", placeholder: "support@yourdomain.com" },
    ],
  },
};

const CHANNEL_TYPE_LABELS = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  "sms-twilio": "SMS (Twilio)",
  "voice-twilio": "Voice (Twilio)",
  "email-resend": "Email (Resend)",
};

const COUNTRY_OPTIONS = [
  { code: 'US', label: 'United States (+1)' },
  { code: 'GB', label: 'United Kingdom (+44)' },
  { code: 'CA', label: 'Canada (+1)' },
  { code: 'AU', label: 'Australia (+61)' },
  { code: 'DE', label: 'Germany (+49)' },
  { code: 'FR', label: 'France (+33)' },
  { code: 'IL', label: 'Israel (+972)' },
  { code: 'NL', label: 'Netherlands (+31)' },
  { code: 'SE', label: 'Sweden (+46)' },
  { code: 'ES', label: 'Spain (+34)' },
  { code: 'IT', label: 'Italy (+39)' },
  { code: 'BR', label: 'Brazil (+55)' },
  { code: 'JP', label: 'Japan (+81)' },
  { code: 'IN', label: 'India (+91)' },
  { code: 'PL', label: 'Poland (+48)' },
];

// ─── QR pairing modal ──────────────────────────────────
let qrTimerInterval = null;
let qrPairingChannel = null;

function showQRModal(channelName) {
  qrPairingChannel = channelName;
  document.getElementById("qr-title").textContent = "Pair WhatsApp — " + channelName;
  document.getElementById("qr-body").innerHTML = '<div class="qr-waiting">Waiting for QR code...</div>';
  document.getElementById("qr-timer").textContent = "";
  document.getElementById("qr-overlay").classList.add("open");
  let remaining = 60;
  document.getElementById("qr-timer").textContent = remaining + "s remaining";
  qrTimerInterval = setInterval(() => {
    remaining--;
    document.getElementById("qr-timer").textContent = remaining > 0 ? remaining + "s remaining" : "";
    if (remaining <= 0) clearInterval(qrTimerInterval);
  }, 1000);
}

export function closeQRModal() {
  document.getElementById("qr-overlay").classList.remove("open");
  qrPairingChannel = null;
  if (qrTimerInterval) { clearInterval(qrTimerInterval); qrTimerInterval = null; }
}

export function handleQRMessage(msg) {
  if (msg.type === "whatsapp-qr" && msg.channel === qrPairingChannel) {
    if (msg.dataUrl) {
      document.getElementById("qr-body").innerHTML =
        '<div class="qr-img-wrap"><img src="' + msg.dataUrl + '" alt="QR Code"></div>';
    }
  }
  if (msg.type === "whatsapp-paired" && msg.channel === qrPairingChannel) {
    if (qrTimerInterval) { clearInterval(qrTimerInterval); qrTimerInterval = null; }
    document.getElementById("qr-timer").textContent = "";
    document.getElementById("qr-body").innerHTML =
      '<div class="qr-success"><svg xmlns="http://www.w3.org/2000/svg" height="48" width="48" viewBox="0 -960 960 960" fill="currentColor" style="margin-bottom:12px"><path d="m424-296 282-282-56-56-226 226-114-114-56 56 170 170Zm56 216q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg><br>WhatsApp paired successfully!<br><span style="font-size:12px;font-weight:400;color:var(--dim)">Restart the server to start receiving messages.</span></div>';
    document.getElementById("qr-sub").textContent = "";
  }
  if (msg.type === "whatsapp-pair-error" && msg.channel === qrPairingChannel) {
    if (qrTimerInterval) { clearInterval(qrTimerInterval); qrTimerInterval = null; }
    document.getElementById("qr-timer").textContent = "";
    document.getElementById("qr-body").innerHTML =
      '<div class="qr-error">' + escHtml(msg.error || "Pairing failed") + '</div>';
  }
}

async function startWhatsAppPairing(channelName) {
  showQRModal(channelName);
  try {
    const res = await fetch(
      API + "/api/config/channels/" + encodeURIComponent(channelName) + "/pair",
      { method: "POST" }
    );
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      document.getElementById("qr-body").innerHTML =
        '<div class="qr-error">' + escHtml(d.error || "Failed to start pairing") + '</div>';
    }
  } catch (e) {
    document.getElementById("qr-body").innerHTML =
      '<div class="qr-error">Failed to start pairing: ' + escHtml(e.message) + '</div>';
  }
}

// ─── Render channels table ──────────────────────────────
function renderChannels(channels, services) {
  const tbody = document.getElementById("channels-body");
  const entries = Object.entries(channels);
  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--dim);padding:32px">No channels configured</td></tr>';
    return;
  }
  tbody.innerHTML = entries
    .map(([name, ch]) => {
      const deps = Object.entries(services)
        .filter(([, s]) => s.channel === name)
        .map(([n]) => n);
      const detail = ch.number || (ch.bot_token ? ch.bot_token.slice(0, 12) + "…" : "") || ch.from_email || "";
      const isSms = ch.type === "sms";
      const smsMode = isSms ? ch.poll_interval ? "polling" : "webhook" : "";
      const smsModeLabel = isSms ? ch.poll_interval ? `Polling (${ch.poll_interval}s)` : "External Address" : "";
      return `<tr>
      <td style="font-weight:500">${escHtml(name)}</td>
      <td>${escHtml(ch.type)}</td>
      <td class="mono" style="color:var(--dim);font-size:12px">${escHtml(detail)}${isSms ? `<div style="margin-top:3px;font-family:inherit;color:var(--accent);font-size:11px">${escHtml(smsModeLabel)}</div>` : ""}</td>
      <td style="font-size:12px;color:var(--dim)">${deps.length > 0 ? deps.map(escHtml).join(", ") : "—"}</td>
      <td>${
        ch.mode === "groups" || deps.length > 1
          ? `<select data-name="${escHtml(name)}" data-action="unmatched"
              style="font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)">
              <option value="" ${!ch.unmatched ? "selected" : ""}>Ignore (default)</option>
              <option value="list" ${ch.unmatched === "list" ? "selected" : ""}>List services</option>
              <option value="ignore" ${ch.unmatched === "ignore" ? "selected" : ""}>Ignore</option>
            </select>`
          : '<span style="color:var(--dim);font-size:12px">—</span>'
      }</td>
      <td style="text-align:right;white-space:nowrap">${isSms ? `<button class="btn-edit" data-name="${escHtml(name)}" data-sms-mode="${escHtml(smsMode)}" data-interval="${ch.poll_interval || 60}" data-action="sms-settings">Settings</button> ` : ""}<button class="btn-danger" data-name="${escHtml(name)}" data-deps='${escHtml(JSON.stringify(deps))}' data-action="remove-ch">Remove</button></td>
    </tr>`;
    })
    .join("");

  // Attach event listeners
  tbody.querySelectorAll('[data-action="unmatched"]').forEach(sel => {
    sel.addEventListener('change', () => setUnmatched(sel.dataset.name, sel.value));
  });
  tbody.querySelectorAll('[data-action="sms-settings"]').forEach(btn => {
    btn.addEventListener('click', () => editSmsSettings(btn.dataset.name, btn.dataset.smsMode, btn.dataset.interval));
  });
  tbody.querySelectorAll('[data-action="remove-ch"]').forEach(btn => {
    btn.addEventListener('click', () => removeChannel(btn.dataset.name, JSON.parse(btn.dataset.deps)));
  });
}

async function setUnmatched(name, value) {
  await fetch(API + "/api/config/channels/" + encodeURIComponent(name), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unmatched: value || null }),
  });
}

async function removeChannel(name, deps) {
  const msg = deps.length > 0
    ? `Remove channel "${name}"?\n\nThis will also remove these services:\n• ${deps.join("\n• ")}`
    : `Remove channel "${name}"?`;
  if (!confirm(msg)) return;
  const res = await fetch(API + "/api/config/channels/" + encodeURIComponent(name), { method: "DELETE" });
  if (!res.ok) {
    let m = `Remove failed (${res.status})`;
    try { m = (await res.json()).error || m; } catch {}
    alert(m);
    return;
  }
  loadConfigData();
}

// ─── SMS settings inline ────────────────────────────────
function editSmsSettings(name, currentMode, currentInterval) {
  document.querySelectorAll(".sms-settings-row").forEach((el) => el.remove());
  const tbody = document.getElementById("channels-body");
  const rows = tbody.querySelectorAll("tr");
  let targetRow = null;
  for (const row of rows) {
    const firstTd = row.querySelector("td");
    if (firstTd && firstTd.textContent.trim() === name) { targetRow = row; break; }
  }
  if (!targetRow) return;
  const settingsRow = document.createElement("tr");
  settingsRow.className = "sms-settings-row";
  const td = document.createElement("td");
  td.colSpan = 6;
  td.innerHTML = `
    <div style="padding:14px 16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin:4px 0 8px">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px">SMS Inbound Settings</div>
      <div class="form-row">
        <select id="sms-set-mode" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
          <option value="polling" ${currentMode === "polling" ? "selected" : ""}>Polling \u2014 fetch messages at regular intervals</option>
          <option value="webhook" ${currentMode === "webhook" ? "selected" : ""}>External Address \u2014 receive webhooks from Twilio</option>
        </select>
      </div>
      <div class="form-row" id="sms-set-poll-row" ${currentMode !== "polling" ? 'style="display:none"' : ""}>
        <input id="sms-set-interval" type="number" value="${parseInt(currentInterval) || 60}" min="5" max="3600" placeholder="Poll interval in seconds" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
      </div>
      <div id="sms-set-webhook-info" style="display:none;padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:10px"></div>
      <div class="form-row" style="margin-top:8px;gap:8px">
        <button class="btn btn-primary" id="save-sms-btn">Save</button>
        <button style="background:none;border:1px solid var(--border);padding:6px 12px;border-radius:6px;font-size:13px;cursor:pointer;color:var(--dim)" id="cancel-sms-btn">Cancel</button>
      </div>
    </div>`;
  settingsRow.appendChild(td);
  targetRow.after(settingsRow);

  document.getElementById('sms-set-mode').addEventListener('change', updateSmsSettingsUI);
  document.getElementById('save-sms-btn').addEventListener('click', () => saveSmsSettings(name));
  document.getElementById('cancel-sms-btn').addEventListener('click', closeSmsSettings);
  updateSmsSettingsUI();
}

function updateSmsSettingsUI() {
  const mode = document.getElementById("sms-set-mode")?.value;
  const pollRow = document.getElementById("sms-set-poll-row");
  const info = document.getElementById("sms-set-webhook-info");
  if (!pollRow || !info) return;
  if (mode === "polling") {
    pollRow.style.display = "";
    info.style.display = "none";
  } else {
    pollRow.style.display = "none";
    if (!tunnelState.active) {
      info.style.display = "block";
      info.style.background = "#fff8e1"; info.style.color = "#9a6700"; info.style.border = "1px solid #ffe082";
      info.innerHTML = "\u26a0\ufe0f Service is not externalized. Please <strong>Externalize</strong> first to use the external address mode.";
    } else {
      info.style.display = "block";
      info.style.background = "#e8f5e9"; info.style.color = "#1a7f37"; info.style.border = "1px solid #a5d6a7";
      info.innerHTML = "\u2705 Twilio will send incoming SMS to your external address.";
    }
  }
}

async function saveSmsSettings(name) {
  const mode = document.getElementById("sms-set-mode")?.value;
  if (mode === "webhook" && !tunnelState.active) {
    alert("Please externalize the service first to use the external address mode.");
    return;
  }
  const interval = parseInt(document.getElementById("sms-set-interval")?.value) || 60;
  const btn = document.querySelector(".sms-settings-row .btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "Saving\u2026"; }
  try {
    const res = await fetch(API + "/api/config/channels/" + encodeURIComponent(name) + "/sms-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inbound_mode: mode, ...(mode === "polling" && { poll_interval: interval }) }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Failed to save SMS settings");
      if (btn) { btn.disabled = false; btn.textContent = "Save"; }
      return;
    }
    closeSmsSettings();
    loadConfigData();
  } catch (e) {
    alert("Failed to save SMS settings: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "Save"; }
  }
}

function closeSmsSettings() {
  document.querySelectorAll(".sms-settings-row").forEach((el) => el.remove());
}

// ─── Add channel form logic ─────────────────────────────
function selectChannelType(type) {
  document.getElementById("ch-type").value = type;
  document.getElementById("ch-step-pick").style.display = "none";
  document.getElementById("ch-step-form").style.display = "";
  document.getElementById("ch-step-hint").textContent =
    "Configure your new " + (CHANNEL_TYPE_LABELS[type] || type) + " channel.";
  renderChannelFields();
  if (type === 'sms-twilio' || type === 'voice-twilio' || type === 'whatsapp') {
    prefillTwilioDefaults();
  }
  document.getElementById("ch-name").focus();
}

function backToChannelPicker() {
  document.getElementById("ch-step-form").style.display = "none";
  document.getElementById("ch-step-pick").style.display = "";
  document.getElementById("ch-type").value = "";
  document.getElementById("ch-fields").innerHTML = "";
  document.getElementById("ch-name").value = "";
}

function prefillTwilioDefaults() {
  if (!state.twilioDefaults.sid && !state.twilioDefaults.tok) return;
  const fields = [
    { id: 'ch-account-sid', val: state.twilioDefaults.sid },
    { id: 'ch-auth-token',  val: state.twilioDefaults.tok },
    { id: 'ch-buy-sid',     val: state.twilioDefaults.sid },
    { id: 'ch-buy-token',   val: state.twilioDefaults.tok },
  ];
  for (const f of fields) {
    const el = document.getElementById(f.id);
    if (el && !el.value && f.val) {
      el.placeholder = 'Using default (' + maskValue(f.val) + ')';
    }
  }
}

function populateBuyCountries() {
  const sel = document.getElementById('ch-buy-country');
  if (!sel) return;
  sel.innerHTML = COUNTRY_OPTIONS.map(c =>
    `<option value="${c.code}">${escHtml(c.label)}</option>`
  ).join('');
}

function renderChannelFields() {
  const type = document.getElementById("ch-type").value;
  const container = document.getElementById("ch-fields");
  const note = document.getElementById("ch-note");
  if (!type) { container.innerHTML = ""; return; }
  const def = CHANNEL_FIELDS[type];
  const typeFields = def.fields
    .map((f) => `<div class="form-row"><input id="${f.id}" placeholder="${escHtml(f.label + (f.placeholder ? " — " + f.placeholder : ""))}" style="flex:1"></div>`)
    .join("");

  const hasBuyOption = type === "sms-twilio" || type === "voice-twilio" || type === "whatsapp";
  let buyHtml = "";
  if (hasBuyOption) {
    const defaultType = type === "voice-twilio" ? "local" : "mobile";
    buyHtml = `
    <div id="ch-buy-section">
      <div id="ch-buy-toggle" style="margin:-4px 0 8px">
        <button type="button" id="toggle-buy-btn" style="background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;padding:0;text-decoration:underline">
          or buy a new number from Twilio
        </button>
      </div>
      <div id="ch-buy-panel" style="display:none;border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:10px;background:var(--surface)">
        <div style="font-size:13px;font-weight:600;margin-bottom:8px">Buy a Twilio Number</div>
        ${type === "whatsapp" ? `
        <div class="form-row"><input id="ch-buy-sid" placeholder="Account SID — ACxxxxxxx" style="flex:1"></div>
        <div class="form-row"><input id="ch-buy-token" placeholder="Auth Token" style="flex:1"></div>
        ` : `
        <div style="font-size:12px;color:var(--dim);margin-bottom:8px">Using the Account SID and Auth Token above.</div>
        `}
        <div class="form-row">
          <select id="ch-buy-country" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)"></select>
          <select id="ch-buy-type" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
            <option value="mobile" ${defaultType === "mobile" ? "selected" : ""}>Mobile</option>
            <option value="local" ${defaultType === "local" ? "selected" : ""}>Local</option>
          </select>
        </div>
        <div class="form-row">
          <button class="btn btn-primary" style="font-size:12px;padding:6px 14px" id="search-numbers-btn">Search Numbers</button>
          <button type="button" style="background:none;border:1px solid var(--border);padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;color:var(--dim)" id="close-buy-btn">Cancel</button>
        </div>
        <div id="ch-buy-error" style="display:none;padding:8px 12px;border-radius:6px;font-size:12px;color:var(--red);background:#ffeef0;border:1px solid #ffc1c7;margin-top:4px"></div>
        <div id="ch-buy-results" style="display:none;margin-top:10px"></div>
      </div>
    </div>`;
  }

  const smsInboundHtml = type === "sms-twilio" ? `
    <div class="form-row">
      <select id="ch-sms-inbound" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
        <option value="polling">Polling — fetch messages at regular intervals</option>
        <option value="webhook">External Address — receive webhooks from Twilio</option>
      </select>
    </div>
    <div class="form-row" id="ch-sms-poll-row">
      <input id="ch-sms-poll-interval" type="number" value="60" min="5" max="3600" placeholder="Poll interval in seconds (default: 60)" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
    </div>
    <div id="ch-sms-webhook-info" style="display:none;padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:10px"></div>
  ` : "";

  const emailInboundHtml = type === "email-resend" ? `
    <div class="form-row">
      <select id="ch-email-inbound" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
        <option value="webhook">Webhook — Resend forwards emails to your endpoint</option>
        <option value="polling">Polling — fetch emails at regular intervals</option>
      </select>
    </div>
    <div class="form-row" id="ch-email-poll-row" style="display:none">
      <input id="ch-email-poll-interval" type="number" value="30" min="5" max="3600" placeholder="Poll interval in seconds (default: 30)" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
    </div>
  ` : "";

  container.innerHTML = typeFields + buyHtml + smsInboundHtml + emailInboundHtml + `
    <div class="form-row">
      <select id="ch-mode" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
        <option value="service">Service mode — single service, no codes needed</option>
        <option value="groups">Groups mode — multiple services via codes or commands</option>
      </select>
    </div>
    <div class="form-row" id="ch-unmatched-row" style="display:none">
      <select id="ch-unmatched" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
        <option value="ignore">Unmatched messages: Ignore silently</option>
        <option value="list">Unmatched messages: Reply with service list</option>
      </select>
    </div>`;
  note.textContent = def.note;
  if (hasBuyOption) populateBuyCountries();

  // Attach dynamic event listeners
  const modeEl = document.getElementById("ch-mode");
  if (modeEl) modeEl.addEventListener("change", () => {
    const row = document.getElementById("ch-unmatched-row");
    if (row) row.style.display = modeEl.value === "groups" ? "" : "none";
  });
  const smsInbound = document.getElementById("ch-sms-inbound");
  if (smsInbound) smsInbound.addEventListener("change", updateSmsInboundFields);
  const emailInbound = document.getElementById("ch-email-inbound");
  if (emailInbound) emailInbound.addEventListener("change", () => {
    const pollRow = document.getElementById("ch-email-poll-row");
    if (pollRow) pollRow.style.display = emailInbound.value === "polling" ? "" : "none";
  });
  const toggleBuyBtn = document.getElementById("toggle-buy-btn");
  if (toggleBuyBtn) toggleBuyBtn.addEventListener("click", toggleBuyNumber);
  const closeBuyBtn = document.getElementById("close-buy-btn");
  if (closeBuyBtn) closeBuyBtn.addEventListener("click", closeBuyPanel);
  const searchBtn = document.getElementById("search-numbers-btn");
  if (searchBtn) searchBtn.addEventListener("click", searchBuyNumbers);
}

function updateSmsInboundFields() {
  const mode = document.getElementById("ch-sms-inbound")?.value;
  const pollRow = document.getElementById("ch-sms-poll-row");
  const webhookInfo = document.getElementById("ch-sms-webhook-info");
  if (!pollRow || !webhookInfo) return;
  if (mode === "polling") {
    pollRow.style.display = "";
    webhookInfo.style.display = "none";
  } else {
    pollRow.style.display = "none";
    if (!tunnelState.active) {
      webhookInfo.style.display = "block";
      webhookInfo.style.background = "#fff8e1"; webhookInfo.style.color = "#9a6700"; webhookInfo.style.border = "1px solid #ffe082";
      webhookInfo.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="currentColor" style="vertical-align:middle;margin-right:4px"><path d="m40-120 440-760 440 760H40Zm138-80h604L480-720 178-200Zm302-40q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm-40-120h80v-200h-80v200Zm40-100Z"/></svg> Service is not externalized. Please <strong>Externalize</strong> first to use the external address mode.';
    } else {
      webhookInfo.style.display = "block";
      webhookInfo.style.background = "#e8f5e9"; webhookInfo.style.color = "#1a7f37"; webhookInfo.style.border = "1px solid #a5d6a7";
      webhookInfo.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="currentColor" style="vertical-align:middle;margin-right:4px"><path d="m424-296 282-282-56-56-226 226-114-114-56 56 170 170Zm56 216q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg> Twilio will send incoming SMS to your external address.';
    }
  }
}

// ─── Buy number ─────────────────────────────────────────
function toggleBuyNumber() {
  const panel = document.getElementById('ch-buy-panel');
  const toggle = document.getElementById('ch-buy-toggle');
  if (!panel) return;
  const show = panel.style.display === 'none';
  panel.style.display = show ? '' : 'none';
  toggle.style.display = show ? 'none' : '';
}

function closeBuyPanel() {
  const panel = document.getElementById('ch-buy-panel');
  const toggle = document.getElementById('ch-buy-toggle');
  if (panel) panel.style.display = 'none';
  if (toggle) toggle.style.display = '';
  const results = document.getElementById('ch-buy-results');
  if (results) { results.style.display = 'none'; results.innerHTML = ''; }
}

function getBuyCredentials() {
  const type = document.getElementById('ch-type')?.value;
  let sid, tok;
  if (type === 'whatsapp') {
    sid = document.getElementById('ch-buy-sid')?.value.trim();
    tok = document.getElementById('ch-buy-token')?.value.trim();
  } else {
    sid = document.getElementById('ch-account-sid')?.value.trim();
    tok = document.getElementById('ch-auth-token')?.value.trim();
  }
  if (!sid && state.twilioDefaults.sid) sid = state.twilioDefaults.sid;
  if (!tok && state.twilioDefaults.tok) tok = state.twilioDefaults.tok;
  return { sid, tok };
}

async function searchBuyNumbers() {
  const { sid, tok } = getBuyCredentials();
  const country = document.getElementById('ch-buy-country')?.value;
  const numType = document.getElementById('ch-buy-type')?.value;
  const errBox = document.getElementById('ch-buy-error');
  errBox.style.display = 'none';

  if (!sid || !tok) { errBox.textContent = 'Account SID and Auth Token are required'; errBox.style.display = 'block'; return; }

  const btn = document.getElementById('search-numbers-btn');
  btn.disabled = true; btn.textContent = 'Searching\u2026';

  try {
    const res = await fetch(API + '/api/twilio/search-numbers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_sid: sid, auth_token: tok, country_code: country, type: numType, limit: 10 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed');
    if (!data.numbers || data.numbers.length === 0) throw new Error('No numbers available. Try a different country or type.');
    renderBuyResults(data.numbers);
  } catch (e) {
    errBox.textContent = e.message; errBox.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Search Numbers';
  }
}

function renderBuyResults(numbers) {
  const resultsDiv = document.getElementById('ch-buy-results');
  resultsDiv.style.display = '';
  const rows = numbers.map(n => {
    const caps = [];
    if (n.capabilities.sms) caps.push('<span style="background:#e8f5e9;color:#1a7f37;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600">SMS</span>');
    if (n.capabilities.voice) caps.push('<span style="background:#e3f2fd;color:#0969da;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600">Voice</span>');
    if (n.capabilities.mms) caps.push('<span style="background:#fff3e0;color:#9a6700;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600">MMS</span>');
    const loc = [n.locality, n.region].filter(Boolean).join(', ');
    const priceStr = n.price ? `${(n.priceUnit || 'USD').toUpperCase()} $${parseFloat(n.price).toFixed(2)}/mo` : '';
    return `<tr>
      <td class="mono" style="font-weight:500;font-size:12px">${escHtml(n.phoneNumber)}</td>
      <td style="font-size:11px;color:var(--dim)">${escHtml(loc || n.isoCountry)}</td>
      <td>${caps.join(' ')}</td>
      <td style="font-size:11px;color:var(--dim);white-space:nowrap">${priceStr}</td>
      <td><button class="btn btn-primary" style="padding:3px 10px;font-size:11px" data-phone="${escHtml(n.phoneNumber)}" data-action="buy">Buy</button></td>
    </tr>`;
  }).join('');

  resultsDiv.innerHTML = `
    <div style="font-size:12px;font-weight:600;margin-bottom:6px">Available Numbers</div>
    <div style="max-height:240px;overflow-y:auto;border:1px solid var(--border);border-radius:6px">
      <table style="margin:0">
        <thead><tr><th style="font-size:10px">Number</th><th style="font-size:10px">Location</th><th style="font-size:10px">Capabilities</th><th style="font-size:10px">Price</th><th style="width:50px"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div id="ch-buy-purchase-error" style="display:none;padding:8px 12px;border-radius:6px;font-size:12px;color:var(--red);background:#ffeef0;border:1px solid #ffc1c7;margin-top:6px"></div>
  `;

  resultsDiv.querySelectorAll('[data-action="buy"]').forEach(btn => {
    btn.addEventListener('click', () => confirmBuyNumber(btn.dataset.phone));
  });
}

async function confirmBuyNumber(phoneNumber) {
  if (!confirm('Purchase ' + phoneNumber + ' from Twilio? Your account will be charged.')) return;
  const { sid, tok } = getBuyCredentials();
  const errBox = document.getElementById('ch-buy-purchase-error');
  if (errBox) errBox.style.display = 'none';
  document.querySelectorAll('#ch-buy-results .btn-primary').forEach(b => { b.disabled = true; });

  try {
    const res = await fetch(API + '/api/twilio/buy-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_sid: sid, auth_token: tok, phone_number: phoneNumber }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Purchase failed');
    const numInput = document.getElementById('ch-number');
    if (numInput) numInput.value = data.purchased.phoneNumber;
    const panel = document.getElementById('ch-buy-panel');
    panel.innerHTML = `
      <div style="background:#e8f5e9;color:#1a7f37;padding:10px 14px;border-radius:6px;font-size:13px;border:1px solid #a5d6a7">
        <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="currentColor" style="vertical-align:middle;margin-right:4px"><path d="m424-296 282-282-56-56-226 226-114-114-56 56 170 170Zm56 216q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg>
        Purchased <strong class="mono">${escHtml(data.purchased.phoneNumber)}</strong> — filled in above.
      </div>`;
  } catch (e) {
    if (errBox) { errBox.textContent = e.message; errBox.style.display = 'block'; }
    document.querySelectorAll('#ch-buy-results .btn-primary').forEach(b => { b.disabled = false; });
  }
}

// ─── Add channel ────────────────────────────────────────
async function addChannel() {
  const name = document.getElementById("ch-name").value.trim();
  const typeKey = document.getElementById("ch-type").value;
  if (!name || !typeKey) { alert("Channel name and type are required"); return; }

  const body = { name };
  if (typeKey === "whatsapp") {
    const num = document.getElementById("ch-number")?.value.trim();
    Object.assign(body, { type: "whatsapp", ...(num && { number: num }) });
  } else if (typeKey === "telegram") {
    const token = document.getElementById("ch-bot-token")?.value.trim();
    if (!token) { alert("Bot token is required"); return; }
    Object.assign(body, { type: "telegram", bot_token: token });
  } else if (typeKey === "sms-twilio") {
    const sid = document.getElementById("ch-account-sid")?.value.trim() || state.twilioDefaults.sid;
    const tok = document.getElementById("ch-auth-token")?.value.trim() || state.twilioDefaults.tok;
    const num = document.getElementById("ch-number")?.value.trim();
    if (!sid || !tok || !num) { alert("Account SID, Auth Token and Phone Number are required"); return; }
    const smsInbound = document.getElementById("ch-sms-inbound")?.value || "polling";
    if (smsInbound === "webhook" && !tunnelState.active) { alert("Please externalize the service first to use the external address mode."); return; }
    Object.assign(body, { type: "sms", provider: "twilio", account_sid: sid, auth_token: tok, number: num });
    if (smsInbound === "polling") {
      const pollInterval = parseInt(document.getElementById("ch-sms-poll-interval")?.value) || 60;
      Object.assign(body, { poll_interval: pollInterval });
    }
  } else if (typeKey === "voice-twilio") {
    const sid = document.getElementById("ch-account-sid")?.value.trim() || state.twilioDefaults.sid;
    const tok = document.getElementById("ch-auth-token")?.value.trim() || state.twilioDefaults.tok;
    const num = document.getElementById("ch-number")?.value.trim();
    if (!sid || !tok || !num) { alert("Account SID, Auth Token and Phone Number are required"); return; }
    Object.assign(body, { type: "voice", provider: "twilio", account_sid: sid, auth_token: tok, number: num });
  } else if (typeKey === "email-resend") {
    const key = document.getElementById("ch-api-key")?.value.trim();
    const from = document.getElementById("ch-from-email")?.value.trim();
    if (!key || !from) { alert("API Key and From Email are required"); return; }
    Object.assign(body, { type: "email", provider: "resend", api_key: key, from_email: from });
    const emailInbound = document.getElementById("ch-email-inbound")?.value || "webhook";
    if (emailInbound === "polling") {
      const pollInterval = parseInt(document.getElementById("ch-email-poll-interval")?.value) || 30;
      Object.assign(body, { poll_interval: pollInterval });
    }
  }

  const mode = document.getElementById("ch-mode")?.value || "service";
  Object.assign(body, { mode });
  if (mode === "groups") {
    const unmatched = document.getElementById("ch-unmatched")?.value;
    if (unmatched) Object.assign(body, { unmatched });
  }

  const res = await fetch(API + "/api/config/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errMsg = `Failed to add channel (${res.status})`;
    try { const d = await res.json(); errMsg = d.error || errMsg; } catch {}
    alert(errMsg);
    return;
  }

  // SMS settings update
  if (typeKey === "sms-twilio") {
    const smsInbound = document.getElementById("ch-sms-inbound")?.value || "polling";
    try {
      const smsRes = await fetch(API + "/api/config/channels/" + encodeURIComponent(name) + "/sms-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inbound_mode: smsInbound, ...(smsInbound === "polling" && { poll_interval: parseInt(document.getElementById("ch-sms-poll-interval")?.value) || 60 }) }),
      });
      if (!smsRes.ok) { const d = await smsRes.json().catch(() => ({})); console.warn("SMS settings update:", d.error || "failed"); }
    } catch (e) { console.error("Failed to update SMS settings:", e); }
  }

  // Email settings update
  if (typeKey === "email-resend") {
    const emailInbound = document.getElementById("ch-email-inbound")?.value || "webhook";
    try {
      const emailRes = await fetch(API + "/api/config/channels/" + encodeURIComponent(name) + "/email-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inbound_mode: emailInbound, ...(emailInbound === "polling" && { poll_interval: parseInt(document.getElementById("ch-email-poll-interval")?.value) || 30 }) }),
      });
      if (!emailRes.ok) { const d = await emailRes.json().catch(() => ({})); console.warn("Email settings update:", d.error || "failed"); }
    } catch (e) { console.error("Failed to update email settings:", e); }
  }

  if (typeKey === "whatsapp") {
    backToChannelPicker();
    loadConfigData();
    startWhatsAppPairing(name);
    return;
  }
  backToChannelPicker();
  loadConfigData();
}

// ─── Channel type picker SVGs ───────────────────────────
const channelTypeSvgs = {
  whatsapp: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>',
  telegram: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#26A5E4" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
  sms: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#6B7280" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/><path fill="#6B7280" d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>',
  voice: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#6B7280" d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>',
  email: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#6B7280" d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>',
};

export function render(container) {
  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Details</th>
            <th>Services</th>
            <th>Unmatched msgs</th>
            <th style="width: 80px"></th>
          </tr>
        </thead>
        <tbody id="channels-body"></tbody>
      </table>
    </div>
    <div class="add-form">
      <h3>Add Channel</h3>
      <div id="ch-step-pick">
        <p class="form-hint">Choose the type of channel to add.</p>
        <div class="picker-grid" id="ch-type-picker">
          <div class="picker-card" data-type="whatsapp">
            <div class="picker-icon">${channelTypeSvgs.whatsapp}</div>
            <div class="picker-label">WhatsApp</div>
            <div class="picker-sub">Pair via QR code</div>
          </div>
          <div class="picker-card" data-type="telegram">
            <div class="picker-icon">${channelTypeSvgs.telegram}</div>
            <div class="picker-label">Telegram</div>
            <div class="picker-sub">Bot via BotFather</div>
          </div>
          <div class="picker-card" data-type="sms-twilio">
            <div class="picker-icon">${channelTypeSvgs.sms}</div>
            <div class="picker-label">SMS</div>
            <div class="picker-sub">Twilio</div>
          </div>
          <div class="picker-card" data-type="voice-twilio">
            <div class="picker-icon">${channelTypeSvgs.voice}</div>
            <div class="picker-label">Voice</div>
            <div class="picker-sub">Twilio</div>
          </div>
          <div class="picker-card" data-type="email-resend">
            <div class="picker-icon">${channelTypeSvgs.email}</div>
            <div class="picker-label">Email</div>
            <div class="picker-sub">Resend</div>
          </div>
        </div>
      </div>
      <div id="ch-step-form" style="display: none">
        <button class="step-back" id="ch-back-btn">
          <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 -960 960 960" fill="currentColor"><path d="M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z"/></svg>
          Back to channel types
        </button>
        <p class="form-hint" id="ch-step-hint"></p>
        <div class="form-row">
          <input id="ch-name" placeholder="Channel name (e.g. mywhatsapp)" />
        </div>
        <input type="hidden" id="ch-type" />
        <div id="ch-fields"></div>
        <div class="form-row" id="ch-submit-row">
          <button class="btn btn-primary" id="add-ch-btn">Add Channel</button>
          <span id="ch-note" style="font-size: 12px; color: var(--dim)"></span>
        </div>
      </div>
    </div>

    <!-- QR pairing modal -->
    <div class="qr-overlay" id="qr-overlay">
      <div class="qr-modal">
        <h3 id="qr-title">Pair WhatsApp</h3>
        <div class="qr-sub" id="qr-sub">Open WhatsApp &rarr; Settings &rarr; Linked Devices &rarr; Link a Device</div>
        <div id="qr-body"><div class="qr-waiting">Waiting for QR code...</div></div>
        <div class="qr-timer" id="qr-timer"></div>
        <button class="qr-close" id="qr-close-btn">Close</button>
      </div>
    </div>
  `;
}

export function init() {
  // Channel type picker
  document.querySelectorAll('#ch-type-picker .picker-card').forEach(card => {
    card.addEventListener('click', () => selectChannelType(card.dataset.type));
  });
  document.getElementById("ch-back-btn").addEventListener("click", backToChannelPicker);
  document.getElementById("add-ch-btn").addEventListener("click", addChannel);
  document.getElementById("qr-close-btn").addEventListener("click", closeQRModal);
  loadConfigData();
}

export function onConfigLoaded() {
  renderChannels(state.currentChannels, state.currentServices);
}

export function destroy() {
  if (qrTimerInterval) { clearInterval(qrTimerInterval); qrTimerInterval = null; }
}
