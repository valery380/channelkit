import { useState, useEffect } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API } from '../api.js';
import { channelIcons, maskValue } from '../utils.jsx';

const sttProviderMap = {
  google: { label: 'Google', key: 'google_api_key' },
  whisper: { label: 'Whisper (OpenAI)', key: 'openai_api_key' },
  deepgram: { label: 'Deepgram', key: 'deepgram_api_key' },
};
const ttsProviderMap = {
  google: { label: 'Google', key: 'google_api_key' },
  elevenlabs: { label: 'ElevenLabs', key: 'elevenlabs_api_key' },
  openai: { label: 'OpenAI', key: 'openai_api_key' },
};

function ProviderSelect({ map, value, onChange, settings }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}>
      <option value="">None</option>
      {Object.entries(map).map(([id, info]) => {
        const hasKey = !!settings[info.key];
        return <option key={id} value={id} disabled={!hasKey}>{info.label}{!hasKey ? ' (no API key)' : ''}</option>;
      })}
    </select>
  );
}

function AudioSettingsRow({ name, svc, settings, onClose, loadConfig }) {
  const stt = svc.stt || {};
  const tts = svc.tts || {};
  const [sttProvider, setSttProvider] = useState(stt.provider || '');
  const [sttLang, setSttLang] = useState(stt.language || '');
  const [ttsProvider, setTtsProvider] = useState(tts.provider || '');
  const [ttsLang, setTtsLang] = useState(tts.language || '');
  const [ttsVoice, setTtsVoice] = useState(tts.voice || '');
  const [status, setStatus] = useState('');

  async function save() {
    const sttVal = sttProvider ? { provider: sttProvider, ...(sttLang && { language: sttLang }) } : null;
    const ttsVal = ttsProvider ? { provider: ttsProvider, ...(ttsLang && { language: ttsLang }), ...(ttsVoice && { voice: ttsVoice }) } : null;
    try {
      const res = await fetch(API + '/api/config/services/' + encodeURIComponent(name), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook: svc.webhook, code: svc.code || null, command: svc.command || null, stt: sttVal, tts: ttsVal }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      setStatus('Saved');
      setTimeout(() => { onClose(); loadConfig(); }, 600);
    } catch (e) { setStatus(e.message); }
  }

  return (
    <tr className="audio-settings-row">
      <td colSpan={5}>
        <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, margin: '4px 0 8px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Audio Settings &mdash; {name}</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--dim)' }}>Speech-to-Text (incoming audio)</div>
              <div className="form-row"><ProviderSelect map={sttProviderMap} value={sttProvider} onChange={setSttProvider} settings={settings} /></div>
              {sttProvider && <div className="form-row"><input value={sttLang} onChange={e => setSttLang(e.target.value)} placeholder="Language (e.g. en-US, he-IL)" style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }} /></div>}
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--dim)' }}>Text-to-Speech (outgoing audio)</div>
              <div className="form-row"><ProviderSelect map={ttsProviderMap} value={ttsProvider} onChange={setTtsProvider} settings={settings} /></div>
              {ttsProvider && <div className="form-row"><input value={ttsLang} onChange={e => setTtsLang(e.target.value)} placeholder="Language (e.g. en-US, he-IL)" style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }} /></div>}
              {ttsProvider && <div className="form-row"><input value={ttsVoice} onChange={e => setTtsVoice(e.target.value)} placeholder="Voice (optional, e.g. alloy, Rachel)" style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }} /></div>}
            </div>
          </div>
          <div className="form-row" style={{ marginTop: 12, gap: 8 }}>
            <button className="btn btn-primary" onClick={save}>Save</button>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: 'var(--dim)' }}>Cancel</button>
            {status && <span style={{ fontSize: 12, marginLeft: 8, color: status === 'Saved' ? 'var(--green)' : 'var(--red)' }}>{status}</span>}
          </div>
        </div>
      </td>
    </tr>
  );
}

function EditableServiceRow({ name, svc, loadConfig }) {
  const [editing, setEditing] = useState(false);
  const [webhook, setWebhook] = useState(svc.webhook);
  const [code, setCode] = useState(svc.code || '');
  const [command, setCommand] = useState(svc.command || '');

  async function save() {
    if (!webhook) { alert('Webhook URL is required'); return; }
    const res = await fetch(API + '/api/config/services/' + encodeURIComponent(name), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook, code: code || null, command: command || null }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Save failed'); return; }
    setEditing(false);
    loadConfig();
  }

  async function remove() {
    if (!confirm(`Remove service "${name}"?`)) return;
    const res = await fetch(API + '/api/config/services/' + encodeURIComponent(name), { method: 'DELETE' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Remove failed'); return; }
    loadConfig();
  }

  const audioParts = [];
  if (svc.stt) audioParts.push('STT: ' + svc.stt.provider + (svc.stt.language ? ' (' + svc.stt.language + ')' : ''));
  if (svc.tts) audioParts.push('TTS: ' + svc.tts.provider + (svc.tts.language ? ' (' + svc.tts.language + ')' : ''));

  if (editing) {
    return (
      <tr>
        <td style={{ fontWeight: 500 }}>{name}</td>
        <td>{svc.channel}</td>
        <td><input value={webhook} onChange={e => setWebhook(e.target.value)} placeholder="Webhook URL" style={{ width: '100%' }} autoFocus /></td>
        <td>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="Magic code" style={{ width: '100%', marginBottom: 4 }} />
          <input value={command} onChange={e => setCommand(e.target.value)} placeholder="Slash command" style={{ width: '100%' }} />
        </td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button className="btn-edit" onClick={save}>Save</button>
          <button onClick={() => setEditing(false)} style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dim)', fontSize: 13 }}>Cancel</button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td style={{ fontWeight: 500 }}>
        {name}
        {audioParts.length > 0 && <div style={{ marginTop: 3, fontSize: 11, color: 'var(--dim)' }}>{audioParts.join(' \u00b7 ')}</div>}
      </td>
      <td>{svc.channel}</td>
      <td className="webhook-cell"><span className="webhook-text mono">{svc.webhook}</span></td>
      <td style={{ color: 'var(--dim)', fontSize: 12 }}>{svc.code || svc.command || '\u2014'}</td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <button className="btn-edit" data-name={name} onClick={() => 'audio'}>Audio</button>
        <button className="btn-edit" onClick={() => setEditing(true)}>Edit</button>
        <button className="btn-danger" onClick={remove}>Remove</button>
      </td>
    </tr>
  );
}

export default function Services({ loadConfig }) {
  const { services, channels, settings } = useAppState();
  const dispatch = useDispatch();
  const [audioTarget, setAudioTarget] = useState(null);
  const [step, setStep] = useState('pick');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [svcName, setSvcName] = useState('');
  const [svcWebhook, setSvcWebhook] = useState('');
  const [svcCode, setSvcCode] = useState('');
  const [svcCommand, setSvcCommand] = useState('');

  useEffect(() => {
    loadConfig();
    // Load settings for audio provider detection
    fetch(API + '/api/settings')
      .then(r => r.json())
      .then(data => dispatch({ type: 'SET_SETTINGS', payload: data.settings || {} }))
      .catch(() => {});
  }, [loadConfig, dispatch]);

  function selectChannel(name) {
    setSelectedChannel(name);
    setStep('form');
  }

  function backToPicker() {
    setStep('pick');
    setSelectedChannel('');
    setSvcName('');
    setSvcWebhook('');
    setSvcCode('');
    setSvcCommand('');
  }

  async function addService() {
    if (!svcName || !selectedChannel || !svcWebhook) { alert('Name, channel and webhook URL are required'); return; }
    const res = await fetch(API + '/api/config/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: svcName, channel: selectedChannel, webhook: svcWebhook,
        ...(svcCode && { code: svcCode }),
        ...(svcCommand && { command: svcCommand }),
      }),
    });
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed to add service'); return; }
    backToPicker();
    loadConfig();
  }

  const isServiceMode = channels[selectedChannel]?.mode === 'service';
  const svcEntries = Object.entries(services);
  const channelNames = Object.keys(channels);

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Channel</th>
              <th>Webhook</th>
              <th>Code / Command</th>
              <th style={{ width: 190 }}></th>
            </tr>
          </thead>
          <tbody>
            {svcEntries.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--dim)', padding: 32 }}>No services configured</td></tr>
            ) : svcEntries.map(([name, svc]) => (
              <ServiceRowWithAudio
                key={name}
                name={name}
                svc={svc}
                loadConfig={loadConfig}
                settings={settings}
                audioTarget={audioTarget}
                setAudioTarget={setAudioTarget}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="add-form">
        <h3>Add Service</h3>
        {step === 'pick' ? (
          <div>
            <p className="form-hint">Choose which channel this service will use.</p>
            {channelNames.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--dim)', textAlign: 'center', padding: '20px 0' }}>No channels configured yet. Add a channel first.</p>
            ) : (
              <div className="picker-grid">
                {channelNames.map(name => {
                  const ch = channels[name];
                  const icon = channelIcons[ch.type] || '\uD83D\uDCE8';
                  const detail = ch.number || ch.from_email || (ch.bot_token ? ch.bot_token.slice(0, 12) + '\u2026' : '');
                  return (
                    <div key={name} className="picker-card" onClick={() => selectChannel(name)}>
                      <div className="picker-icon">{icon}</div>
                      <div className="picker-label">{name}</div>
                      <div className="picker-sub">{ch.type}{detail ? ' \u00b7 ' + detail : ''}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div>
            <button className="step-back" onClick={backToPicker}>
              <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 -960 960 960" fill="currentColor"><path d="M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z" /></svg>
              Back to channels
            </button>
            <p className="form-hint">Add a service for channel "{selectedChannel}"{channels[selectedChannel]?.type ? ` (${channels[selectedChannel].type.charAt(0).toUpperCase() + channels[selectedChannel].type.slice(1)})` : ''}.</p>
            <div className="form-row">
              <input value={svcName} onChange={e => setSvcName(e.target.value)} placeholder="Service name (e.g. support)" autoFocus />
              <input value={svcWebhook} onChange={e => setSvcWebhook(e.target.value)} placeholder="Webhook URL (e.g. http://localhost:3000/support)" />
            </div>
            {!isServiceMode && (
              <div className="form-row">
                <input value={svcCode} onChange={e => setSvcCode(e.target.value)} placeholder="Magic code — WhatsApp multi-service (optional)" />
                <input value={svcCommand} onChange={e => setSvcCommand(e.target.value)} placeholder="Slash command — Telegram, e.g. /support (optional)" />
              </div>
            )}
            <div className="form-row">
              <button className="btn btn-primary" onClick={addService}>Add Service</button>
              {isServiceMode && <span style={{ fontSize: 12, color: 'var(--dim)' }}>Service mode — no code or command needed.</span>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function ServiceRowWithAudio({ name, svc, loadConfig, settings, audioTarget, setAudioTarget }) {
  const [editing, setEditing] = useState(false);
  const [webhook, setWebhook] = useState(svc.webhook);
  const [code, setCode] = useState(svc.code || '');
  const [command, setCommand] = useState(svc.command || '');
  const showAudio = audioTarget === name;

  async function save() {
    if (!webhook) { alert('Webhook URL is required'); return; }
    const res = await fetch(API + '/api/config/services/' + encodeURIComponent(name), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook, code: code || null, command: command || null }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Save failed'); return; }
    setEditing(false);
    loadConfig();
  }

  async function remove() {
    if (!confirm(`Remove service "${name}"?`)) return;
    const res = await fetch(API + '/api/config/services/' + encodeURIComponent(name), { method: 'DELETE' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Remove failed'); return; }
    loadConfig();
  }

  const audioParts = [];
  if (svc.stt) audioParts.push('STT: ' + svc.stt.provider + (svc.stt.language ? ' (' + svc.stt.language + ')' : ''));
  if (svc.tts) audioParts.push('TTS: ' + svc.tts.provider + (svc.tts.language ? ' (' + svc.tts.language + ')' : ''));

  return (
    <>
      {editing ? (
        <tr>
          <td style={{ fontWeight: 500 }}>{name}</td>
          <td>{svc.channel}</td>
          <td><input value={webhook} onChange={e => setWebhook(e.target.value)} placeholder="Webhook URL" style={{ width: '100%' }} autoFocus /></td>
          <td>
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="Magic code" style={{ width: '100%', marginBottom: 4 }} />
            <input value={command} onChange={e => setCommand(e.target.value)} placeholder="Slash command" style={{ width: '100%' }} />
          </td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <button className="btn-edit" onClick={save}>Save</button>
            <button onClick={() => setEditing(false)} style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--dim)', fontSize: 13 }}>Cancel</button>
          </td>
        </tr>
      ) : (
        <tr>
          <td style={{ fontWeight: 500 }}>
            {name}
            {audioParts.length > 0 && <div style={{ marginTop: 3, fontSize: 11, color: 'var(--dim)' }}>{audioParts.join(' \u00b7 ')}</div>}
          </td>
          <td>{svc.channel}</td>
          <td className="webhook-cell"><span className="webhook-text mono">{svc.webhook}</span></td>
          <td style={{ color: 'var(--dim)', fontSize: 12 }}>{svc.code || svc.command || '\u2014'}</td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <button className="btn-edit" onClick={() => setAudioTarget(showAudio ? null : name)}>Audio</button>
            <button className="btn-edit" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn-danger" onClick={remove}>Remove</button>
          </td>
        </tr>
      )}
      {showAudio && (
        <AudioSettingsRow name={name} svc={svc} settings={settings} onClose={() => setAudioTarget(null)} loadConfig={loadConfig} />
      )}
    </>
  );
}
