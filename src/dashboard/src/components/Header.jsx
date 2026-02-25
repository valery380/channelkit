import { useState } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API } from '../api.js';
import { formatUptime } from '../utils.jsx';

export default function Header() {
  const { stats, wsConnected, tunnelActive, tunnelUrl } = useAppState();
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
    <header>
      <h1>
        <svg xmlns="http://www.w3.org/2000/svg" height="26" width="26" viewBox="0 -960 960 960" fill="currentColor" style={{ verticalAlign: 'middle', marginRight: 6 }}>
          <path d="M480-80q-33 0-56.5-23.5T400-160q0-23 11-42t29-30v-108h-80q-33 0-56.5-23.5T280-420v-80q-23-11-34.5-29.5T234-570q-2-33 19.5-56.5T309-650q33 0 56.5 23.5T389-570q0 23-11.5 41.5T348-500v80h264v-80q-18-10-29.5-28.5T571-570q0-33 23.5-56.5T651-650q33 0 54.5 23.5T727-570q0 23-11.5 41.5T686-500v80q0 33-23.5 56.5T606-340h-86v108q18 11 29 30t11 42q0 33-23.5 56.5T480-80ZM480-760q-33 0-56.5-23.5T400-840q0-33 23.5-56.5T480-920q33 0 56.5 23.5T560-840q0 33-23.5 56.5T480-760Z" />
        </svg>
        <span>ChannelKit</span> Dashboard
      </h1>
      <div className="stats">
        <div className="stat">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Messages</div>
        </div>
        <div className="stat">
          <div className="stat-value" style={{ color: 'var(--red)' }}>{stats.errorCount || 0}</div>
          <div className="stat-label">Errors</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats.avgLatency}ms</div>
          <div className="stat-label">Avg Latency</div>
        </div>
        <div className="stat">
          <div className="stat-value">{formatUptime(stats.uptime)}</div>
          <div className="stat-label">Uptime</div>
        </div>
        <div className="stat">
          <button
            className={`btn-tunnel${tunnelActive ? ' active' : ''}`}
            onClick={toggleTunnel}
            disabled={tunnelLoading}
            title="Start/stop public access via cloudflared tunnel"
          >
            <span>
              <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 -960 960 960" fill="currentColor" style={{ verticalAlign: 'middle' }}>
                <path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm-40-82v-78q-33 0-56.5-23.5T360-320v-40L168-552q-3 18-5.5 36t-2.5 36q0 121 79.5 212T440-162Zm276-102q20-22 36-47.5t26.5-53q10.5-27.5 16-56.5t5.5-59q0-98-54.5-179.5T600-776v16q0 33-23.5 56.5T520-680h-80v80q0 17-11.5 28.5T400-560h-80v80h240q17 0 28.5 11.5T600-440v120h40q26 0 47 15.5t29 40.5Z" />
              </svg>
            </span>
            <span>
              {tunnelLoading ? (tunnelActive ? 'Stopping\u2026' : 'Starting\u2026') : (tunnelActive ? 'External' : 'Externalize')}
            </span>
          </button>
        </div>
        <div className="stat">
          <span className={`badge ${wsConnected ? 'badge-live' : ''}`} style={!wsConnected ? { background: 'var(--red)' } : undefined}>
            {wsConnected ? '\u25CF LIVE' : '\u25CF OFFLINE'}
          </span>
        </div>
      </div>
    </header>
  );
}
