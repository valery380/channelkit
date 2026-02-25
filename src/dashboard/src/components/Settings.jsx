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
];

function SettingsInput({ label, placeholder, sub, value, onChange }) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 3 }}>
        {label}{sub && <span style={{ color: 'var(--dim)', fontWeight: 400 }}> {sub}</span>}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ width: '100%', padding: '7px 36px 7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}
        />
        <button
          onClick={() => setVisible(!visible)}
          style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--dim)', fontSize: 11 }}
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
      setStatusColor('var(--dim)');
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
      setStatusColor('var(--green)');
      setTimeout(() => setStatus(''), 2000);
      loadSettings();
      // Refresh twilio defaults
      try {
        const r = await fetch(API + '/api/settings/twilio-defaults');
        const d = await r.json();
        dispatch({ type: 'SET_TWILIO_DEFAULTS', payload: { sid: d.account_sid || '', tok: d.auth_token || '' } });
      } catch {}
    } catch (e) {
      setStatus(e.message);
      setStatusColor('var(--red)');
    }
  }

  function update(key, val) {
    setValues(prev => ({ ...prev, [key]: val }));
  }

  const twilioFields = FIELDS.filter(f => f.group === 'twilio');
  const apiFields = FIELDS.filter(f => f.group === 'api');

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 0' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Twilio Defaults</div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 12 }}>Default credentials used when adding SMS or Voice channels.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {twilioFields.map(f => (
            <SettingsInput key={f.key} label={f.label} placeholder={f.placeholder} sub={f.sub} value={values[f.key] || ''} onChange={v => update(f.key, v)} />
          ))}
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20, marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>API Keys</div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 12 }}>Keys for speech-to-text and text-to-speech providers.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {apiFields.map(f => (
            <SettingsInput key={f.key} label={f.label} placeholder={f.placeholder} sub={f.sub} value={values[f.key] || ''} onChange={v => update(f.key, v)} />
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={save} style={{ background: 'var(--accent)', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Save Settings
        </button>
        {status && <span style={{ fontSize: 12, color: statusColor }}>{status}</span>}
      </div>
    </div>
  );
}
