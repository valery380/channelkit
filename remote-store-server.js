#!/usr/bin/env node
/**
 * ChannelKit Remote Store — Reference Server
 *
 * A simple file-backed REST server that stores ChannelKit config, auth, and groups.
 * Use this as a starting point for building your own remote store
 * (e.g. backed by a database, S3, etc.).
 *
 * Usage:
 *   node remote-store-server.js                         # port 4500, data in ./ck-remote-data
 *   PORT=8080 DATA_DIR=/tmp/ck node remote-store-server.js
 *
 * Then start ChannelKit with:
 *   channelkit start --remote http://localhost:4500
 *
 * Or with env vars:
 *   CHANNELKIT_REMOTE=http://localhost:4500 channelkit start
 *
 * API Contract:
 *   GET  /config  → text/plain (YAML)
 *   PUT  /config  ← text/plain (YAML)
 *   GET  /auth    → application/zip
 *   PUT  /auth    ← application/zip
 *   GET  /groups  → application/json
 *   PUT  /groups  ← application/json
 *
 * Optional: set AUTH_TOKEN to require Bearer authentication:
 *   AUTH_TOKEN=mysecret node remote-store-server.js
 *   channelkit start --remote http://localhost:4500 --remote-auth "Bearer mysecret"
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '4500', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'ck-remote-data');
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CONFIG_PATH = path.join(DATA_DIR, 'config.yaml');
const AUTH_PATH = path.join(DATA_DIR, 'auth.zip');
const GROUPS_PATH = path.join(DATA_DIR, 'groups.json');

function checkAuth(req, res) {
  if (!AUTH_TOKEN) return true;
  const header = req.headers['authorization'] || '';
  if (header === `Bearer ${AUTH_TOKEN}`) return true;
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
  return false;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const server = http.createServer(async (req, res) => {
  if (!checkAuth(req, res)) return;

  const method = req.method;
  const url = req.url.replace(/\/$/, '');

  // ── Config ──
  if (url === '/config' && method === 'GET') {
    if (!fs.existsSync(CONFIG_PATH)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No config stored' }));
    }
    const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(data);
  }

  if (url === '/config' && method === 'PUT') {
    const body = await readBody(req);
    fs.writeFileSync(CONFIG_PATH, body);
    console.log(`[store] Config saved (${body.length} bytes)`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── Auth ──
  if (url === '/auth' && method === 'GET') {
    if (!fs.existsSync(AUTH_PATH)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No auth stored' }));
    }
    const data = fs.readFileSync(AUTH_PATH);
    res.writeHead(200, { 'Content-Type': 'application/zip' });
    return res.end(data);
  }

  if (url === '/auth' && method === 'PUT') {
    const body = await readBody(req);
    fs.writeFileSync(AUTH_PATH, body);
    console.log(`[store] Auth saved (${body.length} bytes)`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── Groups ──
  if (url === '/groups' && method === 'GET') {
    if (!fs.existsSync(GROUPS_PATH)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{}');
    }
    const data = fs.readFileSync(GROUPS_PATH, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(data);
  }

  if (url === '/groups' && method === 'PUT') {
    const body = await readBody(req);
    fs.writeFileSync(GROUPS_PATH, body);
    console.log(`[store] Groups saved (${body.length} bytes)`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── 404 ──
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`\n  📦 ChannelKit Remote Store Server`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Endpoint:  http://localhost:${PORT}`);
  console.log(`  Data dir:  ${DATA_DIR}`);
  if (AUTH_TOKEN) {
    console.log(`  Auth:      Bearer ${AUTH_TOKEN.slice(0, 4)}...`);
  } else {
    console.log(`  Auth:      none (set AUTH_TOKEN to enable)`);
  }
  console.log();
  console.log(`  Start ChannelKit with:`);
  console.log(`    channelkit start --remote http://localhost:${PORT}`);
  console.log();
});
