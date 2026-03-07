import { useState } from 'react';
import { useAppState } from '../context.jsx';
import { API, apiFetch } from '../api.js';

export default function RestartBanner() {
  const { configChanged } = useAppState();
  const [status, setStatus] = useState('');
  const [restarting, setRestarting] = useState(false);

  if (!configChanged) return null;

  async function restart() {
    if (!confirm('Restart ChannelKit now?\n\nThe process will restart and the dashboard will reload automatically.')) return;
    setRestarting(true);
    setStatus('');
    try { await apiFetch(API + '/api/restart', { method: 'POST' }); } catch {}
    setStatus('Waiting for server\u2026');
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      if (attempts > 30) { clearInterval(poll); setStatus('Restart timed out \u2014 reload manually'); return; }
      try {
        const r = await apiFetch(API + '/api/health');
        if (r.ok) { clearInterval(poll); location.reload(); }
      } catch {}
    }, 1000);
  }

  return (
    <div className="bg-yellow-light border border-yellow/20 text-yellow rounded-xl p-4 flex items-center gap-3 text-sm font-medium">
      <span className="material-symbols-outlined text-[20px]">warning</span>
      <span className="flex-1">Config changed — restart ChannelKit to apply changes</span>
      <button
        onClick={restart}
        disabled={restarting}
        className="px-4 py-1.5 bg-yellow text-white rounded-lg text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {restarting ? 'Restarting\u2026' : 'Restart Now'}
      </button>
      {status && <span className="text-xs">{status}</span>}
    </div>
  );
}
