// ─── App Router & WebSocket Hub ────────────────────────
import { API, WS_URL, formatUptime } from './utils.js';

// ─── Shared state ──────────────────────────────────────
export const state = {
  allEntries: [],
  serverLogLines: [],
  currentChannels: {},
  currentServices: {},
  cachedSettings: {},
  tunnelHasToken: false,
  hasSmsWebhookChannels: false,
  twilioDefaults: { sid: '', tok: '' },
};

export const tunnelState = { active: false, url: null };

// Make formatUptime available globally for logs component
window.__formatUptime = formatUptime;

// ─── Config data loader (used by services & channels) ──
export async function loadConfigData() {
  try {
    const data = await fetch(API + '/api/config').then(r => r.json());
    if (data.error) return;
    state.currentChannels = data.channels || {};
    state.currentServices = data.services || {};
    state.hasSmsWebhookChannels = Object.values(state.currentChannels).some(
      ch => ch.type === 'sms' && !ch.poll_interval
    );
  } catch {}
}

// ─── Route definitions ─────────────────────────────────
const routes = {
  '#logs':        () => import('./components/logs.js'),
  '#services':    () => import('./components/services.js'),
  '#channels':    () => import('./components/channels.js'),
  '#server-logs': () => import('./components/server-logs.js'),
  '#settings':    () => import('./components/settings.js'),
};

let currentModule = null;
let currentHash = null;

async function navigate(hash) {
  if (!hash || !routes[hash]) hash = '#logs';
  if (hash === currentHash) return;

  // Destroy previous
  if (currentModule && currentModule.destroy) {
    currentModule.destroy();
  }
  currentHash = hash;

  // Update nav
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.route === hash);
  });

  // Load module
  const container = document.getElementById('app');
  try {
    const mod = await routes[hash]();
    currentModule = mod;

    // Pre-load config data for services/channels panels
    if (hash === '#services' || hash === '#channels') {
      await loadConfigData();
    }

    mod.render(container);
    if (mod.init) mod.init();
  } catch (e) {
    container.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div>Failed to load module: ${e.message}</div></div>`;
    currentModule = null;
  }
}

// ─── WebSocket ─────────────────────────────────────────
let ws;
const wsStatus = () => document.getElementById('ws-status');

function connectWs() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    const el = wsStatus();
    if (el) { el.textContent = '● LIVE'; el.className = 'badge badge-live'; }
  };
  ws.onclose = () => {
    const el = wsStatus();
    if (el) { el.textContent = '● OFFLINE'; el.style.background = 'var(--red)'; }
    setTimeout(connectWs, 3000);
  };
  ws.onmessage = async (ev) => {
    try {
      const msg = JSON.parse(ev.data);

      if (msg.type === 'newEntry') {
        // Always notify logs component (it manages allEntries state)
        try {
          const logs = await import('./components/logs.js');
          logs.onNewEntry(msg.entry);
        } catch {}
        updateStats();
      }

      if (msg.type === 'serverLog') {
        // Always update state, and notify server-logs component if loaded
        try {
          const serverLogs = await import('./components/server-logs.js');
          serverLogs.onServerLog(msg);
        } catch {}
      }

      if (msg.type === 'tunnelStatus') {
        const tunnel = await import('./components/tunnel.js');
        tunnel.onTunnelStatus(msg);
      }

      if (msg.type === 'configChanged') {
        document.getElementById('restart-banner').style.display = 'block';
        if (currentHash === '#services' || currentHash === '#channels') {
          await loadConfigData();
          if (currentModule && currentModule.render) {
            const container = document.getElementById('app');
            currentModule.render(container);
            if (currentModule.init) currentModule.init();
          }
        }
      }

      if (msg.type === 'whatsapp-qr' || msg.type === 'whatsapp-paired' || msg.type === 'whatsapp-pair-error') {
        // QR events need to reach channels component even if not the active tab
        // (modal may still be open from when channels was active)
        try {
          const channels = await import('./components/channels.js');
          channels.handleQRMessage(msg);
        } catch {}
      }
    } catch {}
  };
}

// ─── Stats ─────────────────────────────────────────────
function updateStats() {
  fetch(API + '/api/logs/stats')
    .then(r => r.json())
    .then(s => {
      const el = (id) => document.getElementById(id);
      if (el('stat-total')) el('stat-total').textContent = s.total;
      if (el('stat-errors')) el('stat-errors').textContent = s.errorCount || 0;
      if (el('stat-latency')) el('stat-latency').textContent = s.avgLatency + 'ms';
      if (el('stat-uptime')) el('stat-uptime').textContent = formatUptime(s.uptime);
    })
    .catch(() => {});
}

// ─── Restart ───────────────────────────────────────────
async function restartServer() {
  if (!confirm('Restart ChannelKit now?\n\nThe process will restart and the dashboard will reload automatically.')) return;
  const btn = document.getElementById('restart-btn');
  const status = document.getElementById('restart-status');
  btn.disabled = true;
  btn.textContent = 'Restarting…';
  status.textContent = '';
  try { await fetch(API + '/api/restart', { method: 'POST' }); } catch {}
  status.textContent = 'Waiting for server…';
  let attempts = 0;
  const poll = setInterval(async () => {
    attempts++;
    if (attempts > 30) { clearInterval(poll); status.textContent = 'Restart timed out — reload manually'; return; }
    try { const r = await fetch(API + '/api/health'); if (r.ok) { clearInterval(poll); location.reload(); } } catch {}
  }, 1000);
}

// ─── Init ──────────────────────────────────────────────
async function init() {
  // Wire up nav tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.hash = btn.dataset.route;
    });
  });

  // Wire up restart
  document.getElementById('restart-btn').addEventListener('click', restartServer);

  // Wire up tunnel button and bar
  const tunnel = await import('./components/tunnel.js');

  document.getElementById('tunnel-btn').addEventListener('click', () => tunnel.toggleTunnel());
  document.getElementById('tunnel-url').addEventListener('click', () => tunnel.copyTunnelUrl());
  document.querySelector('#tunnel-bar [title="Copy URL"]')?.addEventListener('click', () => tunnel.copyTunnelUrl());

  // Tunnel bar buttons
  document.getElementById('update-endpoints-btn')?.addEventListener('click', () => tunnel.updateExternalEndpoints());
  document.getElementById('tunnel-expose')?.addEventListener('change', function() { tunnel.toggleExposeDashboard(this.checked); });
  document.getElementById('tunnel-bar-stop-btn')?.addEventListener('click', () => tunnel.toggleTunnel());

  // Tunnel setup
  document.getElementById('tunnel-setup-link')?.addEventListener('click', () => tunnel.showTunnelSetup());
  document.getElementById('tunnel-help-btn')?.addEventListener('click', () => tunnel.showTunnelHelp());
  document.getElementById('ts-save-btn')?.addEventListener('click', () => tunnel.saveTunnelConfig());
  document.getElementById('ts-cancel-btn')?.addEventListener('click', () => tunnel.hideTunnelSetup());
  document.getElementById('ts-clear-btn')?.addEventListener('click', () => tunnel.clearTunnelConfig());

  // Tunnel help modal
  document.getElementById('tunnel-help-overlay')?.addEventListener('click', function(e) { if (e.target === this) tunnel.closeTunnelHelp(); });
  document.getElementById('tunnel-help-close-btn')?.addEventListener('click', () => tunnel.closeTunnelHelp());

  // Initialize tunnel state
  tunnel.initTunnelState();

  // Load initial data
  updateStats();
  setInterval(updateStats, 30000);

  // Fetch twilio defaults
  try {
    const r = await fetch(API + '/api/settings/twilio-defaults');
    const d = await r.json();
    state.twilioDefaults.sid = d.account_sid || '';
    state.twilioDefaults.tok = d.auth_token || '';
  } catch {}

  // Fetch initial config for SMS webhook channel detection
  try {
    const data = await fetch(API + '/api/config').then(r => r.json());
    if (data.channels) {
      state.hasSmsWebhookChannels = Object.values(data.channels).some(
        ch => ch.type === 'sms' && !ch.poll_interval
      );
    }
  } catch {}

  // Connect WebSocket
  connectWs();

  // Route on hash
  window.addEventListener('hashchange', () => navigate(window.location.hash));
  navigate(window.location.hash || '#logs');
}

init();
