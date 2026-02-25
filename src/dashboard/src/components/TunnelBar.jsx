import { useState, useEffect } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API } from '../api.js';

export default function TunnelBar() {
  const { tunnelActive, tunnelUrl, tunnelHasToken, hasSmsWebhookChannels, tunnelExposeDashboard } = useAppState();
  const dispatch = useDispatch();
  const [copied, setCopied] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [token, setToken] = useState('');
  const [hostname, setHostname] = useState('');
  const [hasClearable, setHasClearable] = useState(false);

  if (!tunnelActive || !tunnelUrl) return null;

  function copyUrl() {
    navigator.clipboard.writeText(tunnelUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function stopTunnel() {
    try {
      await fetch(API + '/api/tunnel/stop', { method: 'POST' });
      dispatch({ type: 'SET_TUNNEL', payload: { active: false, url: null } });
    } catch (err) {
      alert('Failed to stop tunnel: ' + err.message);
    }
  }

  async function updateEndpoints() {
    try {
      const res = await fetch(API + '/api/tunnel/update-webhooks', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) { alert('Failed: ' + (data.error || res.status)); return; }
      const lines = [];
      if (data.updated.length > 0) lines.push('Updated: ' + data.updated.join(', '));
      if (data.errors.length > 0) lines.push('Errors: ' + data.errors.map(e => e.name + ' \u2014 ' + e.error).join('; '));
      if (data.updated.length === 0 && data.errors.length === 0) lines.push('No SMS channels in webhook mode found.');
      alert(lines.join('\n'));
    } catch (e) { alert('Failed: ' + e.message); }
  }

  function openSetup() {
    setSetupOpen(true);
    fetch(API + '/api/tunnel/config')
      .then(r => r.json())
      .then(cfg => {
        if (cfg.token) setToken(cfg.token);
        if (cfg.public_url) setHostname(cfg.public_url.replace(/^https?:\/\//, ''));
        setHasClearable(!!cfg.token);
      })
      .catch(() => {});
  }

  async function saveConfig() {
    const t = token.trim();
    let h = hostname.trim();
    if (!t || !h) { alert('Both tunnel token and public hostname are required.'); return; }
    if (!h.startsWith('http')) h = 'https://' + h;
    const res = await fetch(API + '/api/tunnel/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t, public_url: h }),
    });
    if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed to save'); return; }
    dispatch({ type: 'SET_TUNNEL_HAS_TOKEN', payload: true });
    setSetupOpen(false);
    if (tunnelActive) {
      await fetch(API + '/api/tunnel/stop', { method: 'POST' });
      dispatch({ type: 'SET_TUNNEL', payload: { active: false, url: null } });
      alert('Token saved. Click Externalize again to connect with your stable URL.');
    } else {
      alert('Token saved. Click Externalize to connect with your stable URL.');
    }
  }

  async function clearConfig() {
    if (!confirm('Remove the tunnel token? The next Externalize will use a random URL.')) return;
    await fetch(API + '/api/tunnel/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: null, public_url: null }),
    });
    dispatch({ type: 'SET_TUNNEL_HAS_TOKEN', payload: false });
    setToken('');
    setHostname('');
    setSetupOpen(false);
  }

  async function toggleExpose(checked) {
    await fetch(API + '/api/tunnel/expose-dashboard', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: checked }),
    });
    dispatch({ type: 'SET_TUNNEL', payload: { exposeDashboard: checked } });
  }

  return (
    <>
      <div className="tunnel-bar active">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, flexWrap: 'wrap' }}>
          <span>Public URL:</span>
          <span className="tunnel-url" onClick={copyUrl} title="Click to copy">{tunnelUrl}</span>
          <button title="Copy URL" onClick={copyUrl} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', color: '#fff', display: 'inline-flex', alignItems: 'center' }}>
            <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 -960 960 960" fill="currentColor"><path d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" /></svg>
          </button>
          <span style={{ fontSize: 11, opacity: copied ? 1 : 0, transition: 'opacity 0.3s' }}>Copied!</span>
          <span style={{ flex: 1 }} />

          {tunnelHasToken ? (
            <span className="tunnel-has-token">
              <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="currentColor" style={{ verticalAlign: 'middle', marginRight: 3 }}><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm240-120q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Zm-120 480v-400 400Z" /></svg>
              Stable URL
            </span>
          ) : (
            <span className="tunnel-warn">
              <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="currentColor" style={{ verticalAlign: 'middle', marginRight: 3 }}><path d="m40-120 440-760 440 760H40Zm138-80h604L480-720 178-200Zm302-40q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm-40-120h80v-200h-80v200Zm40-100Z" /></svg>
              {' '}URL changes each restart.{' '}
              <a onClick={openSetup} style={{ color: '#fff', textDecoration: 'underline', cursor: 'pointer' }}>Set up stable URL</a>
              <button className="help-btn" onClick={() => setHelpOpen(true)} title="How to get a stable URL">
                <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 -960 960 960" fill="currentColor"><path d="M478-240q21 0 35.5-14.5T528-290q0-21-14.5-35.5T478-340q-21 0-35.5 14.5T428-290q0 21 14.5 35.5T478-240Zm-36-154h74q0-36 8-53t42-47q42-32 62.5-64t20.5-77q0-65-43.5-103.5T480-776q-69 0-114.5 38.5T312-636l66 26q7-37 33-61t69-24q38 0 63 21t25 57q0 26-14.5 47.5T510-516q-40 33-54 61t-14 61Z" /></svg>
              </button>
            </span>
          )}

          {!tunnelHasToken && hasSmsWebhookChannels && (
            <button onClick={updateEndpoints} style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', padding: '4px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="currentColor"><path d="M440-122q-121-15-200.5-105.5T160-440q0-66 26-126t72-104l57 57q-38 34-56.5 79T240-440q0 88 56 155.5T440-202v80Zm80 0v-80q87-15 143.5-82.5T720-440q0-100-70-170t-170-70h-3l44 44-56 56-140-140 140-140 56 57-44 43h3q134 0 227 93t93 227q0 121-79.5 211.5T520-122Z" /></svg>
              Update SMS endpoints
            </button>
          )}

          <label className="tunnel-toggle" title="Allow dashboard access from the external URL">
            <input type="checkbox" checked={tunnelExposeDashboard} onChange={e => toggleExpose(e.target.checked)} />
            <span>Dashboard access</span>
          </label>
          <button onClick={stopTunnel} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', padding: '4px 12px', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>Stop</button>
        </div>

        {setupOpen && (
          <div className="tunnel-setup open">
            <div style={{ opacity: 0.9 }}>For a stable URL, create a free <a href="https://one.dash.cloudflare.com" target="_blank" rel="noreferrer" style={{ color: '#fff' }}>Cloudflare Tunnel</a>, then paste the token and hostname below:</div>
            <div className="ts-row">
              <input value={token} onChange={e => setToken(e.target.value)} placeholder="Tunnel token (eyJh...)" style={{ flex: 2, minWidth: 200 }} />
              <input value={hostname} onChange={e => setHostname(e.target.value)} placeholder="Public hostname (e.g. channelkit.example.com)" style={{ flex: 1, minWidth: 180 }} />
            </div>
            <div className="ts-row">
              <button onClick={saveConfig} style={{ background: '#fff', color: '#1a7f37', fontWeight: 600 }}>Save</button>
              <button onClick={() => setSetupOpen(false)} style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }}>Cancel</button>
              {hasClearable && <button onClick={clearConfig} style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>Clear token</button>}
            </div>
          </div>
        )}
      </div>

      {/* Tunnel help modal */}
      {helpOpen && (
        <div className="help-overlay open" onClick={e => { if (e.target === e.currentTarget) setHelpOpen(false); }}>
          <div className="help-modal" role="dialog" aria-modal="true" aria-label="How to get a stable URL">
            <button className="help-close" onClick={() => setHelpOpen(false)} title="Close">
              <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 -960 960 960" fill="currentColor"><path d="M256-192 192-256l224-224-224-224 64-64 224 224 224-224 64 64-224 224 224 224-64 64-224-224-224 224Z" /></svg>
            </button>
            <h2>
              <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 -960 960 960" fill="currentColor" style={{ color: 'var(--accent)' }}><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm240-120q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Zm-120 480v-400 400Z" /></svg>
              {' '}Get a Stable Public URL
            </h2>
            <p className="help-sub">Use a free Cloudflare Tunnel to keep the same URL across restarts.</p>
            <div className="help-steps">
              {[
                ['Create a Cloudflare account', <>Go to <a href="https://one.dash.cloudflare.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>one.dash.cloudflare.com</a> and sign up for free.</>],
                ['Add your domain to Cloudflare', <>Click <strong>Add a site</strong>, choose <strong>Free</strong> plan, update nameservers at your registrar.</>],
                ['Create a tunnel', <>Go to <strong>Zero Trust &rarr; Networks &rarr; Connectors</strong>, click <strong>Create a tunnel</strong>, choose <code>Cloudflared</code>.</>],
                ['Copy the tunnel token', <>Copy the long token after <code>--token</code> (starts with <code>eyJh&hellip;</code>).</>],
                ['Add a public hostname', <>Point it to <code>localhost:4000</code> with HTTP service type.</>],
                ['Paste token & hostname here', <>Click <strong>Set up stable URL</strong>, paste, save, then <strong>Externalize</strong>.</>],
              ].map(([title, desc], i) => (
                <div className="help-step" key={i}>
                  <div className="help-step-num">{i + 1}</div>
                  <div className="help-step-body"><strong>{title}</strong><br />{desc}</div>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 18, fontSize: 12, color: 'var(--dim)' }}>The tunnel stays active as long as ChannelKit is running.</p>
          </div>
        </div>
      )}
    </>
  );
}
