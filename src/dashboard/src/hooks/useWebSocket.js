import { useEffect, useRef } from 'react';
import { WS_URL, getToken } from '../api.js';

export function useWebSocket(dispatch) {
  const wsRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const token = getToken();
      const url = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        dispatch({ type: 'SET_WS_CONNECTED', payload: true });
      };

      ws.onclose = () => {
        dispatch({ type: 'SET_WS_CONNECTED', payload: false });
        if (!cancelled) setTimeout(connect, 3000);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);

          if (msg.type === 'newEntry') {
            dispatch({ type: 'ADD_ENTRY', payload: msg.entry });
          }

          if (msg.type === 'serverLog') {
            dispatch({ type: 'ADD_SERVER_LOG', payload: msg });
          }

          if (msg.type === 'tunnelStatus') {
            dispatch({
              type: 'SET_TUNNEL',
              payload: {
                active: msg.active,
                url: msg.url || null,
                exposeDashboard: msg.exposeDashboard,
              },
            });
          }

          if (msg.type === 'mcpStatus') {
            dispatch({
              type: 'SET_MCP',
              payload: {
                active: msg.active,
                url: msg.url || null,
                exposeMcp: msg.exposeMcp,
                hasSecret: msg.hasSecret,
              },
            });
          }

          if (msg.type === 'configChanged') {
            dispatch({ type: 'SET_CONFIG_CHANGED', payload: true });
          }

          if (
            msg.type === 'whatsapp-qr' ||
            msg.type === 'whatsapp-paired' ||
            msg.type === 'whatsapp-pair-error' ||
            msg.type === 'gmail-auth-url' ||
            msg.type === 'gmail-auth-success' ||
            msg.type === 'gmail-auth-error'
          ) {
            dispatch({ type: 'SET_QR_MESSAGE', payload: msg });
          }

          if (msg.type === 'sms-listen' || msg.type === 'sms-listen-error' || msg.type === 'sms-listen-stopped') {
            dispatch({ type: 'SET_SMS_LISTEN', payload: msg });
          }
        } catch {}
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (wsRef.current) wsRef.current.close();
    };
  }, [dispatch]);
}
