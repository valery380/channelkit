import { useState, useEffect, useRef } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API } from '../api.js';
import { channelIcons, maskValue } from '../utils.jsx';

const inputCls = 'w-full py-2 px-3 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary';
const selectCls = 'py-2 px-3 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary';

const modelsByProvider = {
  openai: ['gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o4-mini'],
  anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250514', 'claude-opus-4-20250514'],
  google: ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-3.1-pro', 'gemini-2.0-flash-lite'],
};

function ModelCombobox({ value, onChange, provider }) {
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const suggestions = (modelsByProvider[provider] || []).filter(
    m => !value || m.toLowerCase().includes(value.toLowerCase())
  );

  useEffect(() => { setHighlightIdx(-1); }, [value, provider]);

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (highlightIdx >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIdx];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIdx]);

  function handleKeyDown(e) {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' && highlightIdx >= 0) {
      e.preventDefault();
      onChange(suggestions[highlightIdx]);
      setOpen(false);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Model (optional, e.g. gpt-4o-mini)"
        className={inputCls}
      />
      {open && suggestions.length > 0 && (
        <ul ref={listRef} className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-surface border border-border rounded-lg shadow-lg py-1">
          {suggestions.map((m, i) => (
            <li
              key={m}
              onMouseDown={() => { onChange(m); setOpen(false); }}
              onMouseEnter={() => setHighlightIdx(i)}
              className={`px-3 py-1.5 text-sm cursor-pointer ${i === highlightIdx ? 'bg-primary/10 text-primary' : 'text-text hover:bg-bg-light'}`}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
const formatProviderMap = {
  openai: { label: 'OpenAI', key: 'openai_api_key' },
  anthropic: { label: 'Anthropic (Claude)', key: 'anthropic_api_key' },
  google: { label: 'Google (Gemini)', key: 'google_api_key' },
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
        body: JSON.stringify({ webhook: svc.webhook, method: svc.method || 'POST', auth: svc.auth || null, code: svc.code || null, command: svc.command || null, stt: sttVal, tts: ttsVal, format: svc.format || null }),
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

function FormatSettingsRow({ name, svc, settings, onClose, loadConfig }) {
  const fmt = svc.format || {};
  const [provider, setProvider] = useState(fmt.provider || '');
  const [model, setModel] = useState(fmt.model || '');
  const [prompt, setPrompt] = useState(fmt.prompt || '');
  const [status, setStatus] = useState('');

  async function save() {
    const formatVal = provider ? { provider, ...(model && { model }), prompt } : null;
    try {
      const res = await fetch(API + '/api/config/services/' + encodeURIComponent(name), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook: svc.webhook, method: svc.method || 'POST', auth: svc.auth || null, code: svc.code || null, command: svc.command || null,
          stt: svc.stt || null, tts: svc.tts || null, format: formatVal,
        }),
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
          <div className="text-sm font-semibold text-text">AI Format Settings &mdash; {name}</div>
          <div className="text-xs text-dim">Run an AI model on incoming messages to transform or extract data before sending to the webhook.</div>
          <ProviderSelect map={formatProviderMap} value={provider} onChange={setProvider} settings={settings} />
          {provider && (
            <div className="space-y-2">
              <ModelCombobox value={model} onChange={setModel} provider={provider} />
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Prompt: instructions for how to format the message (e.g. Extract name and amount. Return JSON.)" rows={3} className={inputCls + ' resize-y'} />
            </div>
          )}
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

function ExampleModal({ channelName, channelConfig, onClose }) {
  const { tunnelActive, tunnelUrl } = useAppState();
  const [tab, setTab] = useState('curl');
  const [usePublicUrl, setUsePublicUrl] = useState(false);
  const [copied, setCopied] = useState(false);
  const method = (channelConfig.method || 'POST').toUpperCase();
  const baseUrl = usePublicUrl && tunnelUrl ? tunnelUrl.replace(/\/$/, '') : window.location.origin;
  const url = `${baseUrl}/inbound/endpoint/${encodeURIComponent(channelName)}`;
  const secret = channelConfig.secret || '';
  const isGet = method === 'GET';

  const curlUrl = isGet ? `${url}?text=Hello+from+cURL` : url;
  const curlParts = [`curl -X ${method} "${curlUrl}"`, `  -H "Content-Type: application/json"`];
  if (secret) curlParts.push(`  -H "X-Channel-Secret: ${secret}"`);
  if (!isGet) curlParts.push(`  -d '{"text": "Hello from cURL"}'`);
  const curlExample = curlParts.join(' \\\n');

  const jsHeaders = [`    "Content-Type": "application/json"`, ...(secret ? [`    "X-Channel-Secret": "${secret}"`] : [])].join(',\n');
  const jsBody = isGet ? '' : `,\n  body: JSON.stringify({ text: "Hello from Node.js" })`;
  const jsUrl = isGet ? `${url}?text=Hello+from+Node.js` : url;
  const jsExample = `const response = await fetch("${jsUrl}", {
  method: "${method}",
  headers: {
${jsHeaders}
  }${jsBody}
});
const data = await response.json();`;

  const pyHeaders = [`        "Content-Type": "application/json"`, ...(secret ? [`        "X-Channel-Secret": "${secret}"`] : [])].join(',\n');
  const pyMethod = method.toLowerCase();
  const pyBody = isGet ? `\n    params={"text": "Hello from Python"},` : `\n    json={"text": "Hello from Python"},`;
  const pyExample = `import requests

response = requests.${pyMethod}(
    "${url}",${pyBody}
    headers={
${pyHeaders},
    },
)
data = response.json()`;

  const tabs = [
    { id: 'curl', label: 'cURL' },
    { id: 'node', label: 'Node.js' },
    { id: 'python', label: 'Python' },
  ];
  const examples = { curl: curlExample, node: jsExample, python: pyExample };

  function copyToClipboard() {
    navigator.clipboard.writeText(examples[tab]).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface rounded-xl p-7 max-w-lg w-[90%] shadow-2xl">
        <h3 className="text-base font-semibold text-text mb-1">Endpoint Example</h3>
        <p className="text-xs text-dim mb-4">
          {method} <span className="font-mono">/inbound/endpoint/{channelName}</span>
          {channelConfig.response_mode === 'async' && <span className="ml-2 text-yellow">(async)</span>}
        </p>

        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${tab === t.id ? 'bg-primary text-white' : 'text-dim hover:bg-bg-light border border-border'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-dim border border-border rounded-lg hover:bg-bg-light transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">{copied ? 'check' : 'content_copy'}</span>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <pre className="bg-bg-light border border-border rounded-lg p-3 text-[11px] overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
          <code className="font-mono">{examples[tab]}</code>
        </pre>

        <div className="flex items-center justify-between mt-4">
          <div>
            {tunnelActive && tunnelUrl && (
              <label className="flex items-center gap-2 text-xs text-dim cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={usePublicUrl}
                  onChange={e => setUsePublicUrl(e.target.checked)}
                  className="accent-primary"
                />
                Use public URL
              </label>
            )}
          </div>
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm text-dim hover:bg-bg-light transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

function ServiceRowWithAudio({ name, svc, loadConfig, settings, audioTarget, setAudioTarget, formatTarget, setFormatTarget, channels }) {
  const [editing, setEditing] = useState(false);
  const [webhook, setWebhook] = useState(svc.webhook);
  const [code, setCode] = useState(svc.code || '');
  const [command, setCommand] = useState(svc.command || '');
  const [webhookMethod, setWebhookMethod] = useState(svc.method || 'POST');
  const [authType, setAuthType] = useState(svc.auth?.type || '');
  const [authToken, setAuthToken] = useState(svc.auth?.token || '');
  const [authHeaderName, setAuthHeaderName] = useState(svc.auth?.header_name || '');
  const [authHeaderValue, setAuthHeaderValue] = useState(svc.auth?.header_value || '');
  const [editAllowListEnabled, setEditAllowListEnabled] = useState(!!(svc.allow_list?.length));
  const [editAllowListText, setEditAllowListText] = useState((svc.allow_list || []).join(', '));
  const [showExample, setShowExample] = useState(false);
  const showAudio = audioTarget === name;
  const isEndpoint = channels[svc.channel]?.type === 'endpoint';
  const isPhoneChannel = ['whatsapp', 'sms', 'voice'].includes(channels[svc.channel]?.type);

  function buildAuthPayload() {
    if (authType === 'bearer' && authToken) return { type: 'bearer', token: authToken };
    if (authType === 'header' && authHeaderName && authHeaderValue) return { type: 'header', header_name: authHeaderName, header_value: authHeaderValue };
    return null;
  }

  async function save() {
    if (!webhook) { alert('Webhook URL is required'); return; }
    const allowList = editAllowListEnabled && editAllowListText.trim()
      ? editAllowListText.split(',').map(n => n.trim()).filter(Boolean)
      : [];
    const res = await fetch(API + '/api/config/services/' + encodeURIComponent(name), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook, method: webhookMethod, auth: buildAuthPayload(), code: code || null, command: command || null, stt: svc.stt || null, tts: svc.tts || null, format: svc.format || null, allow_list: allowList.length > 0 ? allowList : null }),
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

  const showFormat = formatTarget === name;

  const infoParts = [];
  if (svc.stt) infoParts.push('STT: ' + svc.stt.provider + (svc.stt.language ? ' (' + svc.stt.language + ')' : ''));
  if (svc.tts) infoParts.push('TTS: ' + svc.tts.provider + (svc.tts.language ? ' (' + svc.tts.language + ')' : ''));
  if (svc.format) infoParts.push('Format: ' + svc.format.provider);
  if (svc.allow_list?.length) infoParts.push(svc.allow_list.length + ' allowed');

  return (
    <>
      {editing ? (
        <tr className="hover:bg-bg-light transition-colors">
          <td className="px-6 py-4 font-medium text-sm text-text">{name}</td>
          <td className="px-6 py-4 text-sm text-dim">{svc.channel}</td>
          <td className="px-6 py-4 space-y-1">
            <div className="flex gap-2">
              <select value={webhookMethod} onChange={e => setWebhookMethod(e.target.value)} className={selectCls + ' w-[90px] shrink-0'}>
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
              </select>
              <input value={webhook} onChange={e => setWebhook(e.target.value)} placeholder="Webhook URL" className={inputCls} autoFocus />
            </div>
            <div className="space-y-1 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-dim whitespace-nowrap">Auth:</span>
                <select value={authType} onChange={e => { setAuthType(e.target.value); }} className={selectCls + ' flex-1 text-xs'}>
                  <option value="">None</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="header">Custom Header</option>
                </select>
              </div>
              {authType === 'bearer' && (
                <input value={authToken} onChange={e => setAuthToken(e.target.value)} placeholder="Bearer token" className={inputCls + ' text-xs'} />
              )}
              {authType === 'header' && (
                <div className="flex gap-2">
                  <input value={authHeaderName} onChange={e => setAuthHeaderName(e.target.value)} placeholder="Header name (e.g. X-API-Key)" className={inputCls + ' flex-1 text-xs'} />
                  <input value={authHeaderValue} onChange={e => setAuthHeaderValue(e.target.value)} placeholder="Header value" className={inputCls + ' flex-1 text-xs'} />
                </div>
              )}
            </div>
          </td>
          <td className="px-6 py-4 space-y-1">
            <input value={code} onChange={e => setCode(e.target.value)} placeholder="Magic code" className={inputCls} />
            <input value={command} onChange={e => setCommand(e.target.value)} placeholder="Slash command" className={inputCls} />
            {isPhoneChannel && (
              <div className="space-y-1 pt-1">
                <label className="flex items-center gap-2 text-xs text-text cursor-pointer select-none">
                  <input type="checkbox" checked={editAllowListEnabled} onChange={e => setEditAllowListEnabled(e.target.checked)} className="accent-primary" />
                  Allow list
                </label>
                {editAllowListEnabled && (
                  <textarea
                    value={editAllowListText}
                    onChange={e => setEditAllowListText(e.target.value)}
                    placeholder="+972541234567, +12025551234"
                    rows={2}
                    className={inputCls + ' resize-y text-xs'}
                  />
                )}
              </div>
            )}
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
            {infoParts.length > 0 && <div className="mt-0.5 text-[11px] text-dim">{infoParts.join(' \u00b7 ')}</div>}
          </td>
          <td className="px-6 py-4 text-sm text-dim">{svc.channel}</td>
          <td className="px-6 py-4 max-w-[280px]">
            <div className="flex items-center gap-1.5">
              {svc.method && svc.method !== 'POST' && <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded bg-primary/10 text-primary">{svc.method}</span>}
              {svc.auth && <span className="shrink-0 material-symbols-outlined text-[14px] text-dim" title={svc.auth.type === 'bearer' ? 'Bearer token' : svc.auth.header_name}>lock</span>}
              <span className="block truncate text-xs text-dim font-mono">{svc.webhook}</span>
            </div>
          </td>
          <td className="px-6 py-4 text-xs text-dim">{svc.code || svc.command || '\u2014'}</td>
          <td className="px-6 py-4 text-right whitespace-nowrap space-x-1">
            {isEndpoint && <button onClick={() => setShowExample(true)} className="px-3 py-1 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/5 transition-colors">Example</button>}
            <button onClick={() => { setAudioTarget(showAudio ? null : name); setFormatTarget(null); }} className="px-3 py-1 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/5 transition-colors">Audio</button>
            <button onClick={() => { setFormatTarget(showFormat ? null : name); setAudioTarget(null); }} className="px-3 py-1 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/5 transition-colors">Format</button>
            <button onClick={() => setEditing(true)} className="px-3 py-1 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/5 transition-colors">Edit</button>
            <button onClick={remove} className="px-3 py-1 text-xs font-medium text-red border border-red/30 rounded hover:bg-red-light transition-colors">Remove</button>
          </td>
        </tr>
      )}
      {showAudio && (
        <AudioSettingsRow name={name} svc={svc} settings={settings} onClose={() => setAudioTarget(null)} loadConfig={loadConfig} />
      )}
      {showFormat && (
        <FormatSettingsRow name={name} svc={svc} settings={settings} onClose={() => setFormatTarget(null)} loadConfig={loadConfig} />
      )}
      {showExample && isEndpoint && (
        <ExampleModal channelName={svc.channel} channelConfig={channels[svc.channel]} onClose={() => setShowExample(false)} />
      )}
    </>
  );
}

export default function Services({ loadConfig }) {
  const { services, channels, settings } = useAppState();
  const dispatch = useDispatch();
  const [audioTarget, setAudioTarget] = useState(null);
  const [formatTarget, setFormatTarget] = useState(null);
  const [step, setStep] = useState('pick');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [svcName, setSvcName] = useState('');
  const [svcWebhook, setSvcWebhook] = useState('');
  const [svcMethod, setSvcMethod] = useState('POST');
  const [svcAuthType, setSvcAuthType] = useState('');
  const [svcAuthToken, setSvcAuthToken] = useState('');
  const [svcAuthHeaderName, setSvcAuthHeaderName] = useState('');
  const [svcAuthHeaderValue, setSvcAuthHeaderValue] = useState('');
  const [svcCode, setSvcCode] = useState('');
  const [svcCommand, setSvcCommand] = useState('');
  const [svcAllowListEnabled, setSvcAllowListEnabled] = useState(false);
  const [svcAllowListText, setSvcAllowListText] = useState('');

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
    setSvcMethod('POST');
    setSvcAuthType('');
    setSvcAuthToken('');
    setSvcAuthHeaderName('');
    setSvcAuthHeaderValue('');
    setSvcCode('');
    setSvcCommand('');
    setSvcAllowListEnabled(false);
    setSvcAllowListText('');
  }

  function buildSvcAuthPayload() {
    if (svcAuthType === 'bearer' && svcAuthToken) return { type: 'bearer', token: svcAuthToken };
    if (svcAuthType === 'header' && svcAuthHeaderName && svcAuthHeaderValue) return { type: 'header', header_name: svcAuthHeaderName, header_value: svcAuthHeaderValue };
    return null;
  }

  async function addService() {
    if (!svcName || !selectedChannel || !svcWebhook) { alert('Name, channel and webhook URL are required'); return; }
    const allowList = svcAllowListEnabled && svcAllowListText.trim()
      ? svcAllowListText.split(',').map(n => n.trim()).filter(Boolean)
      : undefined;
    const authPayload = buildSvcAuthPayload();
    const res = await fetch(API + '/api/config/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: svcName, channel: selectedChannel, webhook: svcWebhook,
        method: svcMethod,
        ...(authPayload && { auth: authPayload }),
        ...(svcCode && { code: svcCode }),
        ...(svcCommand && { command: svcCommand }),
        ...(allowList && { allow_list: allowList }),
      }),
    });
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed to add service'); return; }
    backToPicker();
    loadConfig();
  }

  const isServiceMode = channels[selectedChannel]?.mode === 'service';
  const svcEntries = Object.entries(services);
  const channelNames = Object.keys(channels);
  const occupiedServiceChannels = new Set(
    channelNames.filter(name =>
      channels[name]?.mode === 'service' &&
      svcEntries.some(([, svc]) => svc.channel === name)
    )
  );

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
                  formatTarget={formatTarget}
                  setFormatTarget={setFormatTarget}
                  channels={channels}
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
                  const occupied = occupiedServiceChannels.has(name);
                  return (
                    <div
                      key={name}
                      onClick={occupied ? undefined : () => selectChannel(name)}
                      className={`flex flex-col items-center gap-2 p-4 bg-bg-light border-2 border-border rounded-xl transition-all text-center ${occupied ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary hover:bg-highlight'}`}
                    >
                      <div className="w-8 h-8 flex items-center justify-center text-[28px]">{icon}</div>
                      <div className="text-sm font-medium text-text">{name}</div>
                      <div className="text-[11px] text-dim leading-tight w-full truncate">{ch.type}{detail ? ' \u00b7 ' + detail : ''}</div>
                      {occupied && <div className="text-[10px] text-dim leading-tight">Service mode · already in use</div>}
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
              <div className="flex gap-2 flex-1 min-w-[140px]">
                <select value={svcMethod} onChange={e => setSvcMethod(e.target.value)} className={selectCls + ' w-[90px] shrink-0'}>
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                </select>
                <input value={svcWebhook} onChange={e => setSvcWebhook(e.target.value)} placeholder="Webhook URL (e.g. http://localhost:3000/support)" className={inputCls + ' flex-1'} />
              </div>
            </div>
            <div className="flex gap-3 flex-wrap items-start mb-3">
              <div className="flex items-center gap-2 min-w-[140px]">
                <span className="text-xs text-dim whitespace-nowrap">Auth:</span>
                <select value={svcAuthType} onChange={e => setSvcAuthType(e.target.value)} className={selectCls + ' text-xs'}>
                  <option value="">None</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="header">Custom Header</option>
                </select>
              </div>
              {svcAuthType === 'bearer' && (
                <input value={svcAuthToken} onChange={e => setSvcAuthToken(e.target.value)} placeholder="Bearer token" className={inputCls + ' flex-1 min-w-[140px] text-xs'} />
              )}
              {svcAuthType === 'header' && (
                <>
                  <input value={svcAuthHeaderName} onChange={e => setSvcAuthHeaderName(e.target.value)} placeholder="Header name (e.g. X-API-Key)" className={inputCls + ' flex-1 min-w-[140px] text-xs'} />
                  <input value={svcAuthHeaderValue} onChange={e => setSvcAuthHeaderValue(e.target.value)} placeholder="Header value" className={inputCls + ' flex-1 min-w-[140px] text-xs'} />
                </>
              )}
            </div>
            {!isServiceMode && (
              <div className="flex gap-3 flex-wrap mb-3">
                <input value={svcCode} onChange={e => setSvcCode(e.target.value)} placeholder="Magic code — WhatsApp multi-service (optional)" className={inputCls + ' flex-1 min-w-[140px]'} />
                <input value={svcCommand} onChange={e => setSvcCommand(e.target.value)} placeholder="Slash command — Telegram, e.g. /support (optional)" className={inputCls + ' flex-1 min-w-[140px]'} />
              </div>
            )}
            {['whatsapp', 'sms', 'voice'].includes(channels[selectedChannel]?.type) && (
              <div className="space-y-2 mb-3">
                <label className="flex items-center gap-2 text-sm text-text cursor-pointer select-none">
                  <input type="checkbox" checked={svcAllowListEnabled} onChange={e => setSvcAllowListEnabled(e.target.checked)} className="accent-primary" />
                  Restrict to specific numbers (allow list)
                </label>
                {svcAllowListEnabled && (
                  <textarea
                    value={svcAllowListText}
                    onChange={e => setSvcAllowListText(e.target.value)}
                    placeholder="Comma-separated phone numbers, e.g. +972541234567, +12025551234"
                    rows={2}
                    className={inputCls + ' resize-y'}
                  />
                )}
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
