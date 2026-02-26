import React, { useState, useEffect, useRef } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API } from '../api.js';
import { channelIcons, maskValue } from '../utils.jsx';

const inputCls = 'w-full py-2 px-3 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary';
const selectCls = 'w-full py-2 px-3 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary';

const CHANNEL_FIELDS = {
  whatsapp: { note: "After adding, you'll pair via QR code. Optionally buy a Twilio number below.", fields: [{ key: 'number', label: 'Phone Number (optional)', placeholder: '+12025551234' }] },
  telegram: { note: 'Create a bot at @BotFather and paste the token here.', fields: [{ key: 'bot_token', label: 'Bot Token', placeholder: '123456:ABC-DEF1234...' }] },
  'sms-twilio': { note: 'Twilio console: Account SID and Auth Token from the dashboard.', fields: [{ key: 'account_sid', label: 'Account SID', placeholder: 'ACxxxxxxx' }, { key: 'auth_token', label: 'Auth Token', placeholder: '' }, { key: 'number', label: 'Phone Number', placeholder: '+12025551234' }] },
  'voice-twilio': { note: 'Same credentials as SMS. Voice and SMS can share credentials but need separate channels.', fields: [{ key: 'account_sid', label: 'Account SID', placeholder: 'ACxxxxxxx' }, { key: 'auth_token', label: 'Auth Token', placeholder: '' }, { key: 'number', label: 'Phone Number', placeholder: '+12025551234' }] },
  'email-resend': { note: 'Get your API key from resend.com.', fields: [{ key: 'api_key', label: 'API Key', placeholder: 're_xxxxxxx' }, { key: 'from_email', label: 'From Email', placeholder: 'support@yourdomain.com' }] },
  'endpoint': { note: 'Expose a URL that external systems can call.', fields: [{ key: 'method', label: 'HTTP Method', placeholder: 'POST' }, { key: 'secret', label: 'Secret Key (optional)', placeholder: 'A secret for X-Channel-Secret header' }] },
};

const TYPE_LABELS = { whatsapp: 'WhatsApp', telegram: 'Telegram', 'sms-twilio': 'SMS (Twilio)', 'voice-twilio': 'Voice (Twilio)', 'email-resend': 'Email (Resend)', 'endpoint': 'Endpoint (Webhook)' };

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
      <div className="py-10 text-center text-green text-base font-semibold">
        <span className="material-symbols-outlined text-5xl mb-3 block">check_circle</span>
        WhatsApp paired successfully!
        <br /><span className="text-xs font-normal text-dim">Restart the server to start receiving messages.</span>
      </div>
    );
  } else if (qrMessage?.type === 'whatsapp-pair-error' && qrMessage.channel === channel) {
    body = <div className="py-10 text-center text-red text-sm">{qrMessage.error || 'Pairing failed'}</div>;
  } else if (qrMessage?.type === 'whatsapp-qr' && qrMessage.channel === channel && qrMessage.dataUrl) {
    body = <div className="bg-white rounded-xl p-3 inline-block mb-4"><img src={qrMessage.dataUrl} alt="QR Code" className="block w-[280px] h-[280px]" /></div>;
  } else {
    body = <div className="py-16 text-dim text-sm">Waiting for QR code...</div>;
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-surface rounded-xl p-8 max-w-md w-[90%] text-center shadow-2xl">
        <h3 className="text-base font-semibold mb-1">Pair WhatsApp &mdash; {channel}</h3>
        <div className="text-sm text-dim mb-5">Open WhatsApp &rarr; Settings &rarr; Linked Devices &rarr; Link a Device</div>
        {body}
        {timer > 0 && qrMessage?.type !== 'whatsapp-paired' && qrMessage?.type !== 'whatsapp-pair-error' && (
          <div className="text-xs text-dim mb-4">{timer}s remaining</div>
        )}
        <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm text-dim hover:bg-bg-light transition-colors">Close</button>
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
    <tr>
      <td colSpan={6} className="px-6 py-4">
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

function FetchNumbersPanel({ typeKey, fieldValues, channels, twilioDefaults, onSelect }) {
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
      const res = await fetch(API + '/api/twilio/list-numbers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_sid: sid, auth_token: tok }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch numbers');
      if (!data.numbers?.length) { setError('No phone numbers found in this Twilio account.'); return; }
      setNumbers(data.numbers);
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
  const [endpointResponseMode, setEndpointResponseMode] = useState('sync');
  const [endpointTimeout, setEndpointTimeout] = useState('30');
  const [allowListEnabled, setAllowListEnabled] = useState(false);
  const [allowListText, setAllowListText] = useState('');
  const [allowListTarget, setAllowListTarget] = useState(null);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  function selectType(type) { setTypeKey(type); setStep('form'); setFieldValues({}); setShowBuy(false); }

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

    const res = await fetch(API + '/api/config/channels', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Failed to add channel'); return; }

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
      backToPicker(); loadConfig(); startPairing(name); return;
    }
    backToPicker(); loadConfig();
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
      {/* Channels Table */}
      <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-bg-light border-b border-border">
                <th className="px-6 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Details</th>
                <th className="px-6 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Services</th>
                <th className="px-6 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Unmatched msgs</th>
                <th className="px-6 py-3 text-[11px] font-bold text-dim uppercase tracking-wider w-[80px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {chEntries.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-dim py-8 text-sm">No channels configured</td></tr>
              ) : chEntries.map(([name, ch]) => {
                const deps = Object.entries(services).filter(([, s]) => s.channel === name).map(([n]) => n);
                const detail = ch.number || (ch.bot_token ? ch.bot_token.slice(0, 12) + '\u2026' : '') || ch.from_email || '';
                const isSms = ch.type === 'sms';
                const smsMode = isSms ? (ch.poll_interval ? 'polling' : 'webhook') : '';
                const smsModeLabel = isSms ? (ch.poll_interval ? `Polling (${ch.poll_interval}s)` : 'External Address') : '';

                return (
                  <React.Fragment key={name}>
                    <tr className="hover:bg-bg-light transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-text">{name}</td>
                      <td className="px-6 py-4 text-sm text-dim">{ch.type}</td>
                      <td className="px-6 py-4 font-mono text-xs text-dim">
                        {detail}
                        {isSms && <div className="mt-0.5 font-sans text-primary text-[11px]">{smsModeLabel}</div>}
                        {ch.allow_list?.length > 0 && (
                          <div className="mt-0.5 font-sans text-[11px] text-yellow">{ch.allow_list.length} allowed number{ch.allow_list.length > 1 ? 's' : ''}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-dim">{deps.length > 0 ? deps.join(', ') : '\u2014'}</td>
                      <td className="px-6 py-4">
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
                      <td className="px-6 py-4 text-right whitespace-nowrap space-x-1">
                        {['whatsapp', 'sms', 'voice'].includes(ch.type) && (
                          <button onClick={() => {
                            if (allowListTarget === name) { setAllowListTarget(null); return; }
                            setAllowListTarget(name);
                            setAllowListText((ch.allow_list || []).join(', '));
                            setAllowListEnabled(!!(ch.allow_list?.length));
                          }} className="px-3 py-1 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/5 transition-colors">Allow List</button>
                        )}
                        {isSms && <button onClick={() => setSmsSettingsTarget(smsSettingsTarget === name ? null : name)} className="px-3 py-1 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/5 transition-colors">Settings</button>}
                        <button onClick={() => removeChannel(name, deps)} className="px-3 py-1 text-xs font-medium text-red border border-red/30 rounded hover:bg-red-light transition-colors">Remove</button>
                      </td>
                    </tr>
                    {smsSettingsTarget === name && (
                      <SmsSettingsRow name={name} currentMode={smsMode} currentInterval={ch.poll_interval || 60} onClose={() => setSmsSettingsTarget(null)} loadConfig={loadConfig} />
                    )}
                    {allowListTarget === name && (
                      <tr>
                        <td colSpan={6} className="px-6 py-4">
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
                                  await fetch(API + '/api/config/channels/' + encodeURIComponent(name), {
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
                { type: 'email-resend', label: 'Email', sub: 'Resend' },
                { type: 'endpoint', label: 'Endpoint', sub: 'HTTP Webhook' },
              ].map(t => (
                <div
                  key={t.type}
                  onClick={() => selectType(t.type)}
                  className="flex flex-col items-center gap-2 p-4 bg-bg-light border-2 border-border rounded-xl cursor-pointer transition-all hover:border-primary hover:bg-highlight text-center"
                >
                  <div className="w-8 h-8 flex items-center justify-center">{channelTypeSvgs[t.type.split('-')[0]] || channelTypeSvgs[t.type]}</div>
                  <div className="text-sm font-medium text-text">{t.label}</div>
                  <div className="text-[11px] text-dim leading-tight">{t.sub}</div>
                </div>
              ))}
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
              <FetchNumbersPanel typeKey={typeKey} fieldValues={fieldValues} channels={channels} twilioDefaults={twilioDefaults} onSelect={num => updateField('number', num)} />
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

            <div className="flex items-center gap-3">
              <button onClick={addChannel} className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover transition-colors">Add Channel</button>
              <span className="text-xs text-dim">{def.note}</span>
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
