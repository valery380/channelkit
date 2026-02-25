import { useState, useEffect } from 'react';
import { API } from '../api.js';

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
  const [apiSecret, setApiSecret] = useState(null);

  useEffect(() => {
    fetch(API + '/api/config')
      .then(r => r.json())
      .then(data => {
        setApiSecret(data.api_secret || null);
        const waChannels = Object.entries(data.channels)
          .filter(([, cfg]) => cfg.type === 'whatsapp')
          .map(([name]) => name);
        setChannels(waChannels);
        if (waChannels.length > 0) setChannel(waChannels[0]);
      })
      .catch(() => {});
  }, []);

  async function send() {
    if (!channel) { setStatus('Select a channel'); setStatusColor('var(--red)'); return; }
    if (!phone) { setStatus('Enter a phone number'); setStatusColor('var(--red)'); return; }
    if (!text) { setStatus('Enter a message'); setStatusColor('var(--red)'); return; }

    setSending(true);
    setStatus('Sending...');
    setStatusColor('var(--dim)');

    const jid = phoneToJid(phone);
    const headers = { 'Content-Type': 'application/json' };
    if (apiSecret) headers['Authorization'] = 'Bearer ' + apiSecret;

    try {
      const res = await fetch(API + '/api/send/' + encodeURIComponent(channel) + '/' + encodeURIComponent(jid), {
        method: 'POST', headers, body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('Message sent!');
        setStatusColor('var(--green)');
        setText('');
      } else {
        setStatus(data.error || 'Failed to send');
        setStatusColor('var(--red)');
      }
    } catch (e) {
      setStatus('Error: ' + e.message);
      setStatusColor('var(--red)');
    } finally {
      setSending(false);
    }
  }

  const jid = phoneToJid(phone || '+972542688963');
  const curlExample = `curl -X POST ${API}/api/send/${channel || 'whatsapp'}/${encodeURIComponent(jid)} \\
  -H "Content-Type: application/json" \\${apiSecret ? `\n  -H "Authorization: Bearer ${apiSecret}" \\` : ''}
  -d '{"text": "Hello from the API!"}'`;
  const jsExample = `await fetch("${API}/api/send/${channel || 'whatsapp'}/${encodeURIComponent(jid)}", {
  method: "POST",
  headers: {${apiSecret ? `\n    "Authorization": "Bearer ${apiSecret}",` : ''}
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ text: "Hello from the API!" })
});`;

  return (
    <div className="send-overlay open" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="send-modal">
        <h3>Send WhatsApp Message</h3>
        <label>Channel</label>
        <select value={channel} onChange={e => setChannel(e.target.value)}>
          {channels.length === 0 && <option value="">No WhatsApp channels</option>}
          {channels.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <label>Phone number</label>
        <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+972542688963" autoFocus />
        <label>Message</label>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Type your message..." />
        <div className="send-actions">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-send" onClick={send} disabled={sending}>Send</button>
        </div>
        {status && <div className="send-status" style={{ color: statusColor }}>{status}</div>}
        <div className="api-examples">
          <details>
            <summary>API Examples</summary>
            <h4>cURL</h4>
            <pre><code>{curlExample}</code></pre>
            <h4>JavaScript</h4>
            <pre><code>{jsExample}</code></pre>
            <p style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8 }}>
              JID format: strip non-digits from phone number, append <code>@s.whatsapp.net</code>
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}
