import { API } from '../utils.js';
import { state } from '../app.js';

const settingsFields = [
  { id: 'set-twilio-sid',     key: 'twilio_account_sid' },
  { id: 'set-twilio-token',   key: 'twilio_auth_token' },
  { id: 'set-google-key',     key: 'google_api_key' },
  { id: 'set-elevenlabs-key', key: 'elevenlabs_api_key' },
  { id: 'set-openai-key',     key: 'openai_api_key' },
  { id: 'set-deepgram-key',   key: 'deepgram_api_key' },
];

export async function loadSettings() {
  try {
    const res = await fetch(API + '/api/settings');
    const data = await res.json();
    state.cachedSettings = data.settings || {};
    for (const f of settingsFields) {
      const el = document.getElementById(f.id);
      if (el) {
        el.value = state.cachedSettings[f.key] || '';
        el.dataset.original = state.cachedSettings[f.key] || '';
      }
    }
  } catch (e) {
    console.error('Failed to load settings', e);
  }
}

async function saveSettings() {
  const body = {};
  for (const f of settingsFields) {
    const el = document.getElementById(f.id);
    if (!el) continue;
    const val = el.value.trim();
    if (val !== (el.dataset.original || '')) {
      body[f.key] = val;
    }
  }
  const statusEl = document.getElementById('settings-status');
  if (Object.keys(body).length === 0) {
    statusEl.textContent = 'No changes to save';
    statusEl.style.color = 'var(--dim)';
    setTimeout(() => statusEl.textContent = '', 2000);
    return;
  }
  try {
    const res = await fetch(API + '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
    statusEl.textContent = 'Saved';
    statusEl.style.color = 'var(--green)';
    setTimeout(() => statusEl.textContent = '', 2000);
    loadSettings();
    // Refresh twilio defaults
    try {
      const r2 = await fetch(API + '/api/settings/twilio-defaults');
      const d2 = await r2.json();
      state.twilioDefaults.sid = d2.account_sid || '';
      state.twilioDefaults.tok = d2.auth_token || '';
    } catch {}
  } catch (e) {
    statusEl.textContent = e.message;
    statusEl.style.color = 'var(--red)';
  }
}

function toggleSettingsVis(btn) {
  const input = btn.parentElement.querySelector('input');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'hide';
  } else {
    input.type = 'password';
    btn.textContent = 'show';
  }
}

function settingsInput(id, label, placeholder, sublabel) {
  return `<div>
    <label style="font-size:12px;font-weight:500;display:block;margin-bottom:3px">${label}${sublabel ? ` <span style="color:var(--dim);font-weight:400">${sublabel}</span>` : ''}</label>
    <div style="position:relative">
      <input type="password" id="${id}" placeholder="${placeholder}" style="width:100%;padding:7px 36px 7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit" />
      <button class="settings-vis-toggle" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:4px;color:var(--dim);font-size:11px">show</button>
    </div>
  </div>`;
}

export function render(container) {
  container.innerHTML = `
    <div style="max-width:560px;margin:0 auto;padding:24px 0">
      <div style="margin-bottom:24px">
        <div style="font-size:15px;font-weight:600;margin-bottom:4px">Twilio Defaults</div>
        <div style="font-size:12px;color:var(--dim);margin-bottom:12px">Default credentials used when adding SMS or Voice channels.</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${settingsInput('set-twilio-sid', 'Account SID', 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')}
          ${settingsInput('set-twilio-token', 'Auth Token', 'Auth Token')}
        </div>
      </div>

      <div style="border-top:1px solid var(--border);padding-top:20px;margin-bottom:24px">
        <div style="font-size:15px;font-weight:600;margin-bottom:4px">API Keys</div>
        <div style="font-size:12px;color:var(--dim);margin-bottom:12px">Keys for speech-to-text and text-to-speech providers.</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${settingsInput('set-google-key', 'Google API Key', 'AIza...', '(STT &amp; TTS)')}
          ${settingsInput('set-elevenlabs-key', 'ElevenLabs API Key', 'sk_...', '(TTS)')}
          ${settingsInput('set-openai-key', 'OpenAI API Key', 'sk-...', '(Whisper STT &amp; TTS)')}
          ${settingsInput('set-deepgram-key', 'Deepgram API Key', 'Deepgram API key', '(STT)')}
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:10px">
        <button id="save-settings-btn" style="background:var(--accent);color:#fff;border:none;padding:8px 20px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">Save Settings</button>
        <span id="settings-status" style="font-size:12px"></span>
      </div>
    </div>
  `;
}

export function init() {
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.querySelectorAll('.settings-vis-toggle').forEach(btn => {
    btn.addEventListener('click', () => toggleSettingsVis(btn));
  });
  loadSettings();
}

export function destroy() {}
