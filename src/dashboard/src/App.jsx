import { useState, useEffect, useCallback } from 'react';
import { useDispatch, useAppState } from './context.jsx';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useStats } from './hooks/useStats.js';
import { API } from './api.js';
import Header from './components/Header.jsx';
import TunnelBar from './components/TunnelBar.jsx';
import RestartBanner from './components/RestartBanner.jsx';
import Tabs from './components/Tabs.jsx';
import Logs from './components/Logs.jsx';
import Services from './components/Services.jsx';
import Channels from './components/Channels.jsx';
import ServerLogs from './components/ServerLogs.jsx';
import Settings from './components/Settings.jsx';
import SendModal from './components/SendModal.jsx';

const TABS = [
  { hash: '#logs', label: 'Messages' },
  { hash: '#services', label: 'Services' },
  { hash: '#channels', label: 'Channels' },
  { hash: '#server-logs', label: 'Server Log' },
  { hash: '#settings', label: 'Settings' },
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

  // Load initial data
  useEffect(() => {
    // Twilio defaults
    fetch(API + '/api/settings/twilio-defaults')
      .then(r => r.json())
      .then(d => dispatch({ type: 'SET_TWILIO_DEFAULTS', payload: { sid: d.account_sid || '', tok: d.auth_token || '' } }))
      .catch(() => {});

    // Initial config for SMS webhook detection
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

    fetch(API + '/api/tunnel/config')
      .then(r => r.json())
      .then(cfg => {
        dispatch({ type: 'SET_TUNNEL_HAS_TOKEN', payload: !!cfg.token });
        if (cfg.expose_dashboard !== undefined) {
          dispatch({ type: 'SET_TUNNEL', payload: { exposeDashboard: cfg.expose_dashboard } });
        }
      })
      .catch(() => {});
  }, [dispatch]);

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
    <>
      <Header />
      <TunnelBar />
      <RestartBanner />
      <Tabs tabs={TABS} active={tab} />
      <div id="app">{page}</div>
      {sendOpen && <SendModal onClose={() => setSendOpen(false)} />}
    </>
  );
}
