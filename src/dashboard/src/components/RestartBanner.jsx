import { useState } from 'react';
import { useAppState } from '../context.jsx';
import { API } from '../api.js';

export default function RestartBanner() {
  const { configChanged } = useAppState();
  const [status, setStatus] = useState('');
  const [restarting, setRestarting] = useState(false);

  if (!configChanged) return null;

  async function restart() {
    if (!confirm('Restart ChannelKit now?\n\nThe process will restart and the dashboard will reload automatically.')) return;
    setRestarting(true);
    setStatus('');
    try { await fetch(API + '/api/restart', { method: 'POST' }); } catch {}
    setStatus('Waiting for server\u2026');
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      if (attempts > 30) { clearInterval(poll); setStatus('Restart timed out \u2014 reload manually'); return; }
      try {
        const r = await fetch(API + '/api/health');
        if (r.ok) { clearInterval(poll); location.reload(); }
      } catch {}
    }, 1000);
  }

  return (
    <div className="restart-banner" style={{ display: 'block' }}>
      <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 -960 960 960" fill="currentColor" style={{ verticalAlign: 'middle', marginRight: 5 }}>
        <path d="m40-120 440-760 440 760H40Zm138-80h604L480-720 178-200Zm302-40q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm-40-120h80v-200h-80v200Zm40-100Z" />
      </svg>
      Config changed — restart ChannelKit to apply changes
      <button onClick={restart} disabled={restarting} style={{ marginLeft: 16, background: '#fff', color: '#9a6700', border: 'none', padding: '4px 12px', borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
        {restarting ? 'Restarting\u2026' : 'Restart Now'}
      </button>
      {status && <span style={{ marginLeft: 10, fontSize: 12 }}>{status}</span>}
    </div>
  );
}
