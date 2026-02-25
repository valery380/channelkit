import { useState, useEffect } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API } from '../api.js';
import { channelIcons, maskValue } from '../utils.jsx';

const inputCls = 'w-full py-2 px-3 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary';
const selectCls = 'py-2 px-3 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary';

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
    <select value={value} onChange={e => onChange(e.target.value)} className={selectCls + ' flex-1'}>
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
    <tr>
      <td colSpan={5} className="px-6 py-4">
        <div className="bg-bg-light border border-border rounded-lg p-4 space-y-4">
          <div className="text-sm font-semibold text-text">Audio Settings &mdash; {name}</div>
          <div className="flex gap-6 flex-wrap">
            <div className="flex-1 min-w-[220px] space-y-2">
              <div className="text-xs font-semibold text-dim">Speech-to-Text (incoming audio)</div>
              <ProviderSelect map={sttProviderMap} value={sttProvider} onChange={setSttProvider} settings={settings} />
              {sttProvider && <input value={sttLang} onChange={e => setSttLang(e.target.value)} placeholder="Language (e.g. en-US, he-IL)" className={inputCls} />}
            </div>
            <div className="flex-1 min-w-[220px] space-y-2">
              <div className="text-xs font-semibold text-dim">Text-to-Speech (outgoing audio)</div>
              <ProviderSelect map={ttsProviderMap} value={ttsProvider} onChange={setTtsProvider} settings={settings} />
              {ttsProvider && <input value={ttsLang} onChange={e => setTtsLang(e.target.value)} placeholder="Language (e.g. en-US, he-IL)" className={inputCls} />}
              {ttsProvider && <input value={ttsVoice} onChange={e => setTtsVoice(e.target.value)} placeholder="Voice (optional, e.g. alloy, Rachel)" className={inputCls} />}
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover transition-colors" onClick={save}>Save</button>
            <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm text-dim hover:bg-bg-light transition-colors">Cancel</button>
            {status && <span className={`text-xs ml-2 ${status === 'Saved' ? 'text-green' : 'text-red'}`}>{status}</span>}
          </div>
        </div>
      </td>
    </tr>
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
        <tr className="hover:bg-bg-light transition-colors">
          <td className="px-6 py-4 font-medium text-sm text-text">{name}</td>
          <td className="px-6 py-4 text-sm text-dim">{svc.channel}</td>
          <td className="px-6 py-4"><input value={webhook} onChange={e => setWebhook(e.target.value)} placeholder="Webhook URL" className={inputCls} autoFocus /></td>
          <td className="px-6 py-4 space-y-1">
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="Magic code" className={inputCls} />
            <input value={command} onChange={e => setCommand(e.target.value)} placeholder="Slash command" className={inputCls} />
          </td>
          <td className="px-6 py-4 text-right whitespace-nowrap">
            <button onClick={save} className="px-3 py-1 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/5 transition-colors">Save</button>
            <button onClick={() => setEditing(false)} className="ml-1 px-3 py-1 text-xs text-dim hover:text-text bg-transparent border-none cursor-pointer">Cancel</button>
          </td>
        </tr>
      ) : (
        <tr className="hover:bg-bg-light transition-colors">
          <td className="px-6 py-4 text-sm font-medium text-text">
            {name}
            {audioParts.length > 0 && <div className="mt-0.5 text-[11px] text-dim">{audioParts.join(' \u00b7 ')}</div>}
          </td>
          <td className="px-6 py-4 text-sm text-dim">{svc.channel}</td>
          <td className="px-6 py-4 max-w-[280px]"><span className="block truncate text-xs text-dim font-mono">{svc.webhook}</span></td>
          <td className="px-6 py-4 text-xs text-dim">{svc.code || svc.command || '\u2014'}</td>
          <td className="px-6 py-4 text-right whitespace-nowrap space-x-1">
            <button onClick={() => setAudioTarget(showAudio ? null : name)} className="px-3 py-1 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/5 transition-colors">Audio</button>
            <button onClick={() => setEditing(true)} className="px-3 py-1 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/5 transition-colors">Edit</button>
            <button onClick={remove} className="px-3 py-1 text-xs font-medium text-red border border-red/30 rounded hover:bg-red-light transition-colors">Remove</button>
          </td>
        </tr>
      )}
      {showAudio && (
        <AudioSettingsRow name={name} svc={svc} settings={settings} onClose={() => setAudioTarget(null)} loadConfig={loadConfig} />
      )}
    </>
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
      {/* Services Table */}
      <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-bg-light border-b border-border">
                <th className="px-6 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Channel</th>
                <th className="px-6 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Webhook</th>
                <th className="px-6 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Code / Command</th>
                <th className="px-6 py-3 text-[11px] font-bold text-dim uppercase tracking-wider w-[190px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {svcEntries.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-dim py-8 text-sm">No services configured</td></tr>
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
      </div>

      {/* Add Service Form */}
      <div className="bg-surface border border-border rounded-xl p-5 shadow-sm mt-4">
        <h3 className="text-sm font-semibold text-text mb-1">Add Service</h3>
        {step === 'pick' ? (
          <div>
            <p className="text-xs text-dim mb-4">Choose which channel this service will use.</p>
            {channelNames.length === 0 ? (
              <p className="text-sm text-dim text-center py-5">No channels configured yet. Add a channel first.</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
                {channelNames.map(name => {
                  const ch = channels[name];
                  const icon = channelIcons[ch.type] || null;
                  const detail = ch.number || ch.from_email || (ch.bot_token ? ch.bot_token.slice(0, 12) + '\u2026' : '');
                  return (
                    <div
                      key={name}
                      onClick={() => selectChannel(name)}
                      className="flex flex-col items-center gap-2 p-4 bg-bg-light border-2 border-border rounded-xl cursor-pointer transition-all hover:border-primary hover:bg-highlight text-center"
                    >
                      <div className="w-8 h-8 flex items-center justify-center text-[28px]">{icon}</div>
                      <div className="text-sm font-medium text-text">{name}</div>
                      <div className="text-[11px] text-dim leading-tight">{ch.type}{detail ? ' \u00b7 ' + detail : ''}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div>
            <button onClick={backToPicker} className="flex items-center gap-1 text-sm text-primary hover:underline mb-3 bg-transparent border-none cursor-pointer p-0">
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back to channels
            </button>
            <p className="text-xs text-dim mb-3">Add a service for channel "{selectedChannel}"{channels[selectedChannel]?.type ? ` (${channels[selectedChannel].type.charAt(0).toUpperCase() + channels[selectedChannel].type.slice(1)})` : ''}.</p>
            <div className="flex gap-3 flex-wrap mb-3">
              <input value={svcName} onChange={e => setSvcName(e.target.value)} placeholder="Service name (e.g. support)" className={inputCls + ' flex-1 min-w-[140px]'} autoFocus />
              <input value={svcWebhook} onChange={e => setSvcWebhook(e.target.value)} placeholder="Webhook URL (e.g. http://localhost:3000/support)" className={inputCls + ' flex-1 min-w-[140px]'} />
            </div>
            {!isServiceMode && (
              <div className="flex gap-3 flex-wrap mb-3">
                <input value={svcCode} onChange={e => setSvcCode(e.target.value)} placeholder="Magic code — WhatsApp multi-service (optional)" className={inputCls + ' flex-1 min-w-[140px]'} />
                <input value={svcCommand} onChange={e => setSvcCommand(e.target.value)} placeholder="Slash command — Telegram, e.g. /support (optional)" className={inputCls + ' flex-1 min-w-[140px]'} />
              </div>
            )}
            <div className="flex items-center gap-3">
              <button onClick={addService} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover transition-colors">Add Service</button>
              {isServiceMode && <span className="text-xs text-dim">Service mode — no code or command needed.</span>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
