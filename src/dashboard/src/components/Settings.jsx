import { useState, useEffect } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API, apiFetch } from '../api.js';

const FIELDS = [
  { key: 'twilio_account_sid', label: 'Account SID', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', group: 'twilio' },
  { key: 'twilio_auth_token', label: 'Auth Token', placeholder: 'Auth Token', group: 'twilio' },
  { key: 'google_api_key', label: 'Google API Key', placeholder: 'AIza...', sub: '(STT & TTS)', group: 'api' },
  { key: 'elevenlabs_api_key', label: 'ElevenLabs API Key', placeholder: 'sk_...', sub: '(TTS)', group: 'api' },
  { key: 'openai_api_key', label: 'OpenAI API Key', placeholder: 'sk-...', sub: '(Whisper STT & TTS)', group: 'api' },
  { key: 'deepgram_api_key', label: 'Deepgram API Key', placeholder: 'Deepgram API key', sub: '(STT)', group: 'api' },
  { key: 'anthropic_api_key', label: 'Anthropic API Key', placeholder: 'sk-ant-...', sub: '(AI Formatting)', group: 'api' },
  { key: 'mcp_secret', label: 'MCP Secret', placeholder: 'Bearer token for MCP access', sub: '(required for external access)', group: 'security' },
];

function SettingsInput({ label, placeholder, sub, value, onChange }) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label className="text-xs font-medium block mb-1 text-text">
        {label}{sub && <span className="text-dim font-normal"> {sub}</span>}
      </label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          autoComplete="off"
          data-1p-ignore
          className="w-full py-2 pl-3 pr-14 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <button
          onClick={() => setVisible(!visible)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-dim hover:text-text bg-transparent border-none cursor-pointer px-2 py-1"
        >
          {visible ? 'hide' : 'show'}
        </button>
      </div>
    </div>
  );
}

export default function Settings() {
  const { settings } = useAppState();
  const dispatch = useDispatch();
  const [values, setValues] = useState({});
  const [originals, setOriginals] = useState({});
  const [status, setStatus] = useState('');
  const [statusColor, setStatusColor] = useState('');
  const [port, setPort] = useState('');
  const [origPort, setOrigPort] = useState('');
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [origAutoUpdate, setOrigAutoUpdate] = useState(true);
  const [version, setVersion] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [importStatusColor, setImportStatusColor] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const res = await apiFetch(API + '/api/settings');
      const data = await res.json();
      const s = data.settings || {};
      dispatch({ type: 'SET_SETTINGS', payload: s });
      const v = {};
      for (const f of FIELDS) v[f.key] = s[f.key] || '';
      setValues(v);
      setOriginals({ ...v });
      setAllowLocal(!!s.allow_local_webhooks);
      setOrigAllowLocal(!!s.allow_local_webhooks);
      const p = String(data.port || 4000);
      setPort(p);
      setOrigPort(p);
      const au = data.autoUpdate !== false;
      setAutoUpdate(au);
      setOrigAutoUpdate(au);
      // Fetch version
      try {
        const ur = await apiFetch(API + '/api/update/status');
        const ud = await ur.json();
        if (ud.currentVersion) setVersion(ud.currentVersion);
      } catch {}
    } catch (e) {
      console.error('Failed to load settings', e);
    }
  }

  async function save() {
    const body = {};
    for (const f of FIELDS) {
      const val = (values[f.key] || '').trim();
      if (val !== (originals[f.key] || '')) body[f.key] = val;
    }
    if (allowLocal !== origAllowLocal) body.allow_local_webhooks = allowLocal;
    if (port !== origPort) body.port = parseInt(port, 10) || 4000;
    if (autoUpdate !== origAutoUpdate) body.auto_update = autoUpdate;
    if (Object.keys(body).length === 0) {
      setStatus('No changes to save');
      setStatusColor('text-dim');
      setTimeout(() => setStatus(''), 2000);
      return;
    }
    try {
      const res = await apiFetch(API + '/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      const portChanged = port !== origPort;
      setStatus(portChanged ? 'Saved — restart required for port change' : 'Saved');
      setStatusColor(portChanged ? 'text-yellow-400' : 'text-green');
      setTimeout(() => setStatus(''), portChanged ? 5000 : 2000);
      loadSettings();
      try {
        const r = await apiFetch(API + '/api/settings/twilio-defaults');
        const d = await r.json();
        dispatch({ type: 'SET_TWILIO_DEFAULTS', payload: { sid: d.account_sid || '', tok: d.auth_token || '' } });
      } catch {}
    } catch (e) {
      setStatus(e.message);
      setStatusColor('text-red');
    }
  }

  function update(key, val) {
    setValues(prev => ({ ...prev, [key]: val }));
  }

  const [allowLocal, setAllowLocal] = useState(false);
  const [origAllowLocal, setOrigAllowLocal] = useState(false);

  const twilioFields = FIELDS.filter(f => f.group === 'twilio');
  const apiFields = FIELDS.filter(f => f.group === 'api');
  const securityFields = FIELDS.filter(f => f.group === 'security');

  return (
    <div className="max-w-xl mx-auto py-6">
      <div className="bg-surface border border-border rounded-xl p-6 shadow-sm space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-text mb-1">Server</h3>
          <p className="text-xs text-dim mb-4">General server configuration.</p>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium block mb-1 text-text">Port <span className="text-dim font-normal">(requires restart)</span></label>
              <input
                type="number"
                min="1"
                max="65535"
                placeholder="4000"
                value={port}
                onChange={e => setPort(e.target.value)}
                className="w-32 py-2 px-3 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoUpdate}
                onChange={e => setAutoUpdate(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
              <div>
                <span className="text-xs font-medium text-text">Auto-update{version && <span className="text-dim font-normal ml-2">v{version}</span>}</span>
                <p className="text-[11px] text-dim mt-0.5">Automatically check for and install new versions.</p>
              </div>
            </label>
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-semibold text-text mb-1">Twilio Defaults</h3>
          <p className="text-xs text-dim mb-4">Default credentials used when adding SMS or Voice channels.</p>
          <div className="space-y-3">
            {twilioFields.map(f => (
              <SettingsInput key={f.key} label={f.label} placeholder={f.placeholder} sub={f.sub} value={values[f.key] || ''} onChange={v => update(f.key, v)} />
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-semibold text-text mb-1">API Keys</h3>
          <p className="text-xs text-dim mb-4">Keys for speech-to-text and text-to-speech providers.</p>
          <div className="space-y-3">
            {apiFields.map(f => (
              <SettingsInput key={f.key} label={f.label} placeholder={f.placeholder} sub={f.sub} value={values[f.key] || ''} onChange={v => update(f.key, v)} />
            ))}
          </div>
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-semibold text-text mb-1">Security</h3>
          <p className="text-xs text-dim mb-4">Authentication for MCP server access. Clients must pass this as a Bearer token.</p>
          <div className="space-y-3">
            {securityFields.map(f => (
              <SettingsInput key={f.key} label={f.label} placeholder={f.placeholder} sub={f.sub} value={values[f.key] || ''} onChange={v => update(f.key, v)} />
            ))}
          </div>
          <label className="flex items-center gap-3 mt-4 cursor-pointer">
            <input
              type="checkbox"
              checked={allowLocal}
              onChange={e => setAllowLocal(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
            />
            <div>
              <span className="text-xs font-medium text-text">Allow local webhooks</span>
              <p className="text-[11px] text-dim mt-0.5">Allow webhooks to localhost and private IPs (e.g. 192.168.x.x, 10.x.x.x). Cloud metadata endpoints are always blocked.</p>
            </div>
          </label>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={save}
            className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover transition-colors"
          >
            Save Settings
          </button>
          {status && <span className={`text-xs ${statusColor}`}>{status}</span>}
        </div>

        <div className="border-t border-border pt-6">
          <h3 className="text-sm font-semibold text-text mb-1">Backup &amp; Restore</h3>
          <p className="text-xs text-dim mb-4">Export or import your ChannelKit configuration, group mappings, and auth data.</p>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleExport}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover transition-colors"
            >
              Export Backup
            </button>
            <label className="px-4 py-2 bg-surface border border-border text-text rounded-lg text-sm font-semibold hover:bg-bg-light transition-colors cursor-pointer">
              Import Backup
              <input type="file" accept=".zip" onChange={handleImport} className="hidden" />
            </label>
            {importStatus && <span className={`text-xs ${importStatusColor}`}>{importStatus}</span>}
          </div>
        </div>
      </div>
    </div>
  );

  async function handleExport() {
    try {
      const res = await apiFetch(API + '/api/export');
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `channelkit-backup-${date}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setImportStatus(e.message);
      setImportStatusColor('text-red');
      setTimeout(() => setImportStatus(''), 4000);
    }
  }

  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!confirm('This will overwrite your existing config, groups, and auth data. Continue?')) return;

    try {
      const buf = await file.arrayBuffer();
      const res = await apiFetch(API + '/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: buf,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setImportStatus(data.message || 'Import successful — restart required');
      setImportStatusColor('text-green');
      setTimeout(() => setImportStatus(''), 6000);
    } catch (err) {
      setImportStatus(err.message);
      setImportStatusColor('text-red');
      setTimeout(() => setImportStatus(''), 4000);
    }
  }
}
