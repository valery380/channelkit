import { useState, useEffect } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API, apiFetch } from '../api.js';

export default function Header() {
  const { wsConnected, tunnelActive, tunnelUrl, mcpActive, mcpUrl } = useAppState();
  const dispatch = useDispatch();
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [toast, setToast] = useState(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function toggleTunnel() {
    setTunnelLoading(true);
    try {
      if (tunnelActive) {
        await apiFetch(API + '/api/tunnel/stop', { method: 'POST' });
        dispatch({ type: 'SET_TUNNEL', payload: { active: false, url: null } });
      } else {
        const res = await apiFetch(API + '/api/tunnel/start', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          dispatch({ type: 'SET_TUNNEL', payload: { active: true, url: data.url } });
        } else {
          alert('Failed to start tunnel: ' + (data.error || 'Unknown error'));
        }
      }
    } catch (err) {
      alert('Tunnel error: ' + err.message);
    } finally {
      setTunnelLoading(false);
    }
  }

  async function toggleMcp() {
    setMcpLoading(true);
    try {
      if (mcpActive) {
        await apiFetch(API + '/api/mcp/stop', { method: 'POST' });
        dispatch({ type: 'SET_MCP', payload: { active: false, url: null } });
      } else {
        const res = await apiFetch(API + '/api/mcp/start', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          dispatch({ type: 'SET_MCP', payload: { active: true, url: data.url } });
          setToast(`MCP server is running on ${data.url}`);
        } else {
          alert('Failed to start MCP: ' + (data.error || 'Unknown error'));
        }
      }
    } catch (err) {
      alert('MCP error: ' + err.message);
    } finally {
      setMcpLoading(false);
    }
  }

  return (
    <>
      <header className="flex items-center justify-between whitespace-nowrap border-b border-border bg-surface px-6 lg:px-10 py-3">
        <div className="flex items-center gap-8">
          {/* Logo */}
          <div className="flex items-center gap-3 text-primary">
            <div className="size-8 flex items-center justify-center bg-primary/10 rounded-lg">
              <span className="material-symbols-outlined text-primary">hub</span>
            </div>
            <h2 className="text-text text-lg font-bold leading-tight tracking-tight">ChannelKit</h2>
          </div>

          {/* Live Badge */}
          <div className={`hidden md:flex items-center gap-2 px-3 py-1 rounded-full border ${
            wsConnected
              ? 'bg-green-light text-green border-green/20'
              : 'bg-red-light text-red border-red/20'
          }`}>
            <span className="relative flex h-2 w-2">
              {wsConnected && (
                <span className="animate-ping-dot absolute inline-flex h-full w-full rounded-full bg-green opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${wsConnected ? 'bg-green' : 'bg-red'}`} />
            </span>
            <span className="text-xs font-bold uppercase tracking-wider">
              {wsConnected ? 'Live' : 'Offline'}
            </span>
          </div>

        </div>

        <div className="flex items-center gap-4">
          {/* MCP toggle */}
          <label className={`hidden sm:flex items-center gap-2 px-4 h-9 rounded-lg text-sm font-medium cursor-pointer select-none transition-colors ${
            mcpActive
              ? 'bg-primary/10 text-primary border border-primary/30'
              : 'border border-border text-dim hover:text-primary hover:border-primary'
          } ${mcpLoading ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <input
              type="checkbox"
              checked={mcpActive}
              onChange={toggleMcp}
              disabled={mcpLoading}
              className="accent-primary"
            />
            <span>MCP</span>
          </label>

          {/* Externalize toggle */}
          <label className={`hidden sm:flex items-center gap-2 px-4 h-9 rounded-lg text-sm font-medium cursor-pointer select-none transition-colors ${
            tunnelActive
              ? 'bg-primary/10 text-primary border border-primary/30'
              : 'border border-border text-dim hover:text-primary hover:border-primary'
          } ${tunnelLoading ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <input
              type="checkbox"
              checked={tunnelActive}
              onChange={toggleTunnel}
              disabled={tunnelLoading}
              className="accent-primary"
            />
            <span>External</span>
          </label>

        </div>
      </header>

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-surface border border-primary/30 rounded-xl shadow-lg animate-slide-up">
          <span className="material-symbols-outlined text-primary text-[20px]">check_circle</span>
          <span className="text-sm text-text">{toast}</span>
          <button onClick={() => setToast(null)} className="text-dim hover:text-text ml-2">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}
    </>
  );
}
