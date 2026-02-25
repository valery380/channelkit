import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API } from '../api.js';
import { formatTime, formatDate, truncate, shortUrl, channelIcons } from '../utils.jsx';

function StatusIcon({ status }) {
  if (status === 'success')
    return <span className="status-ok"><svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="currentColor"><path d="m424-296 282-282-56-56-226 226-114-114-56 56 170 170Zm56 216q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z" /></svg></span>;
  if (status === 'error')
    return <span className="status-err"><svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z" /></svg></span>;
  return <span className="status-noroute"><svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="currentColor"><path d="M280-440h400v-80H280v80Zm200 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z" /></svg></span>;
}

function LogRow({ entry, isNew }) {
  const [expanded, setExpanded] = useState(false);
  const icon = entry.type === 'async-outbound' ? '\uD83D\uDD04' : channelIcons[entry.channel] || '\uD83D\uDCE8';
  const typeLabel = entry.type === 'async-outbound'
    ? <span style={{ color: 'var(--accent)', fontSize: 11, fontWeight: 600 }}>ASYNC &nearr;</span>
    : null;

  return (
    <>
      <tr className={isNew ? 'new-entry' : ''} onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
        <td className="time-cell mono">{formatTime(entry.timestamp)}</td>
        <td className="channel-icon">{icon}</td>
        <td className="from-cell">
          <div className="name">{entry.senderName || ''}</div>
          <div className="number mono">{entry.from}</div>
        </td>
        <td className="text-preview">{typeLabel} {truncate(entry.text)}</td>
        <td className="route-cell mono">{shortUrl(entry.route)}</td>
        <td><StatusIcon status={entry.status} /></td>
        <td className="latency mono">{entry.latency != null ? entry.latency + 'ms' : '\u2014'}</td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={7}>
            <div className="detail open">
              <div className="detail-grid">
                <div className="detail-item"><label>ID</label><p className="mono">{entry.id}</p></div>
                <div className="detail-item"><label>Timestamp</label><p>{formatDate(entry.timestamp)}</p></div>
                <div className="detail-item"><label>Channel</label><p>{entry.channel}</p></div>
                <div className="detail-item"><label>From</label><p>{entry.senderName || ''} ({entry.from})</p></div>
                <div className="detail-item"><label>Type</label><p>{entry.type}</p></div>
                <div className="detail-item"><label>Group</label><p>{entry.groupName || entry.groupId || '\u2014'}</p></div>
                <div className="detail-item"><label>Webhook</label><p className="mono">{entry.route || '\u2014'}</p></div>
                <div className="detail-item"><label>Status</label><p>{entry.status}</p></div>
                <div className="detail-item"><label>Latency</label><p>{entry.latency != null ? entry.latency + 'ms' : '\u2014'}</p></div>
              </div>
              <div className="detail-item" style={{ marginTop: 12 }}>
                <label>Full Message</label>
                <div className="detail-response">{entry.text || '\u2014'}</div>
              </div>
              <div className="detail-item" style={{ marginTop: 8 }}>
                <label>Response</label>
                <div className="detail-response">{entry.responseText || '\u2014'}</div>
              </div>
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
  const searchTimeout = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    fetch(API + '/api/logs')
      .then(r => r.json())
      .then(data => dispatch({ type: 'SET_ENTRIES', payload: data }))
      .catch(() => {});
  }, [dispatch]);

  const onSearchChange = useCallback((val) => {
    setSearch(val);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setDebouncedSearch(val), 200);
  }, []);

  async function clearMessages() {
    if (!confirm('Clear all message logs? This cannot be undone.')) return;
    await fetch(API + '/api/logs', { method: 'DELETE' });
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

  return (
    <>
      <div className="filters">
        <select value={channel} onChange={e => setChannel(e.target.value)}>
          <option value="">All Channels</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="telegram">Telegram</option>
          <option value="sms">SMS</option>
          <option value="voice">Voice</option>
          <option value="email">Email</option>
        </select>
        <input type="text" value={search} onChange={e => onSearchChange(e.target.value)} placeholder="Search messages, senders, responses..." />
        <button onClick={clearMessages} style={{ background: 'none', border: '1px solid var(--border)', padding: '6px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: 'var(--dim)' }}>Clear</button>
        <button onClick={onSend} style={{ background: 'var(--accent)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', marginLeft: 'auto' }}>Send Message</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th></th>
              <th>From</th>
              <th>Message</th>
              <th>Webhook</th>
              <th>Status</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <LogRow key={e.id || i} entry={e} isNew={i === 0 && entries[0]?.id === e.id} />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="empty">
            <div className="empty-icon">{'\uD83D\uDCED'}</div>
            <div>No messages yet. Waiting for traffic...</div>
          </div>
        )}
      </div>
    </>
  );
}
