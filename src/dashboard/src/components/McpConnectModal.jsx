import { useState, useEffect } from 'react';
import { API } from '../api.js';

const TRANSPORTS = [
  { id: 'http', label: 'Streamable HTTP', desc: 'Modern clients (Claude Code, Cursor, Windsurf)' },
  { id: 'sse', label: 'SSE', desc: 'Legacy clients (Antigravity, older SDKs)' },
  { id: 'stdio', label: 'stdio', desc: 'Claude Desktop, Cursor (via mcp-remote bridge)' },
];

function isHttp(url) {
  return url && url.startsWith('http://');
}

function buildConfig(transport, url, secret) {
  if (transport === 'stdio') {
    const args = ['-y', 'mcp-remote', url];
    if (isHttp(url)) args.push('--allow-http');
    if (secret) args.push('--header', `Authorization:Bearer ${secret}`);
    return {
      mcpServers: {
        channelkit: { command: 'npx', args },
      },
    };
  }

  const server = { url };
  if (secret) server.headers = { Authorization: `Bearer ${secret}` };
  return {
    mcpServers: {
      channelkit: server,
    },
  };
}

export default function McpConnectModal({ onClose }) {
  const [transport, setTransport] = useState('http');
  const [usePublic, setUsePublic] = useState(false);
  const [info, setInfo] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(API + '/api/mcp/connection-info')
      .then(r => r.json())
      .then(data => {
        setInfo(data);
        // Default to public URL when MCP is exposed via tunnel
        if (data.publicUrl) setUsePublic(true);
      })
      .catch(() => {});
  }, []);

  if (!info) return null;

  const hasPublic = !!info.publicUrl;
  const url = transport === 'sse'
    ? (usePublic && hasPublic ? info.publicSseUrl : info.localSseUrl)
    : (usePublic && hasPublic ? info.publicUrl : info.localUrl);

  const config = buildConfig(transport, url, info.secret);
  const json = JSON.stringify(config, null, 2);

  function copy() {
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-surface rounded-xl p-7 max-w-xl w-[90%] shadow-2xl relative"
        role="dialog"
        aria-modal="true"
        aria-label="MCP Connection Config"
      >
        <button
          className="absolute top-4 right-4 text-dim hover:text-text bg-transparent border-none cursor-pointer"
          onClick={onClose}
          title="Close"
        >
          <span className="material-symbols-outlined">close</span>
        </button>

        <h2 className="text-base font-semibold text-text flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined text-primary">integration_instructions</span>
          Connect to MCP
        </h2>
        <p className="text-xs text-dim mb-5">
          Copy the config below into your AI agent's MCP settings.
        </p>

        {/* Transport selector */}
        <div className="flex gap-2 mb-4">
          {TRANSPORTS.map(t => (
            <button
              key={t.id}
              onClick={() => setTransport(t.id)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                transport === t.id
                  ? 'bg-primary/10 text-primary border-primary/30'
                  : 'border-border text-dim hover:text-text hover:border-primary/30'
              }`}
              title={t.desc}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Transport description */}
        <p className="text-xs text-dim mb-3">
          {TRANSPORTS.find(t => t.id === transport)?.desc}
        </p>

        {/* URL toggle */}
        {hasPublic && (
          <div className="flex items-center gap-2 mb-3">
            <label className="flex items-center gap-2 text-xs text-dim cursor-pointer select-none">
              <input
                type="checkbox"
                checked={usePublic}
                onChange={e => setUsePublic(e.target.checked)}
                className="accent-primary"
              />
              Use public URL
            </label>
            {usePublic && (
              <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full font-medium">
                via tunnel
              </span>
            )}
          </div>
        )}

        {/* JSON config */}
        <div className="relative">
          <pre className="bg-bg-light border border-border rounded-lg p-4 text-xs font-mono text-text overflow-x-auto max-h-64 overflow-y-auto leading-relaxed">
            {json}
          </pre>
          <button
            onClick={copy}
            className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-surface border border-border text-dim hover:text-text hover:bg-bg-light transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[14px]">
              {copied ? 'check' : 'content_copy'}
            </span>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {/* Hints */}
        <div className="mt-4 space-y-2">
          {!info.secret && (
            <div className="flex items-start gap-2 text-xs text-orange">
              <span className="material-symbols-outlined text-[14px] mt-0.5">info</span>
              <span>No MCP secret configured. <a href="#settings" onClick={onClose} className="text-primary underline">Add one in Settings</a> to secure access.</span>
            </div>
          )}
          {transport === 'stdio' && (
            <div className="flex items-start gap-2 text-xs text-dim">
              <span className="material-symbols-outlined text-[14px] mt-0.5">info</span>
              <span>Requires <code className="bg-bg-light px-1 py-0.5 rounded text-[11px]">mcp-remote</code> package (auto-installed via npx).</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
