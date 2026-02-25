import { useState } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API } from '../api.js';

export default function Header() {
  const { wsConnected, tunnelActive, tunnelUrl } = useAppState();
  const dispatch = useDispatch();
  const [tunnelLoading, setTunnelLoading] = useState(false);

  async function toggleTunnel() {
    setTunnelLoading(true);
    try {
      if (tunnelActive) {
        await fetch(API + '/api/tunnel/stop', { method: 'POST' });
        dispatch({ type: 'SET_TUNNEL', payload: { active: false, url: null } });
      } else {
        const res = await fetch(API + '/api/tunnel/start', { method: 'POST' });
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

  return (
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

        {/* Search */}
        <label className="hidden md:flex flex-col min-w-40 h-9 max-w-64">
          <div className="flex w-full flex-1 items-stretch rounded-lg h-full border border-border">
            <div className="text-dim flex items-center justify-center pl-3 rounded-l-lg bg-bg-light">
              <span className="material-symbols-outlined text-[20px]">search</span>
            </div>
            <input
              className="flex w-full min-w-0 flex-1 border-none bg-bg-light text-text focus:ring-0 focus:outline-none text-sm placeholder:text-dim px-3"
              placeholder="Search logs..."
            />
          </div>
        </label>
      </div>

      <div className="flex items-center gap-4">
        {/* Externalize button */}
        <button
          onClick={toggleTunnel}
          disabled={tunnelLoading}
          className={`hidden sm:flex items-center gap-2 px-4 h-9 rounded-lg text-sm font-medium transition-colors ${
            tunnelActive
              ? 'bg-green text-white hover:bg-green/90'
              : 'border border-border text-dim hover:text-primary hover:border-primary'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <span className="material-symbols-outlined text-[18px]">public</span>
          <span>
            {tunnelLoading
              ? (tunnelActive ? 'Stopping\u2026' : 'Starting\u2026')
              : (tunnelActive ? 'External' : 'Externalize')}
          </span>
        </button>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button className="flex size-9 cursor-pointer items-center justify-center rounded-lg bg-bg-light text-dim hover:bg-border transition-colors">
            <span className="material-symbols-outlined text-[20px]">notifications</span>
          </button>
          <button className="flex size-9 cursor-pointer items-center justify-center rounded-lg bg-bg-light text-dim hover:bg-border transition-colors">
            <span className="material-symbols-outlined text-[20px]">add</span>
          </button>
          <div className="h-9 w-9 rounded-full bg-primary/10 border border-primary/20 overflow-hidden flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-[20px]">person</span>
          </div>
        </div>
      </div>
    </header>
  );
}
