import { useState, useEffect } from 'react';
import { apiFetch, API } from '../api';

export default function UpdateBanner() {
  const [update, setUpdate] = useState(null);

  useEffect(() => {
    checkUpdate();
    // Re-check every 30 minutes
    const timer = setInterval(checkUpdate, 30 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  async function checkUpdate() {
    try {
      const res = await apiFetch(API + '/api/update/status');
      const data = await res.json();
      if (data.updateAvailable) {
        setUpdate(data);
      } else {
        setUpdate(null);
      }
    } catch {}
  }

  if (!update) return null;

  const cmd = update.mode === 'npm'
    ? 'npm update -g @dirbalak/channelkit'
    : 'git pull && npm run build';

  return (
    <div className="bg-primary/10 border border-primary/30 rounded-xl px-5 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="text-lg">🆕</span>
        <div>
          <span className="text-sm font-semibold text-text">
            Update available: {update.currentVersion} → {update.latestVersion}
          </span>
          <p className="text-xs text-dim mt-0.5">
            Auto-update is off. Run: <code className="bg-surface px-1.5 py-0.5 rounded text-[11px] font-mono">{cmd}</code>
          </p>
        </div>
      </div>
      <button
        onClick={() => setUpdate(null)}
        className="text-dim hover:text-text text-lg bg-transparent border-none cursor-pointer"
      >
        ✕
      </button>
    </div>
  );
}
