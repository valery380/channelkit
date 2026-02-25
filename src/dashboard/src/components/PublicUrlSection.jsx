import { useState } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API } from '../api.js';
import McpConnectModal from './McpConnectModal.jsx';

export default function PublicUrlSection() {
  const { tunnelActive, tunnelUrl, tunnelHasToken, hasSmsWebhookChannels, tunnelExposeDashboard, mcpActive, mcpExpose, mcpHasSecret, mcpUrl: mcpLocalUrl } = useAppState();
  const dispatch = useDispatch();
  const [copiedField, setCopiedField] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [token, setToken] = useState('');
  const [hostname, setHostname] = useState('');
  const [hasClearable, setHasClearable] = useState(false);

  if (!tunnelActive || !tunnelUrl) return null;

  const dashboardUrl = tunnelUrl + '/dashboard';
  const mcpPublicUrl = tunnelUrl + '/mcp';
  const mcpDisplayUrl = mcpExpose ? mcpPublicUrl : mcpLocalUrl;

  function copyText(text, field) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    });
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

  async function toggleExposeMcp(checked) {
    await fetch(API + '/api/mcp/expose', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: checked }),
    });
    dispatch({ type: 'SET_MCP', payload: { exposeMcp: checked } });
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-surface shadow-sm divide-y divide-border">
        {/* Public URL row */}
        <div className="flex items-center gap-4 px-5 h-14">
          <span className="text-dim text-sm font-medium w-28 shrink-0">Public URL</span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase shrink-0 ${
            tunnelHasToken
              ? 'bg-primary/10 text-primary'
              : 'bg-orange-light text-orange'
          }`}>
            {tunnelHasToken ? 'Stable' : 'Temporary'}
          </span>
          <span className="text-text text-sm font-mono truncate flex-1 min-w-0">{tunnelUrl}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => copyText(tunnelUrl, 'url')}
              className="flex items-center justify-center rounded-lg h-8 w-8 bg-bg-light text-dim border border-border hover:bg-border transition-colors"
              title="Copy URL"
            >
              <span className="material-symbols-outlined text-[18px]">{copiedField === 'url' ? 'check' : 'content_copy'}</span>
            </button>
            <a
              href={tunnelUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center rounded-lg h-8 w-8 bg-bg-light text-dim border border-border hover:bg-border transition-colors"
              title="Open URL"
            >
              <span className="material-symbols-outlined text-[18px]">open_in_new</span>
            </a>
          </div>
        </div>

        {/* Dashboard Access row */}
        <div className="flex items-center gap-4 px-5 h-14">
          <span className="text-dim text-sm font-medium w-28 shrink-0">Dashboard</span>
          <input
            type="checkbox"
            className="toggle-switch-sm shrink-0"
            checked={tunnelExposeDashboard}
            onChange={e => toggleExpose(e.target.checked)}
          />
          {tunnelExposeDashboard ? (
            <>
              <span className="text-text text-sm font-mono truncate flex-1 min-w-0">{dashboardUrl}</span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => copyText(dashboardUrl, 'dashboard')}
                  className="flex items-center justify-center rounded-lg h-8 w-8 bg-bg-light text-dim border border-border hover:bg-border transition-colors"
                  title="Copy dashboard URL"
                >
                  <span className="material-symbols-outlined text-[18px]">{copiedField === 'dashboard' ? 'check' : 'content_copy'}</span>
                </button>
                <a
                  href={dashboardUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center rounded-lg h-8 w-8 bg-bg-light text-dim border border-border hover:bg-border transition-colors"
                  title="Open dashboard"
                >
                  <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                </a>
              </div>
            </>
          ) : (
            <span className="text-dim/50 text-sm italic flex-1">Disabled</span>
          )}
        </div>

        {/* MCP Access row */}
        {mcpActive && (
          <div className="flex flex-col">
            <div className="flex items-center gap-4 px-5 h-14">
              <span className="text-dim text-sm font-medium w-28 shrink-0">MCP</span>
              <input
                type="checkbox"
                className="toggle-switch-sm shrink-0"
                checked={mcpExpose}
                onChange={e => toggleExposeMcp(e.target.checked)}
                style={{ width: 36, height: 20 }}
              />
              <span className="text-text text-sm font-mono truncate flex-1 min-w-0">{mcpDisplayUrl}</span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => copyText(mcpDisplayUrl, 'mcp')}
                  className="flex items-center justify-center rounded-lg h-8 w-8 bg-bg-light text-dim border border-border hover:bg-border transition-colors"
                  title="Copy MCP URL"
                >
                  <span className="material-symbols-outlined text-[18px]">{copiedField === 'mcp' ? 'check' : 'content_copy'}</span>
                </button>
                <button
                  onClick={() => setConnectOpen(true)}
                  className="flex items-center justify-center rounded-lg h-8 w-8 bg-bg-light text-dim border border-border hover:bg-border transition-colors"
                  title="Connection config"
                >
                  <span className="material-symbols-outlined text-[18px]">integration_instructions</span>
                </button>
              </div>
            </div>
            {!mcpHasSecret && (
              <div className="flex items-center gap-2 px-5 pb-3 text-xs text-orange">
                <span className="material-symbols-outlined text-[16px]">warning</span>
                <span>MCP is accessible without authentication. <a href="#settings" className="text-primary underline">Add a secret</a> in Settings to secure it.</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stable URL warning & SMS update - below the box */}
      {(!tunnelHasToken || (!tunnelHasToken && hasSmsWebhookChannels)) && (
        <div className="flex items-center gap-3 flex-wrap text-xs text-dim mt-2">
          {!tunnelHasToken && (
            <>
              <span className="material-symbols-outlined text-[16px] text-yellow">warning</span>
              <span>URL changes each restart.</span>
              <button onClick={openSetup} className="text-primary underline cursor-pointer bg-transparent border-none text-xs">
                Set up stable URL
              </button>
              <button onClick={() => setHelpOpen(true)} className="text-dim hover:text-text bg-transparent border-none cursor-pointer p-0">
                <span className="material-symbols-outlined text-[16px]">help</span>
              </button>
            </>
          )}
          {!tunnelHasToken && hasSmsWebhookChannels && (
            <button
              onClick={updateEndpoints}
              className="flex items-center gap-1 text-xs text-dim border border-border rounded-lg px-2 py-1 hover:bg-bg-light transition-colors bg-transparent cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">sync</span>
              Update SMS endpoints
            </button>
          )}
        </div>
      )}

      {/* Setup Form */}
      {setupOpen && (
        <div className="bg-surface border border-border rounded-xl p-5 shadow-sm space-y-3 mt-3">
          <p className="text-sm text-dim">
            For a stable URL, create a free{' '}
            <a href="https://one.dash.cloudflare.com" target="_blank" rel="noreferrer" className="text-primary underline">
              Cloudflare Tunnel
            </a>
            , then paste the token and hostname below:
          </p>
          <div className="flex gap-3 flex-wrap">
            <input
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="Tunnel token (eyJh...)"
              className="flex-[2] min-w-[200px] px-3 py-2 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary"
            />
            <input
              value={hostname}
              onChange={e => setHostname(e.target.value)}
              placeholder="Public hostname (e.g. channelkit.example.com)"
              className="flex-1 min-w-[180px] px-3 py-2 border border-border rounded-lg text-sm bg-bg-light text-text focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={saveConfig} className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white hover:bg-primary-hover transition-colors">
              Save
            </button>
            <button onClick={() => setSetupOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-dim hover:bg-bg-light transition-colors">
              Cancel
            </button>
            {hasClearable && (
              <button onClick={clearConfig} className="px-4 py-2 rounded-lg text-sm font-medium text-red border border-border hover:bg-red-light transition-colors">
                Clear token
              </button>
            )}
          </div>
        </div>
      )}

      {connectOpen && <McpConnectModal onClose={() => setConnectOpen(false)} />}

      {/* Help Modal */}
      {helpOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={e => { if (e.target === e.currentTarget) setHelpOpen(false); }}>
          <div className="bg-surface rounded-xl p-7 max-w-lg w-[90%] shadow-2xl relative" role="dialog" aria-modal="true" aria-label="How to get a stable URL">
            <button
              className="absolute top-4 right-4 text-dim hover:text-text bg-transparent border-none cursor-pointer"
              onClick={() => setHelpOpen(false)}
              title="Close"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            <h2 className="text-base font-semibold text-text flex items-center gap-2 mb-1">
              <span className="material-symbols-outlined text-primary">lock</span>
              Get a Stable Public URL
            </h2>
            <p className="text-sm text-dim mb-5">Use a free Cloudflare Tunnel to keep the same URL across restarts.</p>
            <div className="flex flex-col gap-4">
              {[
                ['Create a Cloudflare account', <>Go to <a href="https://one.dash.cloudflare.com" target="_blank" rel="noreferrer" className="text-primary">one.dash.cloudflare.com</a> and sign up for free.</>],
                ['Add your domain to Cloudflare', <>Click <strong>Add a site</strong>, choose <strong>Free</strong> plan, update nameservers at your registrar.</>],
                ['Create a tunnel', <>Go to <strong>Zero Trust &rarr; Networks &rarr; Connectors</strong>, click <strong>Create a tunnel</strong>, choose <code className="bg-bg-light px-1 py-0.5 rounded text-xs font-mono">Cloudflared</code>.</>],
                ['Copy the tunnel token', <>Copy the long token after <code className="bg-bg-light px-1 py-0.5 rounded text-xs font-mono">--token</code> (starts with <code className="bg-bg-light px-1 py-0.5 rounded text-xs font-mono">eyJh&hellip;</code>).</>],
                ['Add a public hostname', <>Point it to <code className="bg-bg-light px-1 py-0.5 rounded text-xs font-mono">localhost:4000</code> with HTTP service type.</>],
                ['Paste token & hostname here', <>Click <strong>Set up stable URL</strong>, paste, save, then <strong>Externalize</strong>.</>],
              ].map(([title, desc], i) => (
                <div className="flex gap-3 items-start" key={i}>
                  <div className="min-w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</div>
                  <div className="text-sm leading-relaxed"><strong className="text-text">{title}</strong><br />{desc}</div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-xs text-dim">The tunnel stays active as long as ChannelKit is running.</p>
          </div>
        </div>
      )}
    </>
  );
}
