import { useState, useEffect, useCallback } from 'react';
import { useDispatch, useAppState } from './context.jsx';
import { useWebSocket } from './hooks/useWebSocket.js';
import { useStats } from './hooks/useStats.js';
import { API, apiFetch, getToken, setToken, clearToken } from './api.js';
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
import WelcomeDialog from './components/WelcomeDialog.jsx';

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

function LoginScreen({ onLogin }) {
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setChecking(true);
    setError('');
    try {
      const res = await fetch(API + '/api/auth/check', {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const data = await res.json();
      if (data.valid) {
        setToken(secret);
        onLogin();
      } else {
        setError('Invalid secret');
      }
    } catch {
      setError('Connection failed');
    }
    setChecking(false);
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-bg-light">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-bg p-8 shadow-lg">
        <h1 className="text-xl font-semibold text-text">ChannelKit</h1>
        <p className="text-sm text-text-muted">Enter the API secret to access the dashboard.</p>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="api_secret"
          autoFocus
          className="w-full rounded-lg border border-border bg-bg-light px-3 py-2 text-sm text-text outline-none focus:border-accent"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={checking || !secret}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {checking ? 'Checking...' : 'Login'}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState(getHash);
  const [sendOpen, setSendOpen] = useState(false);
  const [authState, setAuthState] = useState('checking'); // 'checking' | 'login' | 'ok'
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const dispatch = useDispatch();
  const state = useAppState();

  // Check if auth is required on mount
  useEffect(() => {
    const token = getToken();
    fetch(API + '/api/auth/check', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(data => {
        if (!data.required) {
          setAuthState('ok');
        } else if (data.valid) {
          setAuthState('ok');
        } else {
          clearToken();
          setAuthState('login');
        }
      })
      .catch(() => setAuthState('ok')); // If server unreachable, show dashboard (will reconnect)
  }, []);

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
    if (!state.wsConnected || authState !== 'ok') return;

    // Twilio defaults
    apiFetch(API + '/api/settings/twilio-defaults')
      .then(r => r.json())
      .then(d => dispatch({ type: 'SET_TWILIO_DEFAULTS', payload: { sid: d.account_sid || '', tok: d.auth_token || '' } }))
      .catch(() => {});

    // Config for SMS webhook detection
    apiFetch(API + '/api/config')
      .then(r => r.json())
      .then(data => {
        if (data.channels) {
          dispatch({ type: 'SET_CONFIG', payload: { channels: data.channels, services: data.services } });
        }
      })
      .catch(() => {});

    // Tunnel state
    apiFetch(API + '/api/tunnel/status')
      .then(r => r.json())
      .then(s => dispatch({ type: 'SET_TUNNEL', payload: { active: s.active, url: s.url } }))
      .catch(() => {});

    // MCP state
    apiFetch(API + '/api/mcp/status')
      .then(r => r.json())
      .then(s => dispatch({ type: 'SET_MCP', payload: { active: s.active, url: s.url, exposeMcp: s.exposeMcp, hasSecret: s.hasSecret } }))
      .catch(() => {});

    apiFetch(API + '/api/tunnel/config')
      .then(r => r.json())
      .then(cfg => {
        dispatch({ type: 'SET_TUNNEL_HAS_TOKEN', payload: !!cfg.token });
        if (cfg.expose_dashboard !== undefined) {
          dispatch({ type: 'SET_TUNNEL', payload: { exposeDashboard: cfg.expose_dashboard } });
        }
      })
      .catch(() => {});
  }, [state.wsConnected, authState, dispatch]);

  // Reload config when configChanged is set via WebSocket
  useEffect(() => {
    if (!state.configChanged) return;
    apiFetch(API + '/api/config')
      .then(r => r.json())
      .then(data => {
        dispatch({ type: 'SET_CONFIG', payload: { channels: data.channels, services: data.services } });
      })
      .catch(() => {});
  }, [state.configChanged, dispatch]);

  const loadConfig = useCallback(() => {
    return apiFetch(API + '/api/config')
      .then(r => r.json())
      .then(data => {
        dispatch({ type: 'SET_CONFIG', payload: { channels: data.channels || {}, services: data.services || {} } });
      })
      .catch(() => {});
  }, [dispatch]);

  if (authState === 'checking') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-bg-light text-text-muted">
        Loading...
      </div>
    );
  }

  if (authState === 'login') {
    return <LoginScreen onLogin={() => setAuthState('ok')} />;
  }

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
      {!welcomeDismissed && (
        <WelcomeDialog onNavigate={(hash) => {
          if (hash) {
            window.location.hash = hash;
          }
          setWelcomeDismissed(true);
        }} />
      )}
    </div>
  );
}
