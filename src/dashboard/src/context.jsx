import { createContext, useContext, useReducer } from 'react';

const initialState = {
  entries: [],
  serverLogLines: [],
  channels: {},
  services: {},
  settings: {},
  tunnelActive: false,
  tunnelUrl: null,
  tunnelHasToken: false,
  mcpActive: false,
  mcpUrl: null,
  mcpExpose: false,
  mcpHasSecret: false,
  tunnelExposeDashboard: false,
  hasSmsWebhookChannels: false,
  twilioDefaults: { sid: '', tok: '' },
  stats: { total: 0, errorCount: 0, avgLatency: 0, uptime: 0 },
  wsConnected: false,
  configChanged: false,
  qrMessage: null,
  smsListenMessage: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_ENTRIES':
      return { ...state, entries: action.payload };
    case 'ADD_ENTRY':
      return {
        ...state,
        entries: [action.payload, ...state.entries].slice(0, 1000),
      };
    case 'SET_SERVER_LOGS':
      return { ...state, serverLogLines: action.payload };
    case 'ADD_SERVER_LOG': {
      const lines = [...state.serverLogLines, action.payload];
      if (lines.length > 500) lines.shift();
      return { ...state, serverLogLines: lines };
    }
    case 'SET_CONFIG':
      return {
        ...state,
        channels: action.payload.channels || state.channels,
        services: action.payload.services || state.services,
        hasSmsWebhookChannels: Object.values(action.payload.channels || {}).some(
          ch => ch.type === 'sms' && !ch.poll_interval
        ),
      };
    case 'SET_SETTINGS':
      return { ...state, settings: action.payload };
    case 'SET_TUNNEL':
      return {
        ...state,
        tunnelActive: action.payload.active ?? state.tunnelActive,
        tunnelUrl: action.payload.url ?? state.tunnelUrl,
        tunnelExposeDashboard: action.payload.exposeDashboard ?? state.tunnelExposeDashboard,
      };
    case 'SET_MCP':
      return {
        ...state,
        mcpActive: action.payload.active ?? state.mcpActive,
        mcpUrl: action.payload.url ?? state.mcpUrl,
        mcpExpose: action.payload.exposeMcp ?? state.mcpExpose,
        mcpHasSecret: action.payload.hasSecret ?? state.mcpHasSecret,
      };
    case 'SET_TUNNEL_HAS_TOKEN':
      return { ...state, tunnelHasToken: action.payload };
    case 'SET_STATS':
      return { ...state, stats: { ...state.stats, ...action.payload } };
    case 'SET_WS_CONNECTED':
      return { ...state, wsConnected: action.payload };
    case 'SET_CONFIG_CHANGED':
      return { ...state, configChanged: action.payload };
    case 'SET_TWILIO_DEFAULTS':
      return { ...state, twilioDefaults: action.payload };
    case 'SET_QR_MESSAGE':
      return { ...state, qrMessage: action.payload };
    case 'SET_SMS_LISTEN':
      return { ...state, smsListenMessage: action.payload };
    default:
      return state;
  }
}

const AppContext = createContext(null);
const DispatchContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </AppContext.Provider>
  );
}

export function useAppState() {
  return useContext(AppContext);
}

export function useDispatch() {
  return useContext(DispatchContext);
}
