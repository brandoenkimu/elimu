// CampusConnect node gateway
//
// A tiny health-aware "node picker". It polls /api/health on every chat node,
// keeps a status per node, and tells browsers which node to connect to.
// It does NOT proxy traffic: clients connect straight to a node, so there is no
// sticky-session problem and no extra hop in the message path.
//
// Zero dependencies. Requires Node 18+.
//
//   GET /cluster   -> { updatedAt, recommended, nodes: [...] }
//   GET /healthz   -> { status: "ok" }

import http from 'node:http';

const PORT = Number(process.env.GATEWAY_PORT ?? 4000);
const HOST = process.env.GATEWAY_HOST ?? '127.0.0.1';
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 2000);
const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 1500);
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function parseNodes(spec) {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, ...rest] = entry.split('=');
      const url = rest.join('=');
      try {
        return { id: id.trim(), url: new URL(url).origin };
      } catch {
        console.error(`Ignoring invalid NODES entry "${entry}". Expected NAME=http://host:port`);
        process.exit(1);
      }
    });
}

const NODES = parseNodes(
  process.env.NODES ?? 'NODE_A=http://localhost:3001,NODE_B=http://localhost:3002,NODE_C=http://localhost:3003',
);

/** @type {Map<string, any>} */
const state = new Map(
  NODES.map((n) => [
    n.id,
    {
      id: n.id,
      url: n.url,
      status: 'unknown', // unknown | healthy | recovering | unavailable
      failures: 0,
      successes: 0,
      latencyMs: null,
      connections: null,
      checks: null,
      reason: null,
      lastChangeAt: new Date().toISOString(),
      lastCheckedAt: null,
    },
  ]),
);

function setStatus(node, status) {
  if (node.status !== status) {
    console.log(`[gateway] ${node.id}: ${node.status} -> ${status}`);
    node.status = status;
    node.lastChangeAt = new Date().toISOString();
  }
}

async function probe(node) {
  const started = performance.now();
  let ok = false;
  let reason = null;
  try {
    const res = await fetch(`${node.url}/api/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    const body = await res.json().catch(() => null);
    node.latencyMs = Math.round(performance.now() - started);
    node.lastCheckedAt = new Date().toISOString();
    if (body) {
      node.connections = body.connections ?? null;
      node.checks = body.checks ?? null;
    }
    ok = res.ok && body?.status === 'ok';
    if (!ok) {
      const failed = body?.checks
        ? Object.entries(body.checks)
            .filter(([, v]) => v && v.ok === false)
            .map(([k]) => k)
        : [];
      reason = failed.length ? `dependency down: ${failed.join(', ')}` : `HTTP ${res.status}`;
    }
  } catch (err) {
    node.latencyMs = null;
    node.connections = null;
    node.lastCheckedAt = new Date().toISOString();
    reason = err?.name === 'TimeoutError' ? 'health check timed out' : 'connection refused';
  }

  node.reason = ok ? null : reason;
  if (ok) {
    node.failures = 0;
    node.successes += 1;
    if (node.status === 'unavailable') {
      setStatus(node, 'recovering');
      node.successes = 1;
    } else if (node.status === 'recovering') {
      // Two clean checks in a row before sending new users back to a node.
      if (node.successes >= 2) setStatus(node, 'healthy');
    } else {
      setStatus(node, 'healthy');
    }
  } else {
    node.successes = 0;
    node.failures += 1;
    // Tolerate one blip on a node that was healthy; fail fast otherwise.
    if (node.status !== 'healthy' || node.failures >= 2) setStatus(node, 'unavailable');
  }
}

async function pollAll() {
  await Promise.all([...state.values()].map((n) => probe(n)));
}

function recommended() {
  const healthy = [...state.values()].filter((n) => n.status === 'healthy');
  if (healthy.length === 0) return null;
  const load = (n) => n.connections ?? 0;
  const min = Math.min(...healthy.map(load));
  const candidates = healthy.filter((n) => load(n) === min);
  // Random among equals spreads a room full of students across nodes.
  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

function snapshot() {
  return {
    updatedAt: new Date().toISOString(),
    pollIntervalMs: POLL_MS,
    recommended: recommended(),
    nodes: [...state.values()].map((n) => ({
      id: n.id,
      url: n.url,
      status: n.status,
      latencyMs: n.latencyMs,
      connections: n.connections,
      checks: n.checks,
      reason: n.reason,
      lastChangeAt: n.lastChangeAt,
      lastCheckedAt: n.lastCheckedAt,
    })),
  };
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '600' });
    return res.end();
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET, OPTIONS' });
    return res.end();
  }

  const path = new URL(req.url ?? '/', 'http://gateway').pathname;
  if (path === '/cluster') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(snapshot()));
  }
  if (path === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"status":"ok"}');
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"code":"NOT_FOUND"}');
});

let timer;
async function loop() {
  await pollAll().catch((err) => console.error('[gateway] poll error', err));
  timer = setTimeout(loop, POLL_MS);
}

server.listen(PORT, HOST, () => {
  console.log(`[gateway] http://${HOST}:${PORT}/cluster  watching: ${NODES.map((n) => `${n.id}=${n.url}`).join(', ')}`);
  loop();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearTimeout(timer);
    server.close(() => process.exit(0));
  });
}
