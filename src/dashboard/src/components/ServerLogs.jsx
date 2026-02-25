import { useState, useEffect, useRef } from 'react';
import { useAppState, useDispatch } from '../context.jsx';
import { API } from '../api.js';

export default function ServerLogs() {
  const { serverLogLines } = useAppState();
  const dispatch = useDispatch();
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef(null);

  useEffect(() => {
    fetch(API + '/api/server-logs')
      .then(r => r.json())
      .then(lines => dispatch({ type: 'SET_SERVER_LOGS', payload: lines }))
      .catch(() => {});
  }, [dispatch]);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [serverLogLines, autoScroll]);

  async function clear() {
    await fetch(API + '/api/server-logs', { method: 'DELETE' });
    dispatch({ type: 'SET_SERVER_LOGS', payload: [] });
  }

  return (
    <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3 flex items-center gap-4 border-b border-border">
        <button
          onClick={clear}
          className="px-3 py-1.5 text-xs font-medium border border-border rounded-lg text-dim hover:bg-bg-light transition-colors"
        >
          Clear
        </button>
        <label className="flex items-center gap-2 text-xs text-dim cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={e => setAutoScroll(e.target.checked)}
            className="rounded border-border text-primary focus:ring-primary"
          />
          Auto-scroll
        </label>
        <span className="text-xs text-dim">{serverLogLines.length} lines</span>
      </div>
      <div
        ref={logRef}
        className="server-log-area bg-[#1e1e1e] text-[#d4d4d4] p-5 h-[calc(100vh-300px)] overflow-y-auto font-mono text-xs leading-relaxed"
      >
        {serverLogLines.length === 0 ? (
          <div className="text-[#666]">No log output captured yet.</div>
        ) : (
          serverLogLines.map((l, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all ${l.level === 'stderr' ? 'text-[#f48771]' : ''}`}>
              {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
