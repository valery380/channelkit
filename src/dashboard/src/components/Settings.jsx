import { useState, useEffect } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API } from '../api.js';

const FIELDS = [
  { key: 'twilio_account_sid', label: 'Account SID', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', group: 'twilio' },
  { key: 'twilio_auth_token', label: 'Auth Token', placeholder: 'Auth Token', group: 'twilio' },
  { key: 'google_api_key', label: 'Google API Key', placeholder: 'AIza...', sub: '(STT & TTS)', group: 'api' },
  { key: 'elevenlabs_api_key', label: 'ElevenLabs API Key', placeholder: 'sk_...', sub: '(TTS)', group: 'api' },
  { key: 'openai_api_key', label: 'OpenAI API Key', placeholder: 'sk-...', sub: '(Whisper STT & TTS)', group: 'api' },
  { key: 'deepgram_api_key', label: 'Deepgram API Key', placeholder: 'Deepgram API key', sub: '(STT)', group: 'api' },
  { key: 'anthropic_api_key', label: 'Anthropic API Key', placeholder: 'sk-ant-...', sub: '(AI Formatting)', group: 'api' },
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

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const res = await fetch(API + '/api/settings');
      const data = await res.json();
      const s = data.settings || {};
      dispatch({ type: 'SET_SETTINGS', payload: s });
      const v = {};
      for (const f of FIELDS) v[f.key] = s[f.key] || '';
      setValues(v);
      setOriginals({ ...v });
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
    if (Object.keys(body).length === 0) {
      setStatus('No changes to save');
      setStatusColor('text-dim');
      setTimeout(() => setStatus(''), 2000);
      return;
    }
    try {
      const res = await fetch(API + '/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      setStatus('Saved');
      setStatusColor('text-green');
      setTimeout(() => setStatus(''), 2000);
      loadSettings();
      try {
        const r = await fetch(API + '/api/settings/twilio-defaults');
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

  const twilioFields = FIELDS.filter(f => f.group === 'twilio');
  const apiFields = FIELDS.filter(f => f.group === 'api');

  return (
    <div className="max-w-xl mx-auto py-6">
      <div className="bg-surface border border-border rounded-xl p-6 shadow-sm space-y-6">
        <div>
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

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={save}
            className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover transition-colors"
          >
            Save Settings
          </button>
          {status && <span className={`text-xs ${statusColor}`}>{status}</span>}
        </div>
      </div>
    </div>
  );
}
