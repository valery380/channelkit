import { useState, useEffect, useCallback } from 'react';
import { useDispatch, useAppState } from './context.jsx';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useStats } from './hooks/useStats.js';
import { API } from './api.js';
import Header from './components/Header.jsx';
import StatsGrid from './components/StatsGrid.jsx';
import PublicUrlSection from './components/PublicUrlSection.jsx';
import RestartBanner from './components/RestartBanner.jsx';
import Tabs from './components/Tabs.jsx';
import Logs from './components/Logs.jsx';
import Services from './components/Services.jsx';
import Channels from './components/Channels.jsx';
import ServerLogs from './components/ServerLogs.jsx';
import Settings from './components/Settings.jsx';
import SendModal from './components/SendModal.jsx';
import Footer from './components/Footer.jsx';

const TABS = [
  { hash: '#logs', label: 'Messages', icon: 'chat' },
  { hash: '#services', label: 'Services', icon: 'dns' },
  { hash: '#channels', label: 'Channels', icon: 'alt_route' },
  { hash: '#server-logs', label: 'Server Log', icon: 'terminal' },
  { hash: '#settings', label: 'Settings', icon: 'settings' },
];

function getHash() {
  return window.location.hash || '#logs';
}

export default function App() {
  const [tab, setTab] = useState(getHash);
  const [sendOpen, setSendOpen] = useState(false);
  const dispatch = useDispatch();
  const state = useAppState();

  useWebSocket(dispatch);
  useStats(dispatch);

  // Hash routing
  useEffect(() => {
    const onHash = () => setTab(getHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Load/reload data on mount and on WebSocket reconnect (e.g. after server restart)
  useEffect(() => {
    if (!state.wsConnected) return;

    // Twilio defaults
    fetch(API + '/api/settings/twilio-defaults')
      .then(r => r.json())
      .then(d => dispatch({ type: 'SET_TWILIO_DEFAULTS', payload: { sid: d.account_sid || '', tok: d.auth_token || '' } }))
      .catch(() => {});

    // Config for SMS webhook detection
    fetch(API + '/api/config')
      .then(r => r.json())
      .then(data => {
        if (data.channels) {
          dispatch({ type: 'SET_CONFIG', payload: { channels: data.channels, services: data.services } });
        }
      })
      .catch(() => {});

    // Tunnel state
    fetch(API + '/api/tunnel/status')
      .then(r => r.json())
      .then(s => dispatch({ type: 'SET_TUNNEL', payload: { active: s.active, url: s.url } }))
      .catch(() => {});

    // MCP state
    fetch(API + '/api/mcp/status')
      .then(r => r.json())
      .then(s => dispatch({ type: 'SET_MCP', payload: { active: s.active, url: s.url, exposeMcp: s.exposeMcp, hasSecret: s.hasSecret } }))
      .catch(() => {});

    fetch(API + '/api/tunnel/config')
      .then(r => r.json())
      .then(cfg => {
        dispatch({ type: 'SET_TUNNEL_HAS_TOKEN', payload: !!cfg.token });
        if (cfg.expose_dashboard !== undefined) {
          dispatch({ type: 'SET_TUNNEL', payload: { exposeDashboard: cfg.expose_dashboard } });
        }
      })
      .catch(() => {});
  }, [state.wsConnected, dispatch]);

  // Reload config when configChanged is set via WebSocket
  useEffect(() => {
    if (!state.configChanged) return;
    fetch(API + '/api/config')
      .then(r => r.json())
      .then(data => {
        dispatch({ type: 'SET_CONFIG', payload: { channels: data.channels, services: data.services } });
      })
      .catch(() => {});
  }, [state.configChanged, dispatch]);

  const loadConfig = useCallback(() => {
    return fetch(API + '/api/config')
      .then(r => r.json())
      .then(data => {
        dispatch({ type: 'SET_CONFIG', payload: { channels: data.channels || {}, services: data.services || {} } });
      })
      .catch(() => {});
  }, [dispatch]);

  let page;
  switch (tab) {
    case '#services':
      page = <Services loadConfig={loadConfig} />;
      break;
    case '#channels':
      page = <Channels loadConfig={loadConfig} />;
      break;
    case '#server-logs':
      page = <ServerLogs />;
      break;
    case '#settings':
      page = <Settings />;
      break;
    default:
      page = <Logs onSend={() => setSendOpen(true)} />;
  }

  return (
    <div className="relative flex h-auto min-h-screen w-full flex-col overflow-x-hidden bg-bg-light text-text">
      <Header />
      <main className="flex-1 flex flex-col items-center px-6 lg:px-10 py-6">
        <div className="w-full max-w-7xl space-y-6">
          <StatsGrid />
          <RestartBanner />
          <PublicUrlSection />
          <Tabs tabs={TABS} active={tab} />
          {page}
        </div>
      </main>
      <Footer />
      {sendOpen && <SendModal onClose={() => setSendOpen(false)} />}
    </div>
  );
}
