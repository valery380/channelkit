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
    <>
      <div className="log-toolbar">
        <button onClick={clear}>Clear</button>
        <label>
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} /> Auto-scroll
        </label>
        <span style={{ color: 'var(--dim)', fontSize: 12 }}>{serverLogLines.length} lines</span>
      </div>
      <div className="server-log mono" ref={logRef}>
        {serverLogLines.length === 0 ? (
          <div style={{ color: '#666' }}>No log output captured yet.</div>
        ) : (
          serverLogLines.map((l, i) => (
            <div key={i} className={l.level === 'stderr' ? 'log-err' : ''}>{l.text}</div>
          ))
        )}
      </div>
    </>
  );
}
