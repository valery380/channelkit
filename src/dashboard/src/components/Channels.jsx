import React, { useState, useEffect, useRef } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API } from '../api.js';
import { channelIcons, maskValue } from '../utils.jsx';

const CHANNEL_FIELDS = {
  whatsapp: { note: "After adding, you'll pair via QR code. Optionally buy a Twilio number below.", fields: [{ key: 'number', label: 'Phone Number (optional)', placeholder: '+12025551234' }] },
  telegram: { note: 'Create a bot at @BotFather and paste the token here.', fields: [{ key: 'bot_token', label: 'Bot Token', placeholder: '123456:ABC-DEF1234...' }] },
  'sms-twilio': { note: 'Twilio console: Account SID and Auth Token from the dashboard.', fields: [{ key: 'account_sid', label: 'Account SID', placeholder: 'ACxxxxxxx' }, { key: 'auth_token', label: 'Auth Token', placeholder: '' }, { key: 'number', label: 'Phone Number', placeholder: '+12025551234' }] },
  'voice-twilio': { note: 'Same credentials as SMS. Voice and SMS can share credentials but need separate channels.', fields: [{ key: 'account_sid', label: 'Account SID', placeholder: 'ACxxxxxxx' }, { key: 'auth_token', label: 'Auth Token', placeholder: '' }, { key: 'number', label: 'Phone Number', placeholder: '+12025551234' }] },
  'email-resend': { note: 'Get your API key from resend.com.', fields: [{ key: 'api_key', label: 'API Key', placeholder: 're_xxxxxxx' }, { key: 'from_email', label: 'From Email', placeholder: 'support@yourdomain.com' }] },
};

const TYPE_LABELS = { whatsapp: 'WhatsApp', telegram: 'Telegram', 'sms-twilio': 'SMS (Twilio)', 'voice-twilio': 'Voice (Twilio)', 'email-resend': 'Email (Resend)' };

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
};

// ── QR Modal ──
function QRModal({ channel, qrMessage, onClose }) {
  const [timer, setTimer] = useState(60);
  const intervalRef = useRef(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => setTimer(t => Math.max(0, t - 1)), 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  useEffect(() => {
    if (qrMessage?.type === 'whatsapp-paired' || qrMessage?.type === 'whatsapp-pair-error') {
      clearInterval(intervalRef.current);
    }
  }, [qrMessage]);

  let body;
  if (qrMessage?.type === 'whatsapp-paired' && qrMessage.channel === channel) {
    body = (
      <div className="qr-success">
        <svg xmlns="http://www.w3.org/2000/svg" height="48" width="48" viewBox="0 -960 960 960" fill="currentColor" style={{ marginBottom: 12 }}><path d="m424-296 282-282-56-56-226 226-114-114-56 56 170 170Zm56 216q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z" /></svg>
        <br />WhatsApp paired successfully!
        <br /><span style={{ fontSize: 12, fontWeight: 400, color: 'var(--dim)' }}>Restart the server to start receiving messages.</span>
      </div>
    );
  } else if (qrMessage?.type === 'whatsapp-pair-error' && qrMessage.channel === channel) {
    body = <div className="qr-error">{qrMessage.error || 'Pairing failed'}</div>;
  } else if (qrMessage?.type === 'whatsapp-qr' && qrMessage.channel === channel && qrMessage.dataUrl) {
    body = <div className="qr-img-wrap"><img src={qrMessage.dataUrl} alt="QR Code" /></div>;
  } else {
    body = <div className="qr-waiting">Waiting for QR code...</div>;
  }

  return (
    <div className="qr-overlay open">
      <div className="qr-modal">
        <h3>Pair WhatsApp &mdash; {channel}</h3>
        <div className="qr-sub">Open WhatsApp &rarr; Settings &rarr; Linked Devices &rarr; Link a Device</div>
        {body}
        {timer > 0 && qrMessage?.type !== 'whatsapp-paired' && qrMessage?.type !== 'whatsapp-pair-error' && (
          <div className="qr-timer">{timer}s remaining</div>
        )}
        <button className="qr-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ── SMS Settings Row ──
function SmsSettingsRow({ name, currentMode, currentInterval, onClose, loadConfig }) {
  const { tunnelActive } = useAppState();
  const [mode, setMode] = useState(currentMode);
  const [interval, setInterv] = useState(currentInterval || 60);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (mode === 'webhook' && !tunnelActive) { alert('Please externalize the service first.'); return; }
    setSaving(true);
    try {
      const res = await fetch(API + '/api/config/channels/' + encodeURIComponent(name) + '/sms-settings', {
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
    <tr className="sms-settings-row">
      <td colSpan={6}>
        <div style={{ padding: '14px 16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, margin: '4px 0 8px' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>SMS Inbound Settings</div>
          <div className="form-row">
            <select value={mode} onChange={e => setMode(e.target.value)} style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}>
              <option value="polling">Polling — fetch messages at regular intervals</option>
              <option value="webhook">External Address — receive webhooks from Twilio</option>
            </select>
          </div>
          {mode === 'polling' && (
            <div className="form-row">
              <input type="number" value={interval} onChange={e => setInterv(e.target.value)} min="5" max="3600" placeholder="Poll interval in seconds" style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }} />
            </div>
          )}
          {mode === 'webhook' && !tunnelActive && (
            <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 10, background: '#fff8e1', color: '#9a6700', border: '1px solid #ffe082' }}>
              Service is not externalized. Please <strong>Externalize</strong> first.
            </div>
          )}
          {mode === 'webhook' && tunnelActive && (
            <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 10, background: '#e8f5e9', color: '#1a7f37', border: '1px solid #a5d6a7' }}>
              Twilio will send incoming SMS to your external address.
            </div>
          )}
          <div className="form-row" style={{ marginTop: 8, gap: 8 }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving\u2026' : 'Save'}</button>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: 'var(--dim)' }}>Cancel</button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Buy Number Panel ──
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
      const res = await fetch(API + '/api/twilio/search-numbers', {
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
      const res = await fetch(API + '/api/twilio/buy-number', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_sid: sid, auth_token: tok, phone_number: phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Purchase failed');
      onNumberPurchased(data.purchased.phoneNumber);
    } catch (e) { setPurchaseError(e.message); }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px', marginBottom: 10, background: 'var(--surface)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Buy a Twilio Number</div>
      {isWA ? (
        <>
          <div className="form-row"><input value={buySid} onChange={e => setBuySid(e.target.value)} placeholder="Account SID — ACxxxxxxx" style={{ flex: 1 }} /></div>
          <div className="form-row"><input value={buyTok} onChange={e => setBuyTok(e.target.value)} placeholder="Auth Token" style={{ flex: 1 }} /></div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>Using the Account SID and Auth Token above.</div>
      )}
      <div className="form-row">
        <select value={country} onChange={e => setCountry(e.target.value)} style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}>
          {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
        <select value={numType} onChange={e => setNumType(e.target.value)} style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}>
          <option value="mobile">Mobile</option>
          <option value="local">Local</option>
        </select>
      </div>
      <div className="form-row">
        <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 14px' }} onClick={search} disabled={searching}>{searching ? 'Searching\u2026' : 'Search Numbers'}</button>
        <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: 'var(--dim)' }}>Cancel</button>
      </div>
      {error && <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 12, color: 'var(--red)', background: '#ffeef0', border: '1px solid #ffc1c7', marginTop: 4 }}>{error}</div>}
      {numbers && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Available Numbers</div>
          <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table style={{ margin: 0 }}>
              <thead><tr><th style={{ fontSize: 10 }}>Number</th><th style={{ fontSize: 10 }}>Location</th><th style={{ fontSize: 10 }}>Capabilities</th><th style={{ fontSize: 10 }}>Price</th><th style={{ width: 50 }}></th></tr></thead>
              <tbody>
                {numbers.map(n => (
                  <tr key={n.phoneNumber}>
                    <td className="mono" style={{ fontWeight: 500, fontSize: 12 }}>{n.phoneNumber}</td>
                    <td style={{ fontSize: 11, color: 'var(--dim)' }}>{[n.locality, n.region].filter(Boolean).join(', ') || n.isoCountry}</td>
                    <td>
                      {n.capabilities.sms && <span style={{ background: '#e8f5e9', color: '#1a7f37', padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, marginRight: 2 }}>SMS</span>}
                      {n.capabilities.voice && <span style={{ background: '#e3f2fd', color: '#0969da', padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, marginRight: 2 }}>Voice</span>}
                      {n.capabilities.mms && <span style={{ background: '#fff3e0', color: '#9a6700', padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>MMS</span>}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{n.price ? `${(n.priceUnit || 'USD').toUpperCase()} $${parseFloat(n.price).toFixed(2)}/mo` : ''}</td>
                    <td><button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: 11 }} onClick={() => buy(n.phoneNumber)}>Buy</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {purchaseError && <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 12, color: 'var(--red)', background: '#ffeef0', border: '1px solid #ffc1c7', marginTop: 6 }}>{purchaseError}</div>}
        </div>
      )}
    </div>
  );
}

// ── Fetch Existing Numbers Panel ──
function FetchNumbersPanel({ typeKey, fieldValues, channels, twilioDefaults, onSelect }) {
  const [numbers, setNumbers] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function getCreds() {
    let sid, tok;
    if (typeKey === 'whatsapp') {
      sid = twilioDefaults.sid;
      tok = twilioDefaults.tok;
    } else {
      sid = fieldValues.account_sid?.trim() || twilioDefaults.sid;
      tok = fieldValues.auth_token?.trim() || twilioDefaults.tok;
    }
    return { sid, tok };
  }

  const { sid, tok } = getCreds();
  const hasCreds = !!(sid && tok);

  // Collect all numbers already used by existing channels
  const usedNumbers = new Set(
    Object.values(channels).map(ch => ch.number).filter(Boolean)
  );

  async function fetchNumbers() {
    setLoading(true);
    setError('');
    setNumbers(null);
    try {
      const res = await fetch(API + '/api/twilio/list-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_sid: sid, auth_token: tok }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch numbers');
      if (!data.numbers?.length) { setError('No phone numbers found in this Twilio account.'); return; }
      setNumbers(data.numbers);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ margin: '0 0 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={fetchNumbers}
          disabled={!hasCreds || loading}
          className="btn-edit"
          style={{ fontSize: 12, padding: '4px 10px', opacity: hasCreds ? 1 : 0.5 }}
          title={hasCreds ? 'Fetch phone numbers from your Twilio account' : 'Set Account SID and Auth Token first'}
        >
          {loading ? 'Fetching\u2026' : 'Fetch my numbers'}
        </button>
        {!hasCreds && (
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>
            {typeKey === 'whatsapp'
              ? 'Set Twilio defaults in Settings to fetch numbers'
              : 'Enter Account SID and Auth Token above to fetch numbers'}
          </span>
        )}
      </div>
      {error && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{error}</div>}
      {numbers && (
        <div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 6, maxHeight: 200, overflowY: 'auto' }}>
          <table style={{ margin: 0 }}>
            <tbody>
              {numbers.map(n => {
                const isUsed = usedNumbers.has(n.phoneNumber);
                return (
                  <tr key={n.phoneNumber} style={{ cursor: isUsed ? 'default' : 'pointer', opacity: isUsed ? 0.6 : 1 }}
                    onClick={() => { if (!isUsed) onSelect(n.phoneNumber); }}
                  >
                    <td className="mono" style={{ fontWeight: 500, fontSize: 12, padding: '6px 10px' }}>
                      {n.phoneNumber}
                      {isUsed && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--yellow)', background: '#fff8e1', padding: '1px 5px', borderRadius: 3, fontFamily: 'inherit' }}>used</span>}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--dim)', padding: '6px 10px' }}>{n.friendlyName}</td>
                    <td style={{ padding: '6px 10px' }}>
                      {n.capabilities.sms && <span style={{ background: '#e8f5e9', color: '#1a7f37', padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600, marginRight: 2 }}>SMS</span>}
                      {n.capabilities.voice && <span style={{ background: '#e3f2fd', color: '#0969da', padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600 }}>Voice</span>}
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

// ── Main Channels Component ──
export default function Channels({ loadConfig }) {
  const { channels, services, twilioDefaults, tunnelActive, qrMessage } = useAppState();
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
  const [showBuy, setShowBuy] = useState(false);
  const [qrChannel, setQrChannel] = useState(null);
  const [smsSettingsTarget, setSmsSettingsTarget] = useState(null);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  function selectType(type) {
    setTypeKey(type);
    setStep('form');
    setFieldValues({});
    setShowBuy(false);
  }

  function backToPicker() {
    setStep('pick');
    setTypeKey('');
    setChName('');
    setFieldValues({});
    setMode('service');
  }

  function updateField(key, val) {
    setFieldValues(prev => ({ ...prev, [key]: val }));
  }

  function getPlaceholder(field) {
    // Show twilio defaults hint
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
    } else if (typeKey === 'email-resend') {
      const key = fieldValues.api_key?.trim();
      const from = fieldValues.from_email?.trim();
      if (!key || !from) { alert('API Key and From Email are required'); return; }
      Object.assign(body, { type: 'email', provider: 'resend', api_key: key, from_email: from });
      if (emailInbound === 'polling') body.poll_interval = parseInt(emailPollInterval) || 30;
    }

    const res = await fetch(API + '/api/config/channels', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Failed to add channel'); return; }

    // Post-add settings for SMS/email
    if (typeKey === 'sms-twilio') {
      try {
        await fetch(API + '/api/config/channels/' + encodeURIComponent(name) + '/sms-settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inbound_mode: smsInbound, ...(smsInbound === 'polling' && { poll_interval: parseInt(smsPollInterval) || 60 }) }),
        });
      } catch {}
    }
    if (typeKey === 'email-resend') {
      try {
        await fetch(API + '/api/config/channels/' + encodeURIComponent(name) + '/email-settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inbound_mode: emailInbound, ...(emailInbound === 'polling' && { poll_interval: parseInt(emailPollInterval) || 30 }) }),
        });
      } catch {}
    }

    if (typeKey === 'whatsapp') {
      backToPicker();
      loadConfig();
      startPairing(name);
      return;
    }
    backToPicker();
    loadConfig();
  }

  async function startPairing(channelName) {
    setQrChannel(channelName);
    dispatch({ type: 'SET_QR_MESSAGE', payload: null });
    try {
      const res = await fetch(API + '/api/config/channels/' + encodeURIComponent(channelName) + '/pair', { method: 'POST' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        dispatch({ type: 'SET_QR_MESSAGE', payload: { type: 'whatsapp-pair-error', channel: channelName, error: d.error || 'Failed to start pairing' } });
      }
    } catch (e) {
      dispatch({ type: 'SET_QR_MESSAGE', payload: { type: 'whatsapp-pair-error', channel: channelName, error: e.message } });
    }
  }

  async function removeChannel(name, deps) {
    const msg = deps.length > 0
      ? `Remove channel "${name}"?\n\nThis will also remove these services:\n\u2022 ${deps.join('\n\u2022 ')}`
      : `Remove channel "${name}"?`;
    if (!confirm(msg)) return;
    const res = await fetch(API + '/api/config/channels/' + encodeURIComponent(name), { method: 'DELETE' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Remove failed'); return; }
    loadConfig();
  }

  async function setUnmatchedValue(name, value) {
    await fetch(API + '/api/config/channels/' + encodeURIComponent(name), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unmatched: value || null }),
    });
  }

  const hasBuyOption = typeKey === 'sms-twilio' || typeKey === 'voice-twilio' || typeKey === 'whatsapp';
  const def = CHANNEL_FIELDS[typeKey];
  const chEntries = Object.entries(channels);

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Details</th><th>Services</th><th>Unmatched msgs</th><th style={{ width: 80 }}></th></tr></thead>
          <tbody>
            {chEntries.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--dim)', padding: 32 }}>No channels configured</td></tr>
            ) : chEntries.map(([name, ch]) => {
              const deps = Object.entries(services).filter(([, s]) => s.channel === name).map(([n]) => n);
              const detail = ch.number || (ch.bot_token ? ch.bot_token.slice(0, 12) + '\u2026' : '') || ch.from_email || '';
              const isSms = ch.type === 'sms';
              const smsMode = isSms ? (ch.poll_interval ? 'polling' : 'webhook') : '';
              const smsModeLabel = isSms ? (ch.poll_interval ? `Polling (${ch.poll_interval}s)` : 'External Address') : '';

              return (
                <React.Fragment key={name}>
                  <tr>
                    <td style={{ fontWeight: 500 }}>{name}</td>
                    <td>{ch.type}</td>
                    <td className="mono" style={{ color: 'var(--dim)', fontSize: 12 }}>
                      {detail}
                      {isSms && <div style={{ marginTop: 3, fontFamily: 'inherit', color: 'var(--accent)', fontSize: 11 }}>{smsModeLabel}</div>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--dim)' }}>{deps.length > 0 ? deps.join(', ') : '\u2014'}</td>
                    <td>
                      {ch.mode === 'groups' || deps.length > 1 ? (
                        <select
                          defaultValue={ch.unmatched || ''}
                          onChange={e => setUnmatchedValue(name, e.target.value)}
                          style={{ fontSize: 12, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg)', color: 'var(--text)' }}
                        >
                          <option value="">Ignore (default)</option>
                          <option value="list">List services</option>
                          <option value="ignore">Ignore</option>
                        </select>
                      ) : <span style={{ color: 'var(--dim)', fontSize: 12 }}>{'\u2014'}</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isSms && <button className="btn-edit" onClick={() => setSmsSettingsTarget(smsSettingsTarget === name ? null : name)}>Settings</button>}
                      {' '}
                      <button className="btn-danger" onClick={() => removeChannel(name, deps)}>Remove</button>
                    </td>
                  </tr>
                  {smsSettingsTarget === name && (
                    <SmsSettingsRow name={name} currentMode={smsMode} currentInterval={ch.poll_interval || 60} onClose={() => setSmsSettingsTarget(null)} loadConfig={loadConfig} />
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="add-form">
        <h3>Add Channel</h3>
        {step === 'pick' ? (
          <div>
            <p className="form-hint">Choose the type of channel to add.</p>
            <div className="picker-grid">
              {[
                { type: 'whatsapp', label: 'WhatsApp', sub: 'Pair via QR code' },
                { type: 'telegram', label: 'Telegram', sub: 'Bot via BotFather' },
                { type: 'sms-twilio', label: 'SMS', sub: 'Twilio' },
                { type: 'voice-twilio', label: 'Voice', sub: 'Twilio' },
                { type: 'email-resend', label: 'Email', sub: 'Resend' },
              ].map(t => (
                <div key={t.type} className="picker-card" onClick={() => selectType(t.type)}>
                  <div className="picker-icon">{channelTypeSvgs[t.type.split('-')[0]] || channelTypeSvgs[t.type]}</div>
                  <div className="picker-label">{t.label}</div>
                  <div className="picker-sub">{t.sub}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <button className="step-back" onClick={backToPicker}>
              <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 -960 960 960" fill="currentColor"><path d="M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z" /></svg>
              Back to channel types
            </button>
            <p className="form-hint">Configure your new {TYPE_LABELS[typeKey] || typeKey} channel.</p>
            <div className="form-row">
              <input value={chName} onChange={e => setChName(e.target.value)} placeholder="Channel name (e.g. mywhatsapp)" autoFocus />
            </div>
            {def.fields.map(f => (
              <div className="form-row" key={f.key}>
                <input value={fieldValues[f.key] || ''} onChange={e => updateField(f.key, e.target.value)} placeholder={getPlaceholder(f)} style={{ flex: 1 }} />
              </div>
            ))}

            {hasBuyOption && (
              <FetchNumbersPanel
                typeKey={typeKey}
                fieldValues={fieldValues}
                channels={channels}
                twilioDefaults={twilioDefaults}
                onSelect={num => updateField('number', num)}
              />
            )}

            {hasBuyOption && !showBuy && (
              <div style={{ margin: '-4px 0 8px' }}>
                <button onClick={() => setShowBuy(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                  or buy a new number from Twilio
                </button>
              </div>
            )}
            {hasBuyOption && showBuy && (
              <BuyNumberPanel
                typeKey={typeKey}
                fieldValues={fieldValues}
                onNumberPurchased={num => { updateField('number', num); setShowBuy(false); }}
                onClose={() => setShowBuy(false)}
              />
            )}

            {typeKey === 'sms-twilio' && (
              <>
                <div className="form-row">
                  <select value={smsInbound} onChange={e => setSmsInbound(e.target.value)} style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}>
                    <option value="polling">Polling — fetch messages at regular intervals</option>
                    <option value="webhook">External Address — receive webhooks from Twilio</option>
                  </select>
                </div>
                {smsInbound === 'polling' && (
                  <div className="form-row">
                    <input type="number" value={smsPollInterval} onChange={e => setSmsPollInterval(e.target.value)} min="5" max="3600" placeholder="Poll interval in seconds (default: 60)" style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }} />
                  </div>
                )}
                {smsInbound === 'webhook' && !tunnelActive && (
                  <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 10, background: '#fff8e1', color: '#9a6700', border: '1px solid #ffe082' }}>Service is not externalized. Please <strong>Externalize</strong> first.</div>
                )}
              </>
            )}

            {typeKey === 'email-resend' && (
              <>
                <div className="form-row">
                  <select value={emailInbound} onChange={e => setEmailInbound(e.target.value)} style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}>
                    <option value="webhook">Webhook — Resend forwards emails to your endpoint</option>
                    <option value="polling">Polling — fetch emails at regular intervals</option>
                  </select>
                </div>
                {emailInbound === 'polling' && (
                  <div className="form-row">
                    <input type="number" value={emailPollInterval} onChange={e => setEmailPollInterval(e.target.value)} min="5" max="3600" placeholder="Poll interval in seconds (default: 30)" style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }} />
                  </div>
                )}
              </>
            )}

            <div className="form-row">
              <select value={mode} onChange={e => setMode(e.target.value)} style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}>
                <option value="service">Service mode — single service, no codes needed</option>
                <option value="groups">Groups mode — multiple services via codes or commands</option>
              </select>
            </div>
            {mode === 'groups' && (
              <div className="form-row">
                <select value={unmatched} onChange={e => setUnmatched(e.target.value)} style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, background: 'var(--bg)', color: 'var(--text)' }}>
                  <option value="ignore">Unmatched messages: Ignore silently</option>
                  <option value="list">Unmatched messages: Reply with service list</option>
                </select>
              </div>
            )}

            <div className="form-row">
              <button className="btn btn-primary" onClick={addChannel}>Add Channel</button>
              <span style={{ fontSize: 12, color: 'var(--dim)' }}>{def.note}</span>
            </div>
          </div>
        )}
      </div>

      {qrChannel && (
        <QRModal channel={qrChannel} qrMessage={qrMessage} onClose={() => setQrChannel(null)} />
      )}
    </>
  );
}
