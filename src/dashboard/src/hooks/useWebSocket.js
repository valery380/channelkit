import { useEffect, useRef } from 'react';
import { WS_URL, getToken } from '../api.js';

export function useWebSocket(dispatch) {
  const wsRef = useRef(null);
  const cancelledRef = useRef(false);

  // Force reconnect when token changes (e.g. after login)
  useEffect(() => {
    const interval = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.CLOSED) return; // retry loop will handle it
      const token = getToken();
      const currentUrl = ws?._url || ws?.url || '';
      const expectedToken = token ? `token=${encodeURIComponent(token)}` : '';
      if (ws && ws.readyState === WebSocket.OPEN && expectedToken && !currentUrl.includes(expectedToken)) {
        // Token changed — reconnect
        ws.close();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    function connect() {
      if (cancelledRef.current) return;
      const token = getToken();
      const url = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        dispatch({ type: 'SET_WS_CONNECTED', payload: true });
      };

      ws.onclose = (ev) => {
        dispatch({ type: 'SET_WS_CONNECTED', payload: false });
        if (ev.code === 4401) {
          console.warn('[ws] Unauthorized — check API secret / token');
        }
        if (!cancelledRef.current) setTimeout(connect, 3000);
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

          if (msg.type === 'channelStatus') {
            dispatch({ type: 'SET_CHANNEL_STATUS', payload: { channel: msg.channel, connected: msg.connected, statusMessage: msg.statusMessage } });
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
      cancelledRef.current = true;
      if (wsRef.current) wsRef.current.close();
    };
  }, [dispatch]);
}
