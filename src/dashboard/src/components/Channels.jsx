import React, { useState, useEffect, useRef } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API, apiFetch } from '../api.js';
import { channelIcons, maskValue, IconBtn } from '../utils.jsx';

const inputCls = 'w-full py-2 px-3 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary';
const selectCls = 'w-full py-2 px-3 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary';

const CHANNEL_FIELDS = {
  whatsapp: { note: "After adding, you'll pair via QR code. Optionally buy a Twilio number below.", fields: [{ key: 'number', label: 'Phone Number (optional)', placeholder: '+12025551234' }] },
  telegram: { note: 'Create a bot at @BotFather and paste the token here.', fields: [{ key: 'bot_token', label: 'Bot Token', placeholder: '123456:ABC-DEF1234...' }] },
  'sms-twilio': { note: 'Twilio console: Account SID and Auth Token from the dashboard.', fields: [{ key: 'account_sid', label: 'Account SID', placeholder: 'ACxxxxxxx' }, { key: 'auth_token', label: 'Auth Token', placeholder: '' }, { key: 'number', label: 'Phone Number', placeholder: '+12025551234' }] },
  'voice-twilio': { note: 'Same credentials as SMS. Voice and SMS can share credentials but need separate channels.', fields: [{ key: 'account_sid', label: 'Account SID', placeholder: 'ACxxxxxxx' }, { key: 'auth_token', label: 'Auth Token', placeholder: '' }, { key: 'number', label: 'Phone Number', placeholder: '+12025551234' }] },
  'email-gmail': { note: 'Create OAuth2 credentials (Desktop app) at console.cloud.google.com/apis/credentials. Enable the Gmail API.', fields: [{ key: 'client_id', label: 'OAuth Client ID', placeholder: 'xxxx.apps.googleusercontent.com' }, { key: 'client_secret', label: 'OAuth Client Secret', placeholder: '' }] },
  'email-resend': { note: 'Get your API key from resend.com.', fields: [{ key: 'api_key', label: 'API Key', placeholder: 're_xxxxxxx' }, { key: 'from_email', label: 'From Email', placeholder: 'support@yourdomain.com' }] },
  'endpoint': { note: 'Expose a URL that external systems can call.', fields: [{ key: 'method', label: 'HTTP Method', placeholder: 'POST' }, { key: 'secret', label: 'Secret Key (optional)', placeholder: 'A secret for X-Channel-Secret header' }] },
};

const TYPE_LABELS = { whatsapp: 'WhatsApp', telegram: 'Telegram', 'sms-twilio': 'SMS (Twilio)', 'voice-twilio': 'Voice (Twilio)', 'email-gmail': 'Email (Gmail)', 'email-resend': 'Email (Resend)', 'endpoint': 'Endpoint (Webhook)' };

const COUNTRIES = [
  { code: 'US', label: 'United States (+1)' }, { code: 'GB', label: 'United Kingdom (+44)' },
  { code: 'CA', label: 'Canada (+1)' }, { code: 'AU', label: 'Australia (+61)' },
  { code: 'DE', label: 'Germany (+49)' }, { code: 'FR', label: 'France (+33)' },
  { code: 'IL', label: 'Israel (+972)' }, { code: 'NL', label: 'Netherlands (+31)' },
  { code: 'SE', label: 'Sweden (+46)' }, { code: 'ES', label: 'Spain (+34)' },
  { code: 'IT', label: 'Italy (+39)' }, { code: 'BR', label: 'Brazil (+55)' },
  { code: 'JP', label: 'Japan (+81)' }, { code: 'IN', label: 'India (+91)' },
  { code: 'PL', label: 'Poland (+48)' },
];

const channelTypeSvgs = {
  whatsapp: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>,
  telegram: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#26A5E4" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>,
  sms: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#6B7280" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/><path fill="#6B7280" d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>,
  voice: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#6B7280" d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>,
  email: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#6B7280" d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>,
  endpoint: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#6B7280" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>,
};

function QRModal({ channel, onClose }) {
  const [timer, setTimer] = useState(60);
  const [status, setStatus] = useState('waiting'); // 'waiting' | 'qr' | 'paired' | 'error'
  const [error, setError] = useState('');
  const [qrData, setQrData] = useState(null);
  const canvasRef = useRef(null);

  // Poll pair-status every second
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await apiFetch(API + '/api/config/channels/' + encodeURIComponent(channel) + '/pair-status');
        const data = await res.json();
        if (!active) return;
        if (data.status === 'paired') { setStatus('paired'); return; }
        if (data.status === 'error') { setStatus('error'); setError(data.error || 'Pairing failed'); return; }
        if (data.qr) { setQrData(data.qr); setStatus('qr'); }
      } catch {}
      if (active) setTimeout(poll, 1000);
    };
    poll();
    return () => { active = false; };
  }, [channel]);

  // Render QR to canvas whenever qrData changes and canvas is available
  useEffect(() => {
    if (!qrData || !canvasRef.current) return;
    import('qrcode').then(QRCode => {
      const toCanvas = QRCode.toCanvas || QRCode.default?.toCanvas;
      if (toCanvas && canvasRef.current) {
        toCanvas(canvasRef.current, qrData, { width: 280, margin: 2 }).catch(() => {});
      }
    }).catch(() => {});
  }, [qrData]);

  // Countdown timer
  useEffect(() => {
    const id = setInterval(() => setTimer(t => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  let body;
  if (status === 'paired') {
    body = (
      <div className="py-10 text-center text-green text-base font-semibold">
        <span className="material-symbols-outlined text-5xl mb-3 block">check_circle</span>
        WhatsApp paired successfully!
        <br /><span className="text-xs font-normal text-dim">Restart the server to start receiving messages.</span>
      </div>
    );
  } else if (status === 'error') {
    body = <div className="py-10 text-center text-red text-sm">{error}</div>;
  } else if (status === 'qr') {
    body = <div className="bg-white rounded-xl p-3 inline-block mb-4"><canvas ref={canvasRef} /></div>;
  } else {
    body = <div className="py-16 text-dim text-sm">Waiting for QR code...</div>;
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-surface rounded-xl p-8 max-w-md w-[90%] text-center shadow-2xl">
        <h3 className="text-base font-semibold mb-1">Pair WhatsApp &mdash; {channel}</h3>
        <div className="text-sm text-dim mb-5">Open WhatsApp &rarr; Settings &rarr; Linked Devices &rarr; Link a Device</div>
        {body}
        {timer > 0 && status !== 'paired' && status !== 'error' && (
          <div className="text-xs text-dim mb-4">{timer}s remaining</div>
        )}
        <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm text-dim hover:bg-bg-light transition-colors">Close</button>
      </div>
    </div>
  );
}

function GmailAuthModal({ channel, qrMessage, onClose }) {
  const [timer, setTimer] = useState(120);
  const intervalRef = useRef(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => setTimer(t => Math.max(0, t - 1)), 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  useEffect(() => {
    if (qrMessage?.type === 'gmail-auth-success' || qrMessage?.type === 'gmail-auth-error') {
      clearInterval(intervalRef.current);
    }
  }, [qrMessage]);

  // Auto-open the auth URL when it arrives
  useEffect(() => {
    if (qrMessage?.type === 'gmail-auth-url' && qrMessage.channel === channel && qrMessage.authUrl) {
      window.open(qrMessage.authUrl, '_blank');
    }
  }, [qrMessage, channel]);

  let body;
  if (qrMessage?.type === 'gmail-auth-success' && qrMessage.channel === channel) {
    body = (
      <div className="py-10 text-center text-green text-base font-semibold">
        <span className="material-symbols-outlined text-5xl mb-3 block">check_circle</span>
        Gmail authenticated successfully!
        <br /><span className="text-xs font-normal text-dim">Restart the server to start receiving emails.</span>
      </div>
    );
  } else if (qrMessage?.type === 'gmail-auth-error' && qrMessage.channel === channel) {
    body = <div className="py-10 text-center text-red text-sm">{qrMessage.error || 'Authentication failed'}</div>;
  } else if (qrMessage?.type === 'gmail-auth-url' && qrMessage.channel === channel) {
    body = (
      <div className="py-6 space-y-4">
        <p className="text-sm text-dim">A browser window should have opened for Google authorization.</p>
        <p className="text-xs text-dim">If it didn't open automatically, click the button below:</p>
        <a href={qrMessage.authUrl} target="_blank" rel="noopener noreferrer"
          className="inline-block px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover transition-colors no-underline">
          Open Google Authorization
        </a>
      </div>
    );
  } else {
    body = <div className="py-16 text-dim text-sm">Starting OAuth flow...</div>;
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-surface rounded-xl p-8 max-w-md w-[90%] text-center shadow-2xl">
        <h3 className="text-base font-semibold mb-1">Gmail OAuth &mdash; {channel}</h3>
        <div className="text-sm text-dim mb-5">Authorize ChannelKit to access your Gmail account</div>
        {body}
        {timer > 0 && qrMessage?.type !== 'gmail-auth-success' && qrMessage?.type !== 'gmail-auth-error' && (
          <div className="text-xs text-dim mb-4">{timer}s remaining</div>
        )}
        <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm text-dim hover:bg-bg-light transition-colors">Close</button>
      </div>
    </div>
  );
}

function SmsListenModal({ number, smsListenMessage, onClose }) {
  const dispatch = useDispatch();
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const [timer, setTimer] = useState(300);
  const intervalRef = useRef(null);
  const stopped = useRef(false);

  useEffect(() => {
    intervalRef.current = setInterval(() => setTimer(t => {
      if (t <= 1) { clearInterval(intervalRef.current); return 0; }
      return t - 1;
    }), 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  useEffect(() => {
    if (!smsListenMessage || smsListenMessage.number !== number) return;
    if (smsListenMessage.type === 'sms-listen') {
      setMessages(prev => {
        const exists = prev.some(m => m.body === smsListenMessage.message.body && m.from === smsListenMessage.message.from && m.date === smsListenMessage.message.date);
        if (exists) return prev;
        return [smsListenMessage.message, ...prev];
      });
    } else if (smsListenMessage.type === 'sms-listen-error') {
      setError(smsListenMessage.error);
      clearInterval(intervalRef.current);
    } else if (smsListenMessage.type === 'sms-listen-stopped') {
      stopped.current = true;
      clearInterval(intervalRef.current);
      setTimer(0);
    }
  }, [smsListenMessage, number]);

  function handleClose() {
    apiFetch(API + '/api/twilio/stop-listen-sms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number }),
    }).catch(() => {});
    dispatch({ type: 'SET_SMS_LISTEN', payload: null });
    onClose();
  }

  const mins = Math.floor(timer / 60);
  const secs = timer % 60;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-surface rounded-xl p-8 max-w-lg w-[90%] shadow-2xl">
        <h3 className="text-base font-semibold mb-1">Listening for SMS</h3>
        <div className="text-sm text-dim mb-4">Messages arriving at <span className="font-mono font-medium text-text">{number}</span></div>

        {error && <div className="p-3 rounded-lg text-xs text-red bg-red-light border border-red/20 mb-4">{error}</div>}

        {messages.length === 0 && !error && timer > 0 && (
          <div className="py-10 text-center text-dim text-sm">
            <div className="inline-block w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-3"></div>
            <div>Waiting for messages...</div>
          </div>
        )}

        {messages.length > 0 && (
          <div className="max-h-60 overflow-y-auto border border-border rounded-lg mb-4 divide-y divide-border/50">
            {messages.map((m, i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-medium text-text">{m.from}</span>
                  <span className="text-[10px] text-dim">{new Date(m.date).toLocaleTimeString()}</span>
                </div>
                <div className="text-sm text-text select-all">{m.body}</div>
              </div>
            ))}
          </div>
        )}

        {timer === 0 && messages.length === 0 && !error && (
          <div className="py-8 text-center text-dim text-sm">Timed out — no messages received.</div>
        )}

        <div className="flex items-center justify-between">
          {timer > 0 && !error && <span className="text-xs text-dim">Auto-stop in {mins}:{secs.toString().padStart(2, '0')}</span>}
          {(timer === 0 || error) && <span></span>}
          <button onClick={handleClose} className="px-4 py-2 border border-border rounded-lg text-sm text-dim hover:bg-bg-light transition-colors">
            {timer > 0 && !error ? 'Stop & Close' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SmsSettingsRow({ name, currentMode, currentInterval, onClose, loadConfig }) {
  const { tunnelActive } = useAppState();
  const [mode, setMode] = useState(currentMode);
  const [interval, setInterv] = useState(currentInterval || 60);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (mode === 'webhook' && !tunnelActive) { alert('Please externalize the service first.'); return; }
    setSaving(true);
    try {
      const res = await apiFetch(API + '/api/config/channels/' + encodeURIComponent(name) + '/sms-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inbound_mode: mode, ...(mode === 'polling' && { poll_interval: parseInt(interval) || 60 }) }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Failed'); setSaving(false); return; }
      onClose();
      loadConfig();
    } catch (e) { alert(e.message); setSaving(false); }
  }

  return (
    <tr>
      <td colSpan={7} className="px-6 py-4">
        <div className="bg-bg-light border border-border rounded-lg p-4 space-y-3">
          <div className="text-sm font-semibold text-text">SMS Inbound Settings</div>
          <select value={mode} onChange={e => setMode(e.target.value)} className={selectCls}>
            <option value="polling">Polling — fetch messages at regular intervals</option>
            <option value="webhook">External Address — receive webhooks from Twilio</option>
          </select>
          {mode === 'polling' && (
            <input type="number" value={interval} onChange={e => setInterv(e.target.value)} min="5" max="3600" placeholder="Poll interval in seconds" className={inputCls} />
          )}
          {mode === 'webhook' && !tunnelActive && (
            <div className="p-3 rounded-lg text-xs bg-yellow-light text-yellow border border-yellow/20">
              Service is not externalized. Please <strong>Externalize</strong> first.
            </div>
          )}
          {mode === 'webhook' && tunnelActive && (
            <div className="p-3 rounded-lg text-xs bg-green-light text-green border border-green/20">
              Twilio will send incoming SMS to your external address.
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={saving} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover transition-colors disabled:opacity-50">{saving ? 'Saving\u2026' : 'Save'}</button>
            <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm text-dim hover:bg-bg-light transition-colors">Cancel</button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function EmailSettingsRow({ name, ch, onClose, loadConfig }) {
  const { tunnelActive } = useAppState();
  const [fromEmail, setFromEmail] = useState(ch.from_email || '');
  const currentMode = ch.poll_interval ? 'polling' : 'webhook';
  const [mode, setMode] = useState(currentMode);
  const [interval, setInterv] = useState(ch.poll_interval || 30);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!fromEmail.trim()) { alert('From email is required'); return; }
    if (mode === 'webhook' && !tunnelActive) { alert('Please externalize the service first.'); return; }
    setSaving(true);
    try {
      const res = await apiFetch(API + '/api/config/channels/' + encodeURIComponent(name) + '/email-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inbound_mode: mode, from_email: fromEmail.trim(), ...(mode === 'polling' && { poll_interval: parseInt(interval) || 30 }) }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Failed'); setSaving(false); return; }
      onClose();
      loadConfig();
    } catch (e) { alert(e.message); setSaving(false); }
  }

  return (
    <tr>
      <td colSpan={7} className="px-6 py-4">
        <div className="bg-bg-light border border-border rounded-lg p-4 space-y-3">
          <div className="text-sm font-semibold text-text">Email Settings &mdash; {name}</div>
          <div className="space-y-1">
            <div className="text-xs font-semibold text-dim">From Email</div>
            <input value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="support@yourdomain.com" className={inputCls} />
            <div className="text-[11px] text-dim">Must be a verified domain in your Resend account.</div>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-semibold text-dim">Inbound Mode</div>
            <select value={mode} onChange={e => setMode(e.target.value)} className={selectCls}>
              <option value="webhook">Webhook &mdash; Resend forwards emails to your endpoint</option>
              <option value="polling">Polling &mdash; fetch emails at regular intervals</option>
            </select>
          </div>
          {mode === 'polling' && (
            <input type="number" value={interval} onChange={e => setInterv(e.target.value)} min="5" max="3600" placeholder="Poll interval in seconds" className={inputCls} />
          )}
          {mode === 'webhook' && !tunnelActive && (
            <div className="p-3 rounded-lg text-xs bg-yellow-light text-yellow border border-yellow/20">
              Service is not externalized. Please <strong>Externalize</strong> first.
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={saving} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover transition-colors disabled:opacity-50">{saving ? 'Saving\u2026' : 'Save'}</button>
            <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm text-dim hover:bg-bg-light transition-colors">Cancel</button>
          </div>
        </div>
      </td>
    </tr>
  );
}

function BuyNumberPanel({ typeKey, fieldValues, onNumberPurchased, onClose }) {
  const { twilioDefaults } = useAppState();
  const isWA = typeKey === 'whatsapp';
  const [buySid, setBuySid] = useState('');
  const [buyTok, setBuyTok] = useState('');
  const [country, setCountry] = useState('US');
  const [numType, setNumType] = useState(typeKey === 'voice-twilio' ? 'local' : 'mobile');
  const [numbers, setNumbers] = useState(null);
  const [error, setError] = useState('');
  const [purchaseError, setPurchaseError] = useState('');
  const [searching, setSearching] = useState(false);

  function getCreds() {
    let sid, tok;
    if (isWA) { sid = buySid.trim(); tok = buyTok.trim(); }
    else { sid = fieldValues.account_sid?.trim(); tok = fieldValues.auth_token?.trim(); }
    if (!sid && twilioDefaults.sid) sid = twilioDefaults.sid;
    if (!tok && twilioDefaults.tok) tok = twilioDefaults.tok;
    return { sid, tok };
  }

  async function search() {
    const { sid, tok } = getCreds();
    if (!sid || !tok) { setError('Account SID and Auth Token are required'); return; }
    setSearching(true); setError('');
    try {
      const res = await apiFetch(API + '/api/twilio/search-numbers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_sid: sid, auth_token: tok, country_code: country, type: numType, limit: 10 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      if (!data.numbers?.length) throw new Error('No numbers available. Try a different country or type.');
      setNumbers(data.numbers);
    } catch (e) { setError(e.message); }
    finally { setSearching(false); }
  }

  async function buy(phoneNumber) {
    if (!confirm('Purchase ' + phoneNumber + ' from Twilio? Your account will be charged.')) return;
    const { sid, tok } = getCreds();
    setPurchaseError('');
    try {
      const res = await apiFetch(API + '/api/twilio/buy-number', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_sid: sid, auth_token: tok, phone_number: phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Purchase failed');
      onNumberPurchased(data.purchased.phoneNumber);
    } catch (e) { setPurchaseError(e.message); }
  }

  return (
    <div className="border border-border rounded-xl p-4 mb-3 bg-surface space-y-3">
      <div className="text-sm font-semibold text-text">Buy a Twilio Number</div>
      {isWA ? (
        <div className="space-y-2">
          <input value={buySid} onChange={e => setBuySid(e.target.value)} placeholder="Account SID — ACxxxxxxx" className={inputCls} />
          <input value={buyTok} onChange={e => setBuyTok(e.target.value)} placeholder="Auth Token" className={inputCls} />
        </div>
      ) : (
        <div className="text-xs text-dim">Using the Account SID and Auth Token above.</div>
      )}
      <div className="flex gap-3 flex-wrap">
        <select value={country} onChange={e => setCountry(e.target.value)} className={selectCls + ' flex-1'}>
          {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
        <select value={numType} onChange={e => setNumType(e.target.value)} className={selectCls}>
          <option value="mobile">Mobile</option>
          <option value="local">Local</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button onClick={search} disabled={searching} className="px-4 py-2 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary-hover transition-colors disabled:opacity-50">{searching ? 'Searching\u2026' : 'Search Numbers'}</button>
        <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-xs text-dim hover:bg-bg-light transition-colors">Cancel</button>
      </div>
      {error && <div className="p-3 rounded-lg text-xs text-red bg-red-light border border-red/20">{error}</div>}
      {numbers && (
        <div>
          <div className="text-xs font-semibold text-text mb-2">Available Numbers</div>
          <div className="max-h-60 overflow-y-auto border border-border rounded-lg">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-bg-light">
                  <th className="px-3 py-2 text-[10px] font-bold text-dim uppercase">Number</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-dim uppercase">Location</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-dim uppercase">Capabilities</th>
                  <th className="px-3 py-2 text-[10px] font-bold text-dim uppercase">Price</th>
                  <th className="px-3 py-2 w-[50px]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {numbers.map(n => (
                  <tr key={n.phoneNumber} className="hover:bg-bg-light transition-colors">
                    <td className="px-3 py-2 font-mono text-xs font-medium">{n.phoneNumber}</td>
                    <td className="px-3 py-2 text-[11px] text-dim">{[n.locality, n.region].filter(Boolean).join(', ') || n.isoCountry}</td>
                    <td className="px-3 py-2 space-x-1">
                      {n.capabilities.sms && <span className="inline-block bg-green-light text-green px-1.5 py-0.5 rounded text-[10px] font-semibold">SMS</span>}
                      {n.capabilities.voice && <span className="inline-block bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px] font-semibold">Voice</span>}
                      {n.capabilities.mms && <span className="inline-block bg-orange-light text-orange px-1.5 py-0.5 rounded text-[10px] font-semibold">MMS</span>}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-dim whitespace-nowrap">{n.price ? `${(n.priceUnit || 'USD').toUpperCase()} $${parseFloat(n.price).toFixed(2)}/mo` : ''}</td>
                    <td className="px-3 py-2"><button onClick={() => buy(n.phoneNumber)} className="px-2 py-1 bg-primary text-white rounded text-[11px] font-semibold hover:bg-primary-hover">Buy</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {purchaseError && <div className="p-3 rounded-lg text-xs text-red bg-red-light border border-red/20 mt-2">{purchaseError}</div>}
        </div>
      )}
    </div>
  );
}

function FetchNumbersPanel({ typeKey, fieldValues, channels, twilioDefaults, onSelect, onNumbersFetched }) {
  const [numbers, setNumbers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function getCreds() {
    let sid, tok;
    if (typeKey === 'whatsapp') {
      sid = twilioDefaults.sid; tok = twilioDefaults.tok;
    } else {
      sid = fieldValues.account_sid?.trim() || twilioDefaults.sid;
      tok = fieldValues.auth_token?.trim() || twilioDefaults.tok;
    }
    return { sid, tok };
  }

  const { sid, tok } = getCreds();
  const hasCreds = !!(sid && tok);
  const usedNumbers = new Set(Object.values(channels).map(ch => ch.number).filter(Boolean));

  async function fetchNumbers() {
    setLoading(true); setError(''); setNumbers(null);
    try {
      const res = await apiFetch(API + '/api/twilio/list-numbers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_sid: sid, auth_token: tok }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch numbers');
      if (!data.numbers?.length) { setError('No phone numbers found in this Twilio account.'); return; }
      setNumbers(data.numbers);
      if (onNumbersFetched) onNumbersFetched(data.numbers);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <button
          onClick={fetchNumbers}
          disabled={!hasCreds || loading}
          className="px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors disabled:opacity-50"
          title={hasCreds ? 'Fetch phone numbers from your Twilio account' : 'Set Account SID and Auth Token first'}
        >
          {loading ? 'Fetching\u2026' : 'Fetch my numbers'}
        </button>
        {!hasCreds && (
          <span className="text-[11px] text-dim">
            {typeKey === 'whatsapp'
              ? 'Set Twilio defaults in Settings to fetch numbers'
              : 'Enter Account SID and Auth Token above to fetch numbers'}
          </span>
        )}
      </div>
      {error && <div className="text-xs text-red mt-2">{error}</div>}
      {numbers && (
        <div className="mt-2 border border-border rounded-lg max-h-[200px] overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <tbody className="divide-y divide-border/50">
              {numbers.map(n => {
                const isUsed = usedNumbers.has(n.phoneNumber);
                return (
                  <tr
                    key={n.phoneNumber}
                    className={`${isUsed ? 'opacity-60' : 'cursor-pointer hover:bg-bg-light'} transition-colors`}
                    onClick={() => { if (!isUsed) onSelect(n.phoneNumber); }}
                  >
                    <td className="px-3 py-2 font-mono text-xs font-medium">
                      {n.phoneNumber}
                      {isUsed && <span className="ml-2 text-[10px] font-semibold text-yellow bg-yellow-light px-1.5 py-0.5 rounded">used</span>}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-dim">{n.friendlyName}</td>
                    <td className="px-3 py-2 space-x-1">
                      {n.capabilities.sms && <span className="inline-block bg-green-light text-green px-1.5 py-0.5 rounded text-[10px] font-semibold">SMS</span>}
                      {n.capabilities.voice && <span className="inline-block bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px] font-semibold">Voice</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Channels({ loadConfig }) {
  const { channels, services, twilioDefaults, tunnelActive, qrMessage, smsListenMessage, baileysAvailable } = useAppState();
  const dispatch = useDispatch();
  const [step, setStep] = useState('pick');
  const [typeKey, setTypeKey] = useState('');
  const [chName, setChName] = useState('');
  const [fieldValues, setFieldValues] = useState({});
  const [mode, setMode] = useState('service');
  const [unmatched, setUnmatched] = useState('ignore');
  const [smsInbound, setSmsInbound] = useState('polling');
  const [smsPollInterval, setSmsPollInterval] = useState(60);
  const [emailInbound, setEmailInbound] = useState('webhook');
  const [emailPollInterval, setEmailPollInterval] = useState(30);
  const [gmailPollInterval, setGmailPollInterval] = useState(30);
  const [showBuy, setShowBuy] = useState(false);
  const [showTelegramHelp, setShowTelegramHelp] = useState(false);
  const [qrChannel, setQrChannel] = useState(null);
  const [gmailAuthChannel, setGmailAuthChannel] = useState(null);
  const [smsSettingsTarget, setSmsSettingsTarget] = useState(null);
  const [emailSettingsTarget, setEmailSettingsTarget] = useState(null);
  const [endpointResponseMode, setEndpointResponseMode] = useState('sync');
  const [endpointTimeout, setEndpointTimeout] = useState('30');
  const [allowListEnabled, setAllowListEnabled] = useState(false);
  const [allowListText, setAllowListText] = useState('');
  const [allowListTarget, setAllowListTarget] = useState(null);
  const [copiedSecret, setCopiedSecret] = useState(null);
  const [smsListenNumber, setSmsListenNumber] = useState(null);
  const [fetchedTwilioNumbers, setFetchedTwilioNumbers] = useState([]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  function selectType(type) { setTypeKey(type); setStep('form'); setFieldValues({}); setShowBuy(false); setFetchedTwilioNumbers([]); }

  function backToPicker() {
    setStep('pick'); setTypeKey(''); setChName(''); setFieldValues({}); setMode('service');
    setAllowListEnabled(false); setAllowListText('');
  }

  function updateField(key, val) { setFieldValues(prev => ({ ...prev, [key]: val })); }

  function getPlaceholder(field) {
    if ((field.key === 'account_sid' || field.key === 'auth_token') && twilioDefaults.sid) {
      const val = field.key === 'account_sid' ? twilioDefaults.sid : twilioDefaults.tok;
      if (val) return field.label + ' \u2014 Using default (' + maskValue(val) + ')';
    }
    return field.label + (field.placeholder ? ' \u2014 ' + field.placeholder : '');
  }

  async function addChannel() {
    const name = chName.trim();
    if (!name || !typeKey) { alert('Channel name and type are required'); return; }
    const body = { name, mode };
    if (mode === 'groups') body.unmatched = unmatched;
    if (allowListEnabled && allowListText.trim()) {
      body.allow_list = allowListText.split(',').map(n => n.trim()).filter(Boolean);
    }

    if (typeKey === 'whatsapp') {
      const num = fieldValues.number?.trim();
      Object.assign(body, { type: 'whatsapp', ...(num && { number: num }) });
    } else if (typeKey === 'telegram') {
      const token = fieldValues.bot_token?.trim();
      if (!token) { alert('Bot token is required'); return; }
      Object.assign(body, { type: 'telegram', bot_token: token });
    } else if (typeKey === 'sms-twilio') {
      const sid = fieldValues.account_sid?.trim() || twilioDefaults.sid;
      const tok = fieldValues.auth_token?.trim() || twilioDefaults.tok;
      const num = fieldValues.number?.trim();
      if (!sid || !tok || !num) { alert('Account SID, Auth Token and Phone Number are required'); return; }
      if (smsInbound === 'webhook' && !tunnelActive) { alert('Please externalize first.'); return; }
      Object.assign(body, { type: 'sms', provider: 'twilio', account_sid: sid, auth_token: tok, number: num });
      if (smsInbound === 'polling') body.poll_interval = parseInt(smsPollInterval) || 60;
    } else if (typeKey === 'voice-twilio') {
      const sid = fieldValues.account_sid?.trim() || twilioDefaults.sid;
      const tok = fieldValues.auth_token?.trim() || twilioDefaults.tok;
      const num = fieldValues.number?.trim();
      if (!sid || !tok || !num) { alert('Account SID, Auth Token and Phone Number are required'); return; }
      Object.assign(body, { type: 'voice', provider: 'twilio', account_sid: sid, auth_token: tok, number: num });
    } else if (typeKey === 'email-gmail') {
      const cid = fieldValues.client_id?.trim();
      const csecret = fieldValues.client_secret?.trim();
      if (!cid || !csecret) { alert('Client ID and Client Secret are required'); return; }
      Object.assign(body, { type: 'email', provider: 'gmail', client_id: cid, client_secret: csecret });
      const pi = parseInt(gmailPollInterval);
      if (pi && pi !== 30) body.poll_interval = pi;
    } else if (typeKey === 'email-resend') {
      const key = fieldValues.api_key?.trim();
      const from = fieldValues.from_email?.trim();
      if (!key || !from) { alert('API Key and From Email are required'); return; }
      Object.assign(body, { type: 'email', provider: 'resend', api_key: key, from_email: from });
      if (emailInbound === 'polling') body.poll_interval = parseInt(emailPollInterval) || 30;
    } else if (typeKey === 'endpoint') {
      const method = (fieldValues.method?.trim().toUpperCase()) || 'POST';
      const secret = fieldValues.secret?.trim();
      Object.assign(body, {
        type: 'endpoint',
        ...(method !== 'POST' && { method }),
        ...(secret && { secret }),
        response_mode: endpointResponseMode,
        ...(endpointResponseMode === 'sync' && endpointTimeout && endpointTimeout !== '30' && { response_timeout: parseInt(endpointTimeout) }),
      });
    }

    const res = await apiFetch(API + '/api/config/channels', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Failed to add channel'); return; }

    if (typeKey === 'sms-twilio') {
      try {
        await apiFetch(API + '/api/config/channels/' + encodeURIComponent(name) + '/sms-settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inbound_mode: smsInbound, ...(smsInbound === 'polling' && { poll_interval: parseInt(smsPollInterval) || 60 }) }),
        });
      } catch {}
    }
    if (typeKey === 'email-resend') {
      try {
        await apiFetch(API + '/api/config/channels/' + encodeURIComponent(name) + '/email-settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inbound_mode: emailInbound, ...(emailInbound === 'polling' && { poll_interval: parseInt(emailPollInterval) || 30 }) }),
        });
      } catch {}
    }

    if (typeKey === 'whatsapp') {
      backToPicker(); loadConfig(); startPairing(name); return;
    }
    if (typeKey === 'email-gmail') {
      backToPicker(); loadConfig(); startGmailAuth(name); return;
    }
    backToPicker(); loadConfig();
  }

  async function connectWhatsApp(channelName) {
    startPairing(channelName);
  }

  async function startPairing(channelName) {
    setQrChannel(channelName);
    dispatch({ type: 'SET_QR_MESSAGE', payload: null });
    try {
      const res = await apiFetch(API + '/api/config/channels/' + encodeURIComponent(channelName) + '/pair', { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        dispatch({ type: 'SET_QR_MESSAGE', payload: { type: 'whatsapp-pair-error', channel: channelName, error: d.error || 'Failed to start pairing' } });
      }
    } catch (e) {
      dispatch({ type: 'SET_QR_MESSAGE', payload: { type: 'whatsapp-pair-error', channel: channelName, error: e.message } });
    }
  }

  async function startGmailAuth(channelName) {
    setGmailAuthChannel(channelName);
    dispatch({ type: 'SET_QR_MESSAGE', payload: null });
    try {
      const res = await apiFetch(API + '/api/config/channels/' + encodeURIComponent(channelName) + '/gmail-auth', { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        dispatch({ type: 'SET_QR_MESSAGE', payload: { type: 'gmail-auth-error', channel: channelName, error: d.error || 'Failed to start OAuth' } });
      } else if (d.already_authenticated) {
        dispatch({ type: 'SET_QR_MESSAGE', payload: { type: 'gmail-auth-success', channel: channelName } });
      }
    } catch (e) {
      dispatch({ type: 'SET_QR_MESSAGE', payload: { type: 'gmail-auth-error', channel: channelName, error: e.message } });
    }
  }

  async function removeChannel(name, deps) {
    const msg = deps.length > 0
      ? `Remove channel "${name}"?\n\nThis will also remove these services:\n\u2022 ${deps.join('\n\u2022 ')}`
      : `Remove channel "${name}"?`;
    if (!confirm(msg)) return;
    const res = await apiFetch(API + '/api/config/channels/' + encodeURIComponent(name), { method: 'DELETE' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Remove failed'); return; }
    loadConfig();
  }

  async function setUnmatchedValue(name, value) {
    await apiFetch(API + '/api/config/channels/' + encodeURIComponent(name), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unmatched: value || null }),
    });
  }

  async function setChannelMode(name, mode) {
    await apiFetch(API + '/api/config/channels/' + encodeURIComponent(name), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
    });
    loadConfig();
  }

  async function startSmsListen(phoneNumber) {
    const sid = twilioDefaults.sid;
    const tok = twilioDefaults.tok;
    if (!sid || !tok) { alert('Set Twilio defaults in Settings first to listen for SMS.'); return; }
    setSmsListenNumber(phoneNumber);
    dispatch({ type: 'SET_SMS_LISTEN', payload: null });
    try {
      const res = await apiFetch(API + '/api/twilio/listen-sms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_sid: sid, auth_token: tok, number: phoneNumber }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Failed to start SMS listener');
        setSmsListenNumber(null);
      }
    } catch (e) {
      alert(e.message);
      setSmsListenNumber(null);
    }
  }

  const hasBuyOption = typeKey === 'sms-twilio' || typeKey === 'voice-twilio' || typeKey === 'whatsapp';
  const def = CHANNEL_FIELDS[typeKey];
  const chEntries = Object.entries(channels);

  return (
    <>
      {/* Channels Table */}
      <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
        <div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-bg-light border-b border-border">
                <th className="px-4 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Mode</th>
                <th className="px-4 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Details</th>
                <th className="px-4 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Services</th>
                <th className="px-4 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Unmatched</th>
                <th className="px-4 py-3 text-[11px] font-bold text-dim uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {chEntries.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-dim py-8 text-sm">No channels configured</td></tr>
              ) : chEntries.map(([name, ch]) => {
                const deps = Object.entries(services).filter(([, s]) => s.channel === name).map(([n]) => n);
                const detail = ch.number || (ch.bot_token ? ch.bot_token.slice(0, 12) + '\u2026' : '') || ch.from_email || '';
                const isSms = ch.type === 'sms';
                const isResendEmail = ch.type === 'email' && ch.provider === 'resend';
                const smsMode = isSms ? (ch.poll_interval ? 'polling' : 'webhook') : '';
                const smsModeLabel = isSms ? (ch.poll_interval ? `Polling (${ch.poll_interval}s)` : 'External Address') : '';

                return (
                  <React.Fragment key={name}>
                    <tr className="hover:bg-bg-light transition-colors">
                      <td className="px-4 py-4 text-sm font-medium text-text">
                        <span className="inline-flex items-center gap-2">
                          {name}
                          {['whatsapp', 'voice'].includes(ch.type) && (
                            <span
                              title={ch.connected ? 'Connected' : (ch.statusMessage || 'Disconnected')}
                              className={`inline-block w-2 h-2 rounded-full ${ch.connected ? 'bg-green-400' : 'bg-red-400'}`}
                            />
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-dim">{ch.type}</td>
                      <td className="px-4 py-4">
                        {ch.type === 'endpoint' ? (
                          <span className="text-xs text-dim">{'\u2014'}</span>
                        ) : (
                          <select
                            value={ch.mode || 'service'}
                            onChange={e => setChannelMode(name, e.target.value)}
                            className="text-xs py-1 px-2 border border-border rounded bg-bg-light text-text focus:outline-none"
                          >
                            <option value="service">Service</option>
                            <option value="groups">Groups</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-dim">
                        {detail}
                        {isSms && <div className="mt-0.5 font-sans text-primary text-[11px]">{smsModeLabel}</div>}
                        {ch.allow_list?.length > 0 && (
                          <div className="mt-0.5 font-sans text-[11px] text-yellow">{ch.allow_list.length} allowed number{ch.allow_list.length > 1 ? 's' : ''}</div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-xs text-dim">{deps.length > 0 ? deps.join(', ') : '\u2014'}</td>
                      <td className="px-4 py-4">
                        {ch.mode === 'groups' || deps.length > 1 ? (
                          <select
                            defaultValue={ch.unmatched || ''}
                            onChange={e => setUnmatchedValue(name, e.target.value)}
                            className="text-xs py-1 px-2 border border-border rounded bg-bg-light text-text focus:outline-none"
                          >
                            <option value="">Ignore (default)</option>
                            <option value="list">List services</option>
                            <option value="ignore">Ignore</option>
                          </select>
                        ) : <span className="text-xs text-dim">{'\u2014'}</span>}
                      </td>
                      <td className="px-4 py-4 text-right whitespace-nowrap space-x-1">
                        {ch.type === 'whatsapp' && !ch.connected && (
                          <IconBtn icon="link" label="Connect" onClick={() => connectWhatsApp(name)} />
                        )}
                        {['whatsapp', 'sms', 'voice'].includes(ch.type) && (
                          <IconBtn icon="shield_person" label="Allow List" onClick={() => {
                            if (allowListTarget === name) { setAllowListTarget(null); return; }
                            setAllowListTarget(name);
                            setAllowListText((ch.allow_list || []).join(', '));
                            setAllowListEnabled(!!(ch.allow_list?.length));
                          }} />
                        )}
                        {isSms && <IconBtn icon="settings" label="Settings" onClick={() => setSmsSettingsTarget(smsSettingsTarget === name ? null : name)} />}
                        {isResendEmail && <IconBtn icon="settings" label="Settings" onClick={() => setEmailSettingsTarget(emailSettingsTarget === name ? null : name)} />}
                        {ch.type === 'email' && ch.provider === 'gmail' && <IconBtn icon="key" label="Authenticate" onClick={() => startGmailAuth(name)} />}
                        {ch.type === 'endpoint' && ch.secret && (
                          <IconBtn icon={copiedSecret === name ? 'check' : 'content_copy'} label={copiedSecret === name ? 'Copied!' : 'Copy Secret'} onClick={async () => {
                            try {
                              const r = await apiFetch(API + '/api/config/channels/' + encodeURIComponent(name) + '/secret');
                              const d = await r.json();
                              if (d.secret) { navigator.clipboard.writeText(d.secret); setCopiedSecret(name); setTimeout(() => setCopiedSecret(null), 1500); }
                            } catch {}
                          }} />
                        )}
                        <IconBtn icon="delete" label="Remove" onClick={() => removeChannel(name, deps)} danger />
                      </td>
                    </tr>
                    {smsSettingsTarget === name && (
                      <SmsSettingsRow name={name} currentMode={smsMode} currentInterval={ch.poll_interval || 60} onClose={() => setSmsSettingsTarget(null)} loadConfig={loadConfig} />
                    )}
                    {emailSettingsTarget === name && isResendEmail && (
                      <EmailSettingsRow name={name} ch={ch} onClose={() => setEmailSettingsTarget(null)} loadConfig={loadConfig} />
                    )}
                    {allowListTarget === name && (
                      <tr>
                        <td colSpan={7} className="px-6 py-4">
                          <div className="bg-bg-light border border-border rounded-lg p-4 space-y-3">
                            <div className="text-sm font-semibold text-text">Allow List — {name}</div>
                            <label className="flex items-center gap-2 text-sm text-text cursor-pointer select-none">
                              <input type="checkbox" checked={allowListEnabled} onChange={e => setAllowListEnabled(e.target.checked)} className="accent-primary" />
                              Restrict to specific numbers
                            </label>
                            {allowListEnabled && (
                              <textarea
                                value={allowListText}
                                onChange={e => setAllowListText(e.target.value)}
                                placeholder="Comma-separated phone numbers, e.g. +972541234567, +12025551234"
                                rows={2}
                                className={inputCls + ' resize-y'}
                              />
                            )}
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                onClick={async () => {
                                  const list = allowListEnabled && allowListText.trim()
                                    ? allowListText.split(',').map(n => n.trim()).filter(Boolean)
                                    : [];
                                  await apiFetch(API + '/api/config/channels/' + encodeURIComponent(name), {
                                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ unmatched: ch.unmatched || null, allow_list: list.length > 0 ? list : [] }),
                                  });
                                  setAllowListTarget(null);
                                  loadConfig();
                                }}
                                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover transition-colors"
                              >Save</button>
                              <button onClick={() => setAllowListTarget(null)} className="px-4 py-2 border border-border rounded-lg text-sm text-dim hover:bg-bg-light transition-colors">Cancel</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Channel Form */}
      <div className="bg-surface border border-border rounded-xl p-5 shadow-sm mt-4">
        <h3 className="text-sm font-semibold text-text mb-1">Add Channel</h3>
        {step === 'pick' ? (
          <div>
            <p className="text-xs text-dim mb-4">Choose the type of channel to add.</p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
              {[
                { type: 'whatsapp', label: 'WhatsApp', sub: 'Pair via QR code' },
                { type: 'telegram', label: 'Telegram', sub: 'Bot via BotFather' },
                { type: 'sms-twilio', label: 'SMS', sub: 'Twilio' },
                { type: 'voice-twilio', label: 'Voice', sub: 'Twilio' },
                { type: 'email-gmail', label: 'Email', sub: 'Gmail (OAuth2)' },
                { type: 'email-resend', label: 'Email', sub: 'Resend' },
                { type: 'endpoint', label: 'Endpoint', sub: 'HTTP Webhook' },
              ].map(t => {
                const disabled = t.type === 'whatsapp' && !baileysAvailable;
                return (
                  <div
                    key={t.type}
                    onClick={() => !disabled && selectType(t.type)}
                    className={`flex flex-col items-center gap-2 p-4 border-2 rounded-xl text-center transition-all ${disabled ? 'bg-bg-light border-border opacity-50 cursor-not-allowed' : 'bg-bg-light border-border cursor-pointer hover:border-primary hover:bg-highlight'}`}
                  >
                    <div className="w-8 h-8 flex items-center justify-center">{channelTypeSvgs[t.type.split('-')[0]] || channelTypeSvgs[t.type]}</div>
                    <div className="text-sm font-medium text-text">{t.label}</div>
                    <div className="text-[11px] text-dim leading-tight">{disabled ? 'Not installed' : t.sub}</div>
                  </div>
                );
              })}
              {!baileysAvailable && (
                <div className="col-span-full mt-2 p-3 bg-bg-light border border-border rounded-lg">
                  <div className="text-xs text-dim mb-2">
                    WhatsApp requires the <code className="px-1 py-0.5 rounded bg-surface text-text">@whiskeysockets/baileys</code> package, which is not currently installed.
                  </div>
                  <div className="text-xs text-dim mb-2">
                    Run this in the directory you start ChannelKit from:
                  </div>
                  <div className="bg-surface border border-border rounded px-3 py-2 font-mono text-xs text-text select-all mb-2">
                    npm install @whiskeysockets/baileys
                  </div>
                  <div className="text-xs text-dim mb-1">
                    If ChannelKit is installed globally, use <code className="px-1 py-0.5 rounded bg-surface text-text">npm install -g @whiskeysockets/baileys</code> instead.
                  </div>
                  <div className="text-xs text-dim">
                    Then restart ChannelKit. Note: this package is licensed under GPL-3.0.
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            <button onClick={backToPicker} className="flex items-center gap-1 text-sm text-primary hover:underline mb-3 bg-transparent border-none cursor-pointer p-0">
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back to channel types
            </button>
            <p className="text-xs text-dim mb-3">Configure your new {TYPE_LABELS[typeKey] || typeKey} channel.</p>
            <div className="space-y-3 mb-3">
              <input value={chName} onChange={e => setChName(e.target.value)} placeholder="Channel name (e.g. mywhatsapp)" className={inputCls} autoFocus />
              {def.fields.map(f => (
                <input key={f.key} value={fieldValues[f.key] || ''} onChange={e => updateField(f.key, e.target.value)} placeholder={getPlaceholder(f)} className={inputCls} />
              ))}
            </div>

            {hasBuyOption && (
              <FetchNumbersPanel typeKey={typeKey} fieldValues={fieldValues} channels={channels} twilioDefaults={twilioDefaults} onSelect={num => updateField('number', num)} onNumbersFetched={nums => setFetchedTwilioNumbers(nums.map(n => n.phoneNumber))} />
            )}

            {hasBuyOption && !showBuy && (
              <div className="mb-3">
                <button onClick={() => setShowBuy(true)} className="text-xs text-primary underline bg-transparent border-none cursor-pointer p-0">
                  or buy a new number from Twilio
                </button>
              </div>
            )}
            {hasBuyOption && showBuy && (
              <BuyNumberPanel typeKey={typeKey} fieldValues={fieldValues} onNumberPurchased={num => { updateField('number', num); setShowBuy(false); }} onClose={() => setShowBuy(false)} />
            )}

            {typeKey === 'whatsapp' && fieldValues.number?.trim() && fetchedTwilioNumbers.includes(fieldValues.number.trim()) && (
              <div className="mb-3 p-3 bg-bg-light border border-border rounded-lg flex items-center justify-between">
                <div className="text-xs text-dim">
                  <span className="font-mono font-medium text-text">{fieldValues.number.trim()}</span> is in your Twilio account.
                  Listen for incoming SMS to catch a verification code.
                </div>
                <button onClick={() => startSmsListen(fieldValues.number.trim())} className="ml-3 px-3 py-1.5 text-xs font-semibold text-white bg-primary rounded-lg hover:bg-primary-hover transition-colors whitespace-nowrap">
                  Listen to SMS
                </button>
              </div>
            )}

            {typeKey === 'sms-twilio' && (
              <div className="space-y-3 mb-3">
                <select value={smsInbound} onChange={e => setSmsInbound(e.target.value)} className={selectCls}>
                  <option value="polling">Polling — fetch messages at regular intervals</option>
                  <option value="webhook">External Address — receive webhooks from Twilio</option>
                </select>
                {smsInbound === 'polling' && (
                  <input type="number" value={smsPollInterval} onChange={e => setSmsPollInterval(e.target.value)} min="5" max="3600" placeholder="Poll interval in seconds (default: 60)" className={inputCls} />
                )}
                {smsInbound === 'webhook' && !tunnelActive && (
                  <div className="p-3 rounded-lg text-xs bg-yellow-light text-yellow border border-yellow/20">Service is not externalized. Please <strong>Externalize</strong> first.</div>
                )}
              </div>
            )}

            {typeKey === 'email-gmail' && (
              <div className="space-y-3 mb-3">
                <input type="number" value={gmailPollInterval} onChange={e => setGmailPollInterval(e.target.value)} min="5" max="3600" placeholder="Poll interval in seconds (default: 30)" className={inputCls} />
                <p className="text-xs text-dim">On first start, a browser window will open for OAuth consent.</p>
              </div>
            )}

            {typeKey === 'email-resend' && (
              <div className="space-y-3 mb-3">
                <select value={emailInbound} onChange={e => setEmailInbound(e.target.value)} className={selectCls}>
                  <option value="webhook">Webhook — Resend forwards emails to your endpoint</option>
                  <option value="polling">Polling — fetch emails at regular intervals</option>
                </select>
                {emailInbound === 'polling' && (
                  <input type="number" value={emailPollInterval} onChange={e => setEmailPollInterval(e.target.value)} min="5" max="3600" placeholder="Poll interval in seconds (default: 30)" className={inputCls} />
                )}
              </div>
            )}

            {typeKey === 'endpoint' && (
              <div className="space-y-3 mb-3">
                <select value={endpointResponseMode} onChange={e => setEndpointResponseMode(e.target.value)} className={selectCls}>
                  <option value="sync">Sync — wait for service response and return it</option>
                  <option value="async">Async — return 200 immediately (fire-and-forget)</option>
                </select>
                {endpointResponseMode === 'sync' && (
                  <input type="number" value={endpointTimeout} onChange={e => setEndpointTimeout(e.target.value)} min="5" max="120" placeholder="Response timeout in seconds (default: 30)" className={inputCls} />
                )}
              </div>
            )}

            {['whatsapp', 'sms-twilio', 'voice-twilio'].includes(typeKey) && (
              <div className="space-y-2 mb-3">
                <label className="flex items-center gap-2 text-sm text-text cursor-pointer select-none">
                  <input type="checkbox" checked={allowListEnabled} onChange={e => setAllowListEnabled(e.target.checked)} className="accent-primary" />
                  Restrict to specific numbers (allow list)
                </label>
                {allowListEnabled && (
                  <textarea
                    value={allowListText}
                    onChange={e => setAllowListText(e.target.value)}
                    placeholder="Comma-separated phone numbers, e.g. +972541234567, +12025551234"
                    rows={2}
                    className={inputCls + ' resize-y'}
                  />
                )}
              </div>
            )}

            {typeKey !== 'endpoint' && <div className="space-y-3 mb-3">
              <select value={mode} onChange={e => setMode(e.target.value)} className={selectCls}>
                <option value="service">Service mode — single service, no codes needed</option>
                <option value="groups">Groups mode — multiple services via codes or commands</option>
              </select>
              {mode === 'groups' && (
                <select value={unmatched} onChange={e => setUnmatched(e.target.value)} className={selectCls}>
                  <option value="ignore">Unmatched messages: Ignore silently</option>
                  <option value="list">Unmatched messages: Reply with service list</option>
                </select>
              )}
            </div>}

            {typeKey === 'telegram' && (
              <div className="mb-3 p-3 bg-bg-light border border-border rounded-lg">
                <button
                  type="button"
                  onClick={() => setShowTelegramHelp(v => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-transparent border-none cursor-pointer p-0"
                >
                  <span className="material-symbols-outlined text-[16px]">info</span>
                  How to get a Telegram Bot Token
                  <span className="material-symbols-outlined text-[14px]">{showTelegramHelp ? 'expand_less' : 'expand_more'}</span>
                </button>
                {showTelegramHelp && (
                  <ol className="mt-2 ml-4 space-y-1 text-xs text-dim list-decimal">
                    <li>Open Telegram and search for <strong className="text-text">@BotFather</strong></li>
                    <li>Send <code className="px-1 py-0.5 rounded bg-surface font-mono text-text">/newbot</code></li>
                    <li>Follow the prompts to name your bot</li>
                    <li>Copy the token BotFather gives you</li>
                    <li>Paste it in the <strong className="text-text">Bot Token</strong> field above</li>
                  </ol>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button onClick={addChannel} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover transition-colors">Add Channel</button>
              <span className="text-xs text-dim">{def.note}</span>
            </div>
          </div>
        )}
      </div>

      {qrChannel && (
        <QRModal channel={qrChannel} onClose={() => setQrChannel(null)} />
      )}

      {gmailAuthChannel && (
        <GmailAuthModal channel={gmailAuthChannel} qrMessage={qrMessage} onClose={() => setGmailAuthChannel(null)} />
      )}

      {smsListenNumber && (
        <SmsListenModal number={smsListenNumber} smsListenMessage={smsListenMessage} onClose={() => setSmsListenNumber(null)} />
      )}
    </>
  );
}
