import { useState, useEffect } from 'react';
import { API, apiFetch, getToken } from '../api.js';

function phoneToJid(phone) {
  return phone.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
}

export default function SendModal({ onClose }) {
  const [channels, setChannels] = useState([]);
  const [channel, setChannel] = useState('');
  const [phone, setPhone] = useState('');
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [statusColor, setStatusColor] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    apiFetch(API + '/api/config')
      .then(r => r.json())
      .then(data => {
        const waChannels = Object.entries(data.channels)
          .filter(([, cfg]) => cfg.type === 'whatsapp')
          .map(([name]) => name);
        setChannels(waChannels);
        if (waChannels.length > 0) setChannel(waChannels[0]);
      })
      .catch(() => {});
  }, []);

  async function send() {
    if (!channel) { setStatus('Select a channel'); setStatusColor('text-red'); return; }
    if (!phone) { setStatus('Enter a phone number'); setStatusColor('text-red'); return; }
    if (!text) { setStatus('Enter a message'); setStatusColor('text-red'); return; }

    setSending(true);
    setStatus('Sending...');
    setStatusColor('text-dim');

    const jid = phoneToJid(phone);

    try {
      const res = await apiFetch(API + '/api/send/' + encodeURIComponent(channel) + '/' + encodeURIComponent(jid), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('Message sent!');
        setStatusColor('text-green');
        setText('');
      } else {
        setStatus(data.error || 'Failed to send');
        setStatusColor('text-red');
      }
    } catch (e) {
      setStatus('Error: ' + e.message);
      setStatusColor('text-red');
    } finally {
      setSending(false);
    }
  }

  const jid = phoneToJid(phone || '+972501234567');
  const token = getToken();
  const curlExample = `curl -X POST ${API}/api/send/${channel || 'whatsapp'}/${encodeURIComponent(jid)} \\
  -H "Content-Type: application/json" \\${token ? `\n  -H "Authorization: Bearer <your_api_secret>" \\` : ''}
  -d '{"text": "Hello from the API!"}'`;
  const jsExample = `await fetch("${API}/api/send/${channel || 'whatsapp'}/${encodeURIComponent(jid)}", {
  method: "POST",
  headers: {${token ? `\n    "Authorization": "Bearer <your_api_secret>",` : ''}
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ text: "Hello from the API!" })
});`;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-surface rounded-xl p-7 max-w-lg w-[90%] shadow-2xl">
        <h3 className="text-base font-semibold text-text mb-4">Send WhatsApp Message</h3>

        <label className="block text-[11px] font-semibold text-dim uppercase tracking-wider mb-1">Channel</label>
        <select
          value={channel}
          onChange={e => setChannel(e.target.value)}
          className="w-full mb-3 py-2 px-3 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary"
        >
          {channels.length === 0 && <option value="">No WhatsApp channels</option>}
          {channels.map(name => <option key={name} value={name}>{name}</option>)}
        </select>

        <label className="block text-[11px] font-semibold text-dim uppercase tracking-wider mb-1">Phone number</label>
        <input
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="+972501234567"
          autoFocus
          className="w-full mb-3 py-2 px-3 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary"
        />

        <label className="block text-[11px] font-semibold text-dim uppercase tracking-wider mb-1">Message</label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Type your message..."
          className="w-full mb-4 py-2 px-3 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary resize-y min-h-[80px]"
        />

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border rounded-lg text-sm text-dim hover:bg-bg-light transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={sending}
            className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            Send
          </button>
        </div>

        {status && <div className={`text-xs mt-3 min-h-[18px] ${statusColor}`}>{status}</div>}

        <div className="mt-4 border-t border-border pt-3">
          <details>
            <summary className="text-xs text-dim font-semibold cursor-pointer">API Examples</summary>
            <h4 className="text-[11px] font-semibold text-dim mt-3 mb-1">cURL</h4>
            <pre className="bg-bg-light border border-border rounded-lg p-3 text-[11px] overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
              <code className="font-mono">{curlExample}</code>
            </pre>
            <h4 className="text-[11px] font-semibold text-dim mt-3 mb-1">JavaScript</h4>
            <pre className="bg-bg-light border border-border rounded-lg p-3 text-[11px] overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
              <code className="font-mono">{jsExample}</code>
            </pre>
            <p className="text-[11px] text-dim mt-2">
              JID format: strip non-digits from phone number, append <code className="bg-bg-light px-1 py-0.5 rounded font-mono">@s.whatsapp.net</code>
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}
