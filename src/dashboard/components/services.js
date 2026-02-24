import { API, escHtml, channelIcons, maskValue } from '../utils.js';
import { state, loadConfigData } from '../app.js';

function renderServices(services, channels) {
  const tbody = document.getElementById("services-body");
  const entries = Object.entries(services);
  if (entries.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" style="text-align:center;color:var(--dim);padding:32px">No services configured</td></tr>';
    return;
  }
  tbody.innerHTML = entries
    .map(
      ([name, svc]) => {
        const audioParts = [];
        if (svc.stt) audioParts.push('STT: ' + escHtml(svc.stt.provider) + (svc.stt.language ? ' (' + escHtml(svc.stt.language) + ')' : ''));
        if (svc.tts) audioParts.push('TTS: ' + escHtml(svc.tts.provider) + (svc.tts.language ? ' (' + escHtml(svc.tts.language) + ')' : ''));
        const audioLabel = audioParts.length > 0
          ? `<div style="margin-top:3px;font-size:11px;color:var(--dim)">${audioParts.join(' · ')}</div>`
          : '';
        return `
    <tr>
      <td style="font-weight:500">${escHtml(name)}${audioLabel}</td>
      <td>${escHtml(svc.channel)}</td>
      <td class="webhook-cell" id="wh-cell-${escHtml(name)}">
        <span class="webhook-text mono">${escHtml(svc.webhook)}</span>
      </td>
      <td id="cc-cell-${escHtml(name)}" data-code="${escHtml(svc.code || "")}" data-command="${escHtml(svc.command || "")}" style="color:var(--dim);font-size:12px">${escHtml(svc.code || svc.command || "—")}</td>
      <td id="act-cell-${escHtml(name)}" style="text-align:right;white-space:nowrap">
        <button class="btn-edit" data-name="${escHtml(name)}" data-action="audio">Audio</button>
        <button class="btn-edit" data-name="${escHtml(name)}" data-action="edit">Edit</button>
        <button class="btn-danger" data-name="${escHtml(name)}" data-action="remove">Remove</button>
      </td>
    </tr>
  `;
      },
    )
    .join("");

  // Attach event listeners
  tbody.querySelectorAll('[data-action="audio"]').forEach(btn => {
    btn.addEventListener('click', () => editAudioSettings(btn.dataset.name));
  });
  tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => editService(btn.dataset.name));
  });
  tbody.querySelectorAll('[data-action="remove"]').forEach(btn => {
    btn.addEventListener('click', () => removeService(btn.dataset.name));
  });
}

function editService(name) {
  const whCell = document.getElementById("wh-cell-" + name);
  const ccCell = document.getElementById("cc-cell-" + name);
  const actCell = document.getElementById("act-cell-" + name);
  if (!whCell || !ccCell || !actCell) return;

  const currentWebhook = whCell.querySelector(".webhook-text")?.textContent || "";
  const currentCode = ccCell.dataset.code || "";
  const currentCommand = ccCell.dataset.command || "";

  whCell.innerHTML = `<input id="edit-wh-input" value="${escHtml(currentWebhook)}" placeholder="Webhook URL" style="width:100%">`;
  ccCell.innerHTML = `
    <input id="edit-code-input" value="${escHtml(currentCode)}" placeholder="Magic code" style="width:100%;margin-bottom:4px">
    <input id="edit-cmd-input" value="${escHtml(currentCommand)}" placeholder="Slash command" style="width:100%">`;
  actCell.innerHTML = `
    <button class="btn-edit" id="save-svc-btn">Save</button>
    <button style="margin-left:4px;background:none;border:none;cursor:pointer;color:var(--dim);font-size:13px" id="cancel-svc-btn">Cancel</button>`;

  document.getElementById("save-svc-btn").addEventListener("click", () => saveService(name));
  document.getElementById("cancel-svc-btn").addEventListener("click", () => loadConfigData());
  document.getElementById("edit-wh-input")?.focus();
}

async function saveService(name) {
  const webhook = document.getElementById("edit-wh-input")?.value.trim();
  const code = document.getElementById("edit-code-input")?.value.trim();
  const command = document.getElementById("edit-cmd-input")?.value.trim();
  if (!webhook) { alert("Webhook URL is required"); return; }
  const res = await fetch(
    API + "/api/config/services/" + encodeURIComponent(name),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhook, code: code || null, command: command || null }),
    },
  );
  if (!res.ok) {
    let m = `Save failed (${res.status})`;
    try { m = (await res.json()).error || m; } catch {}
    alert(m);
    return;
  }
  loadConfigData();
}

async function removeService(name) {
  if (!confirm(`Remove service "${name}"?`)) return;
  const res = await fetch(
    API + "/api/config/services/" + encodeURIComponent(name),
    { method: "DELETE" },
  );
  if (!res.ok) {
    let m = `Remove failed (${res.status})`;
    try { m = (await res.json()).error || m; } catch {}
    alert(m);
    return;
  }
  loadConfigData();
}

function selectServiceChannel(chName) {
  document.getElementById("svc-channel").value = chName;
  document.getElementById("svc-step-pick").style.display = "none";
  document.getElementById("svc-step-form").style.display = "";
  const ch = state.currentChannels[chName];
  const tLabel = ch?.type ? (ch.type.charAt(0).toUpperCase() + ch.type.slice(1)) : "";
  document.getElementById("svc-step-hint").textContent =
    "Add a service for channel \"" + chName + "\"" + (tLabel ? " (" + tLabel + ")" : "") + ".";
  updateServiceForm();
  document.getElementById("svc-name").focus();
}

function backToServicePicker() {
  document.getElementById("svc-step-form").style.display = "none";
  document.getElementById("svc-step-pick").style.display = "";
  document.getElementById("svc-channel").value = "";
  document.getElementById("svc-name").value = "";
  document.getElementById("svc-webhook").value = "";
  document.getElementById("svc-code").value = "";
  document.getElementById("svc-command").value = "";
}

function renderServiceChannelPicker(channels) {
  const grid = document.getElementById("svc-channel-picker");
  const noChannels = document.getElementById("svc-no-channels");
  const names = Object.keys(channels);
  if (names.length === 0) {
    grid.innerHTML = "";
    noChannels.style.display = "";
    return;
  }
  noChannels.style.display = "none";
  grid.innerHTML = names
    .map((name) => {
      const ch = channels[name];
      const icon = channelIcons[ch.type] || "📨";
      const detail = ch.number || ch.from_email || (ch.bot_token ? ch.bot_token.slice(0, 12) + "…" : "");
      return `<div class="picker-card" data-ch="${escHtml(name)}">
        <div class="picker-icon">${icon}</div>
        <div class="picker-label">${escHtml(name)}</div>
        <div class="picker-sub">${escHtml(ch.type)}${detail ? " · " + escHtml(detail) : ""}</div>
      </div>`;
    })
    .join("");

  grid.querySelectorAll('.picker-card').forEach(card => {
    card.addEventListener('click', () => selectServiceChannel(card.dataset.ch));
  });
}

function updateServiceForm() {
  const chName = document.getElementById("svc-channel").value;
  const ch = state.currentChannels[chName];
  const isServiceMode = ch?.mode === "service";
  const ccRow = document.getElementById("svc-cc-row");
  const hint = document.getElementById("svc-mode-hint");
  if (ccRow) ccRow.style.display = isServiceMode ? "none" : "";
  if (hint) hint.textContent = isServiceMode ? "Service mode — no code or command needed." : "";
}

async function addService() {
  const name = document.getElementById("svc-name").value.trim();
  const channel = document.getElementById("svc-channel").value;
  const webhook = document.getElementById("svc-webhook").value.trim();
  const code = document.getElementById("svc-code").value.trim();
  const command = document.getElementById("svc-command").value.trim();
  if (!name || !channel || !webhook) {
    alert("Name, channel and webhook URL are required");
    return;
  }
  const res = await fetch(API + "/api/config/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name, channel, webhook,
      ...(code && { code }),
      ...(command && { command }),
    }),
  });
  if (!res.ok) {
    const d = await res.json();
    alert(d.error || "Failed to add service");
    return;
  }
  backToServicePicker();
  loadConfigData();
}

// --- Audio (STT / TTS) settings per service ---
const sttProviderMap = {
  google:  { label: 'Google', key: 'google_api_key' },
  whisper: { label: 'Whisper (OpenAI)', key: 'openai_api_key' },
  deepgram:{ label: 'Deepgram', key: 'deepgram_api_key' },
};
const ttsProviderMap = {
  google:     { label: 'Google', key: 'google_api_key' },
  elevenlabs: { label: 'ElevenLabs', key: 'elevenlabs_api_key' },
  openai:     { label: 'OpenAI', key: 'openai_api_key' },
};

function buildProviderOptions(map, currentProvider) {
  let html = `<option value=""${!currentProvider ? ' selected' : ''}>None</option>`;
  for (const [id, info] of Object.entries(map)) {
    const hasKey = !!(state.cachedSettings[info.key]);
    const sel = currentProvider === id ? ' selected' : '';
    const dis = hasKey ? '' : ' disabled';
    const suffix = hasKey ? '' : ' (no API key)';
    html += `<option value="${id}"${sel}${dis}>${info.label}${suffix}</option>`;
  }
  return html;
}

async function editAudioSettings(name) {
  document.querySelectorAll('.audio-settings-row').forEach(el => el.remove());
  document.querySelectorAll('.sms-settings-row').forEach(el => el.remove());

  // Ensure fresh settings
  const { loadSettings } = await import('./settings.js');
  await loadSettings();

  const svc = state.currentServices[name];
  if (!svc) return;
  const stt = svc.stt || {};
  const tts = svc.tts || {};

  const tbody = document.getElementById('services-body');
  const rows = tbody.querySelectorAll('tr');
  let targetRow = null;
  for (const row of rows) {
    const firstTd = row.querySelector('td');
    if (firstTd && firstTd.textContent.trim().startsWith(name)) { targetRow = row; break; }
  }
  if (!targetRow) return;

  const settingsRow = document.createElement('tr');
  settingsRow.className = 'audio-settings-row';
  const td = document.createElement('td');
  td.colSpan = 6;
  td.innerHTML = `
    <div style="padding:14px 16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin:4px 0 8px">
      <div style="font-size:13px;font-weight:600;margin-bottom:12px">Audio Settings &mdash; ${escHtml(name)}</div>
      <div style="display:flex;gap:24px;flex-wrap:wrap">
        <div style="flex:1;min-width:220px">
          <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--dim)">Speech-to-Text (incoming audio)</div>
          <div class="form-row">
            <select id="audio-stt-provider" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
              ${buildProviderOptions(sttProviderMap, stt.provider)}
            </select>
          </div>
          <div id="audio-stt-lang-row" class="form-row" style="${stt.provider ? '' : 'display:none'}">
            <input id="audio-stt-lang" value="${escHtml(stt.language || '')}" placeholder="Language (e.g. en-US, he-IL)" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
          </div>
        </div>
        <div style="flex:1;min-width:220px">
          <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--dim)">Text-to-Speech (outgoing audio)</div>
          <div class="form-row">
            <select id="audio-tts-provider" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
              ${buildProviderOptions(ttsProviderMap, tts.provider)}
            </select>
          </div>
          <div id="audio-tts-lang-row" class="form-row" style="${tts.provider ? '' : 'display:none'}">
            <input id="audio-tts-lang" value="${escHtml(tts.language || '')}" placeholder="Language (e.g. en-US, he-IL)" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
          </div>
          <div id="audio-tts-voice-row" class="form-row" style="${tts.provider ? '' : 'display:none'}">
            <input id="audio-tts-voice" value="${escHtml(tts.voice || '')}" placeholder="Voice (optional, e.g. alloy, Rachel)" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg);color:var(--text)">
          </div>
        </div>
      </div>
      <div class="form-row" style="margin-top:12px;gap:8px">
        <button class="btn btn-primary" id="save-audio-btn">Save</button>
        <button style="background:none;border:1px solid var(--border);padding:6px 12px;border-radius:6px;font-size:13px;cursor:pointer;color:var(--dim)" id="cancel-audio-btn">Cancel</button>
        <span id="audio-settings-status" style="font-size:12px;margin-left:8px;align-self:center"></span>
      </div>
    </div>`;
  settingsRow.appendChild(td);
  targetRow.after(settingsRow);

  // Event listeners
  document.getElementById('audio-stt-provider').addEventListener('change', toggleAudioLangFields);
  document.getElementById('audio-tts-provider').addEventListener('change', toggleAudioLangFields);
  document.getElementById('save-audio-btn').addEventListener('click', () => saveAudioSettings(name));
  document.getElementById('cancel-audio-btn').addEventListener('click', closeAudioSettings);
}

function toggleAudioLangFields() {
  const sttProv = document.getElementById('audio-stt-provider')?.value;
  const ttsProv = document.getElementById('audio-tts-provider')?.value;
  const sttLang = document.getElementById('audio-stt-lang-row');
  const ttsLang = document.getElementById('audio-tts-lang-row');
  const ttsVoice = document.getElementById('audio-tts-voice-row');
  if (sttLang) sttLang.style.display = sttProv ? '' : 'none';
  if (ttsLang) ttsLang.style.display = ttsProv ? '' : 'none';
  if (ttsVoice) ttsVoice.style.display = ttsProv ? '' : 'none';
}

async function saveAudioSettings(name) {
  const svc = state.currentServices[name];
  if (!svc) return;

  const sttProvider = document.getElementById('audio-stt-provider')?.value || '';
  const sttLang = document.getElementById('audio-stt-lang')?.value.trim() || '';
  const ttsProvider = document.getElementById('audio-tts-provider')?.value || '';
  const ttsLang = document.getElementById('audio-tts-lang')?.value.trim() || '';
  const ttsVoice = document.getElementById('audio-tts-voice')?.value.trim() || '';

  const stt = sttProvider ? { provider: sttProvider, language: sttLang || undefined } : null;
  const tts = ttsProvider ? { provider: ttsProvider, language: ttsLang || undefined, voice: ttsVoice || undefined } : null;

  const statusEl = document.getElementById('audio-settings-status');
  try {
    const res = await fetch(API + '/api/config/services/' + encodeURIComponent(name), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhook: svc.webhook,
        code: svc.code || null,
        command: svc.command || null,
        stt, tts,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || 'Save failed');
    }
    if (statusEl) { statusEl.textContent = 'Saved'; statusEl.style.color = 'var(--green)'; }
    setTimeout(() => { closeAudioSettings(); loadConfigData(); }, 600);
  } catch (e) {
    if (statusEl) { statusEl.textContent = e.message; statusEl.style.color = 'var(--red)'; }
  }
}

function closeAudioSettings() {
  document.querySelectorAll('.audio-settings-row').forEach(el => el.remove());
}

export function render(container) {
  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Channel</th>
            <th>Webhook</th>
            <th>Code / Command</th>
            <th style="width: 190px"></th>
          </tr>
        </thead>
        <tbody id="services-body"></tbody>
      </table>
    </div>
    <div class="add-form">
      <h3>Add Service</h3>
      <div id="svc-step-pick">
        <p class="form-hint">Choose which channel this service will use.</p>
        <div class="picker-grid" id="svc-channel-picker"></div>
        <p id="svc-no-channels" style="display:none;font-size:13px;color:var(--dim);text-align:center;padding:20px 0">
          No channels configured yet. Add a channel first.
        </p>
      </div>
      <div id="svc-step-form" style="display: none">
        <button class="step-back" id="svc-back-btn">
          <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 -960 960 960" fill="currentColor"><path d="M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z"/></svg>
          Back to channels
        </button>
        <p class="form-hint" id="svc-step-hint"></p>
        <input type="hidden" id="svc-channel" />
        <div class="form-row">
          <input id="svc-name" placeholder="Service name (e.g. support)" />
          <input id="svc-webhook" placeholder="Webhook URL (e.g. http://localhost:3000/support)" />
        </div>
        <div class="form-row" id="svc-cc-row" style="display: none">
          <input id="svc-code" placeholder="Magic code — WhatsApp multi-service (optional)" />
          <input id="svc-command" placeholder="Slash command — Telegram, e.g. /support (optional)" />
        </div>
        <div class="form-row">
          <button class="btn btn-primary" id="add-svc-btn">Add Service</button>
          <span id="svc-mode-hint" style="font-size: 12px; color: var(--dim)"></span>
        </div>
      </div>
    </div>
  `;
}

export function init() {
  document.getElementById("svc-back-btn").addEventListener("click", backToServicePicker);
  document.getElementById("add-svc-btn").addEventListener("click", addService);
  loadConfigData();
}

export function onConfigLoaded() {
  renderServices(state.currentServices, state.currentChannels);
  renderServiceChannelPicker(state.currentChannels);
  const svcCh = document.getElementById("svc-channel")?.value;
  if (svcCh && !state.currentChannels[svcCh]) {
    backToServicePicker();
  }
}

export function destroy() {}
