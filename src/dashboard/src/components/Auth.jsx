import { useState, useEffect } from 'react';
import { useAppState } from '../context.jsx';
import { API, apiFetch } from '../api.js';

const inputCls = 'w-full py-2 px-3 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary';

export default function Auth({ loadConfig }) {
  const { channels, auth: savedAuth } = useAppState();
  const [enabled, setEnabled] = useState(false);
  const [channel, setChannel] = useState('');
  const [channelNumber, setChannelNumber] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [callbackToken, setCallbackToken] = useState('');
  const [sessionTtl, setSessionTtl] = useState(300);
  const [codeLength, setCodeLength] = useState(6);
  const [qrCodeLength, setQrCodeLength] = useState(8);
  const [verifyMessage, setVerifyMessage] = useState('');
  const [status, setStatus] = useState('');
  const [statusColor, setStatusColor] = useState('');
  const [tokenVisible, setTokenVisible] = useState(false);
  const [allowLocal, setAllowLocal] = useState(false);

  // Load auth config
  useEffect(() => {
    if (savedAuth) {
      setEnabled(!!savedAuth.enabled);
      setChannel(savedAuth.channel || '');
      setChannelNumber(savedAuth.channel_number || '');
      setCallbackUrl(savedAuth.callback_url || '');
      setCallbackToken(savedAuth.callback_auth?.token || '');
      setSessionTtl(savedAuth.session_ttl || 300);
      setCodeLength(savedAuth.code_length || 6);
      setQrCodeLength(savedAuth.qr_code_length || 8);
      setVerifyMessage(savedAuth.messages?.verify_request || '');
    }
    // Check allow_local setting
    apiFetch(API + '/api/settings')
      .then(r => r.json())
      .then(d => setAllowLocal(!!d.settings?.allow_local_webhooks))
      .catch(() => {});
  }, [savedAuth]);

  const waChannels = Object.entries(channels || {}).filter(([_, c]) => c.type === 'whatsapp');

  async function save() {
    const body = {
      enabled,
      channel,
      channel_number: channelNumber || undefined,
      callback_url: callbackUrl,
      callback_auth: callbackToken ? { type: 'bearer', token: callbackToken } : undefined,
      session_ttl: sessionTtl,
      code_length: codeLength,
      qr_code_length: qrCodeLength,
      messages: verifyMessage ? { verify_request: verifyMessage } : undefined,
    };

    try {
      const res = await apiFetch(API + '/api/config/auth', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      const data = await res.json();
      setStatus(data.needsRestart ? 'Saved — restart required' : 'Saved');
      setStatusColor(data.needsRestart ? 'text-orange' : 'text-green');
      setTimeout(() => setStatus(''), 4000);
      loadConfig();
    } catch (e) {
      setStatus(e.message);
      setStatusColor('text-red');
    }
  }

  return (
    <div className="max-w-xl mx-auto py-6">
      <div className="bg-surface border border-border rounded-xl p-6 shadow-sm space-y-6">
        {/* Header */}
        <div>
          <h3 className="text-sm font-semibold text-text mb-1">WhatsApp Authentication</h3>
          <p className="text-xs text-dim mb-4">
            Let users verify their identity via WhatsApp. Supports phone+code and QR scan flows.
          </p>
        </div>

        {/* Enable toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="w-4 h-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
          />
          <div>
            <span className="text-xs font-medium text-text">Enable auth module</span>
            <p className="text-[11px] text-dim mt-0.5">Exposes /api/auth/session endpoints and intercepts auth messages.</p>
          </div>
        </label>

        {enabled && (
          <>
            {/* Channel selection */}
            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-text mb-1">Channel</h3>
              <p className="text-xs text-dim mb-4">Which WhatsApp channel handles auth messages.</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1 text-text">WhatsApp Channel</label>
                  {waChannels.length === 0 ? (
                    <p className="text-xs text-orange">No WhatsApp channels configured. Add one in the Channels tab first.</p>
                  ) : (
                    <select
                      value={channel}
                      onChange={e => setChannel(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Select channel...</option>
                      {waChannels.map(([name]) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1 text-text">
                    Channel Number <span className="text-dim font-normal">(optional override)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="+972501234567"
                    value={channelNumber}
                    onChange={e => setChannelNumber(e.target.value)}
                    className={inputCls}
                  />
                  <p className="text-[11px] text-dim mt-1">For the QR wa.me link. Leave empty to use the channel's number.</p>
                </div>
              </div>
            </div>

            {/* Callback configuration */}
            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-text mb-1">Callback</h3>
              <p className="text-xs text-dim mb-4">When a user verifies, ChannelKit POSTs to this URL with their phone and name.</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium block mb-1 text-text">Callback URL</label>
                  <input
                    type="url"
                    placeholder="https://yourapp.com/api/auth/wa/callback"
                    value={callbackUrl}
                    onChange={e => setCallbackUrl(e.target.value)}
                    className={inputCls}
                  />
                  {callbackUrl && callbackUrl.includes('localhost') && !allowLocal && (
                    <p className="text-[11px] text-orange mt-1">
                      Enable "Allow local webhooks" in Settings for localhost callbacks.
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1 text-text">
                    Callback Bearer Token <span className="text-dim font-normal">(optional)</span>
                  </label>
                  <div className="relative">
                    <input
                      type={tokenVisible ? 'text' : 'password'}
                      placeholder="Secret token for callback auth"
                      value={callbackToken}
                      onChange={e => setCallbackToken(e.target.value)}
                      autoComplete="off"
                      data-1p-ignore
                      className="w-full py-2 pl-3 pr-14 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onClick={() => setTokenVisible(!tokenVisible)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-dim hover:text-text bg-transparent border-none cursor-pointer px-2 py-1"
                    >
                      {tokenVisible ? 'hide' : 'show'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Session settings */}
            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-text mb-1">Session Settings</h3>
              <p className="text-xs text-dim mb-4">Configure code generation and session timeouts.</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1 text-text">TTL (seconds)</label>
                  <input
                    type="number"
                    min="60"
                    max="600"
                    value={sessionTtl}
                    onChange={e => setSessionTtl(Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1 text-text">Code Digits</label>
                  <input
                    type="number"
                    min="4"
                    max="8"
                    value={codeLength}
                    onChange={e => setCodeLength(Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1 text-text">QR Code Length</label>
                  <input
                    type="number"
                    min="6"
                    max="12"
                    value={qrCodeLength}
                    onChange={e => setQrCodeLength(Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            {/* Custom message */}
            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-text mb-1">Verify Message</h3>
              <p className="text-xs text-dim mb-4">Message sent to the user asking them to reply with the code (phone flow).</p>
              <textarea
                placeholder="Reply with the code shown on your screen to verify your identity."
                value={verifyMessage}
                onChange={e => setVerifyMessage(e.target.value)}
                rows={2}
                className={inputCls + ' resize-y'}
              />
            </div>
          </>
        )}

        {/* Save button */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={save}
            className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-hover transition-colors"
          >
            Save Auth Config
          </button>
          {status && <span className={`text-xs ${statusColor}`}>{status}</span>}
        </div>
      </div>
    </div>
  );
}
