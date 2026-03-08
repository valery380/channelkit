import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API, apiFetch } from '../api.js';
import { formatTime, formatDate, truncate, shortUrl, channelIcons } from '../utils.jsx';

const PAGE_SIZE = 25;

function StatusBadge({ status }) {
  if (status === 'success')
    return (
      <div className="flex items-center gap-1.5 text-green">
        <span className="material-symbols-outlined text-[18px]">check_circle</span>
        <span className="text-xs font-bold">200 OK</span>
      </div>
    );
  if (status === 'error')
    return (
      <div className="flex items-center gap-1.5 text-red">
        <span className="material-symbols-outlined text-[18px]">error</span>
        <span className="text-xs font-bold">Error</span>
      </div>
    );
  if (status === 'format-error')
    return (
      <div className="flex items-center gap-1.5 text-red">
        <span className="material-symbols-outlined text-[18px]">format_color_reset</span>
        <span className="text-xs font-bold">Format Error</span>
      </div>
    );
  if (status === 'blocked')
    return (
      <div className="flex items-center gap-1.5 text-yellow">
        <span className="material-symbols-outlined text-[18px]">block</span>
        <span className="text-xs font-bold">Blocked</span>
      </div>
    );
  return (
    <div className="flex items-center gap-1.5 text-orange">
      <span className="material-symbols-outlined text-[18px]">pending</span>
      <span className="text-xs font-bold">Processing</span>
    </div>
  );
}

/** Extract a readable phone number from a JID like "306947976772@s.whatsapp.net" → "+306947976772" */
function toPhoneNumber(sender) {
  const digits = sender.replace(/@.*$/, '').replace(/[^0-9]/g, '');
  return digits ? '+' + digits : sender;
}

function AllowActions({ entry, onToast }) {
  const [adding, setAdding] = useState(null);
  const [done, setDone] = useState(false);
  const { channels, services } = useAppState();

  const phoneNumber = toPhoneNumber(entry.from);

  const channelName = Object.keys(channels).find(
    name => name === entry.channel || channels[name].type === entry.channel
  );

  const channelServices = channelName
    ? Object.entries(services).filter(([, svc]) => svc.channel === channelName)
    : [];

  async function addToChannel() {
    if (!channelName) return;
    setAdding('channel');
    try {
      const ch = channels[channelName];
      const newList = [...(ch.allow_list || []), phoneNumber];
      await apiFetch(API + '/api/config/channels/' + encodeURIComponent(channelName), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allow_list: newList }),
      });
      setDone(true);
      onToast?.(`${phoneNumber} added to ${channelName} allow list. Restart to apply changes.`);
    } catch {}
    setAdding(null);
  }

  async function addToService(svcName) {
    const svc = services[svcName];
    setAdding(svcName);
    try {
      const newList = [...(svc.allow_list || []), phoneNumber];
      await apiFetch(API + '/api/config/services/' + encodeURIComponent(svcName), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook: svc.webhook, allow_list: newList }),
      });
      setDone(true);
      onToast?.(`${phoneNumber} added to ${svcName} allow list. Restart to apply changes.`);
    } catch {}
    setAdding(null);
  }

  if (!channelName) return null;

  if (done) {
    return (
      <div className="flex items-center gap-2 text-green text-sm">
        <span className="material-symbols-outlined text-[18px]">check_circle</span>
        <span className="font-medium">{phoneNumber} added to allow list</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-dim">This number is not in the allow list. Add it to allow future messages:</p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); addToChannel(); }}
          disabled={!!adding}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-primary text-primary hover:bg-primary hover:text-white transition-colors disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">{adding === 'channel' ? 'hourglass_empty' : 'person_add'}</span>
          Add to {channelName} channel
        </button>
        {channelServices.map(([name]) => (
          <button
            key={name}
            onClick={(e) => { e.stopPropagation(); addToService(name); }}
            disabled={!!adding}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-border text-dim hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">{adding === name ? 'hourglass_empty' : 'person_add'}</span>
            Add to {name} service
          </button>
        ))}
      </div>
    </div>
  );
}

function LogRow({ entry, isNew, onToast }) {
  const [expanded, setExpanded] = useState(false);
  const icon = channelIcons[entry.channel] || null;
  const typeLabel = entry.type === 'async-outbound'
    ? <span className="text-primary text-[11px] font-semibold">ASYNC &nearr;</span>
    : null;
  const initials = (entry.senderName || entry.from || '?').charAt(0).toUpperCase();

  return (
    <>
      <tr
        className={`hover:bg-bg-light transition-colors cursor-pointer ${isNew ? 'animate-fade-in-row' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-4 text-xs font-medium text-dim">{formatTime(entry.timestamp)}</td>
        <td className="px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="size-6 rounded-full bg-bg-light flex items-center justify-center text-[11px] font-semibold text-dim shrink-0">
              {icon ? <span className="w-4 h-4">{icon}</span> : initials}
            </div>
            <div className="min-w-0">
              <span className="text-sm font-semibold text-text">{entry.senderName || entry.from || 'Unknown'}</span>
              {entry.senderName && entry.from && (
                <span className="text-[11px] text-dim ml-1 font-mono">{entry.from}</span>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-4">
          <p className="text-sm text-dim line-clamp-1">{typeLabel} {truncate(entry.text, 80)}</p>
        </td>
        <td className="px-4 py-4">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-bg-light text-dim border border-border">
            {shortUrl(entry.route) || '\u2014'}
          </span>
        </td>
        <td className="px-4 py-4">
          <StatusBadge status={entry.status} />
        </td>
        <td className="px-4 py-4 text-xs font-bold text-dim">{entry.latency != null ? entry.latency + 'ms' : '\u2014'}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="px-4 py-4">
            <div className="bg-bg-light border border-border rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div><label className="text-[11px] text-dim uppercase block mb-0.5">ID</label><p className="text-sm font-mono">{entry.id}</p></div>
                <div><label className="text-[11px] text-dim uppercase block mb-0.5">Timestamp</label><p className="text-sm">{formatDate(entry.timestamp)}</p></div>
                <div><label className="text-[11px] text-dim uppercase block mb-0.5">Channel</label><p className="text-sm">{entry.channel}</p></div>
                <div><label className="text-[11px] text-dim uppercase block mb-0.5">From</label><p className="text-sm">{entry.senderName || ''} ({entry.from})</p></div>
                <div><label className="text-[11px] text-dim uppercase block mb-0.5">Type</label><p className="text-sm">{entry.type}</p></div>
                <div><label className="text-[11px] text-dim uppercase block mb-0.5">Group</label><p className="text-sm">{entry.groupName || entry.groupId || '\u2014'}</p></div>
                <div><label className="text-[11px] text-dim uppercase block mb-0.5">Webhook</label><p className="text-sm font-mono break-all">{entry.route || '\u2014'}</p></div>
                <div><label className="text-[11px] text-dim uppercase block mb-0.5">Status</label><p className="text-sm">{entry.status}</p></div>
                <div><label className="text-[11px] text-dim uppercase block mb-0.5">Latency</label><p className="text-sm">{entry.latency != null ? entry.latency + 'ms' : '\u2014'}</p></div>
              </div>
              {entry.formatApplied && entry.formatOriginalText && (
                <div>
                  <label className="text-[11px] text-dim uppercase block mb-1">Original Message <span className="text-primary font-normal normal-case">(before formatting)</span></label>
                  <div className="bg-surface border border-border rounded-lg p-3 text-sm whitespace-pre-wrap">{entry.formatOriginalText}</div>
                </div>
              )}
              <div>
                <label className="text-[11px] text-dim uppercase block mb-1">
                  {entry.formatApplied ? <>Formatted Message <span className="inline-flex items-center ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">AI Formatted</span></> : 'Full Message'}
                </label>
                <div className="bg-surface border border-border rounded-lg p-3 text-sm whitespace-pre-wrap">{entry.text || '\u2014'}</div>
              </div>
              <div>
                <label className="text-[11px] text-dim uppercase block mb-1">Response</label>
                <div className="bg-surface border border-border rounded-lg p-3 text-sm whitespace-pre-wrap">{entry.responseText || '\u2014'}</div>
              </div>
              {entry.status === 'blocked' && <AllowActions entry={entry} onToast={onToast} />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Logs({ onSend }) {
  const { entries } = useAppState();
  const dispatch = useDispatch();
  const [channel, setChannel] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const searchTimeout = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [toast, setToast] = useState(null);
  const toastTimeout = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(null), 6000);
  }, []);

  useEffect(() => {
    apiFetch(API + '/api/logs')
      .then(r => r.json())
      .then(data => dispatch({ type: 'SET_ENTRIES', payload: data }))
      .catch(() => {});
  }, [dispatch]);

  const onSearchChange = useCallback((val) => {
    setSearch(val);
    setPage(1);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(val), 200);
  }, []);

  async function clearMessages() {
    if (!confirm('Clear all message logs? This cannot be undone.')) return;
    await apiFetch(API + '/api/logs', { method: 'DELETE' });
    dispatch({ type: 'SET_ENTRIES', payload: [] });
  }

  const filtered = entries.filter(e => {
    if (channel && e.channel !== channel) return false;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      return (e.text || '').toLowerCase().includes(q)
        || (e.from || '').toLowerCase().includes(q)
        || (e.senderName || '').toLowerCase().includes(q)
        || (e.responseText || '').toLowerCase().includes(q);
    }
    return true;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
      {/* Table Header Actions */}
      <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="flex gap-3 items-center w-full sm:w-auto">
          <div className="relative flex-1 sm:max-w-xs">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-dim text-[18px]">filter_list</span>
            <input
              className="w-full pl-10 pr-4 py-2 bg-bg-light border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all text-text placeholder:text-dim"
              placeholder="Filter messages..."
              type="text"
              value={search}
              onChange={e => onSearchChange(e.target.value)}
            />
          </div>
          <select
            value={channel}
            onChange={e => { setChannel(e.target.value); setPage(1); }}
            className="py-2 px-3 bg-bg-light border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary text-text"
          >
            <option value="">All Channels</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="telegram">Telegram</option>
            <option value="sms">SMS</option>
            <option value="voice">Voice</option>
            <option value="email">Email</option>
          </select>
          <button
            onClick={clearMessages}
            className="hidden sm:flex items-center gap-1 px-3 py-2 text-xs font-medium text-dim border border-border rounded-lg hover:bg-bg-light transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
            Clear
          </button>
        </div>
        <button
          onClick={onSend}
          className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-lg h-9 px-4 bg-primary text-white text-sm font-bold hover:bg-primary-hover transition-all"
        >
          <span className="material-symbols-outlined text-[18px]">send</span>
          <span>Send Message</span>
        </button>
      </div>

      {/* Messages Table */}
      <div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-bg-light border-b border-border">
              <th className="px-4 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Time</th>
              <th className="px-4 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">From</th>
              <th className="px-4 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Message</th>
              <th className="px-4 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Webhook</th>
              <th className="px-4 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-[11px] font-bold text-dim uppercase tracking-wider">Latency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {paginated.map((e, i) => (
              <LogRow key={e.id || i} entry={e} isNew={i === 0 && page === 1 && entries[0]?.id === e.id} onToast={showToast} />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-16 text-dim">
            <span className="material-symbols-outlined text-5xl mb-3 block opacity-30">mail</span>
            <p className="text-sm">No messages yet. Waiting for traffic...</p>
          </div>
        )}
      </div>

      {/* Table Footer */}
      {filtered.length > 0 && (
        <div className="px-4 py-4 bg-bg-light border-t border-border flex items-center justify-between">
          <p className="text-xs text-dim">
            Showing {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)}&ndash;{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()} messages
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 rounded border border-border text-xs font-medium text-dim hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 rounded border border-border text-xs font-medium text-dim hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-surface border border-yellow/40 rounded-xl shadow-lg animate-slide-up">
          <span className="material-symbols-outlined text-yellow text-[20px]">restart_alt</span>
          <span className="text-sm text-text">{toast}</span>
          <button
            onClick={async () => {
              if (!confirm('Restart ChannelKit now?\n\nThe process will restart and the dashboard will reload automatically.')) return;
              setToast('Restarting\u2026');
              try { await apiFetch(API + '/api/restart', { method: 'POST' }); } catch {}
              let attempts = 0;
              const poll = setInterval(async () => {
                attempts++;
                if (attempts > 30) { clearInterval(poll); setToast('Restart timed out — reload manually'); return; }
                try {
                  const r = await apiFetch(API + '/api/health');
                  if (r.ok) { clearInterval(poll); location.reload(); }
                } catch {}
              }, 1000);
            }}
            className="px-3 py-1 bg-yellow text-white rounded-lg text-xs font-bold hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            Restart Now
          </button>
          <button onClick={() => setToast(null)} className="text-dim hover:text-text">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}
    </div>
  );
}
