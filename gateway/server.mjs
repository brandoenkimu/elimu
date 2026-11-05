import http from 'node:http';
import https from 'node:https';

const PORT = Number(process.env.PORT ?? process.env.GATEWAY_PORT ?? 4000);
const HOST = process.env.GATEWAY_HOST ?? '0.0.0.0';
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 2000);
const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 1500);

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function parseNodes(spec) {
  return spec.split(',').map((entry) => {
    const [id, ...rest] = entry.trim().split('=');
    const url = rest.join('=');
    const parsed = new URL(url);

    if (!id?.trim() || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Invalid NODES entry: ${entry}`);
    }

    return { id: id.trim(), url: parsed.origin };
  });
}

const NODES = parseNodes(
  process.env.NODES ??
  'NODE_A=http://localhost:3001,NODE_B=http://localhost:3002,NODE_C=http://localhost:3003',
);

const state = new Map(NODES.map((node) => [
  node.id,
  {
    ...node,
    status: 'unknown',
    failures: 0,
    successes: 0,
    latencyMs: null,
    connections: null,
    checks: null,
    reason: null,
    lastChangeAt: new Date().toISOString(),
    lastCheckedAt: null,
  },
]));

const socketSessions = new Map();
const SOCKET_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function getSocketNode(requestUrl) {
  const parsed = new URL(requestUrl ?? "/", "http://gateway");
  const sid = parsed.searchParams.get("sid");

  if (!sid) return selectNode();

  const session = socketSessions.get(sid);

  if (!session || session.expiresAt <= Date.now()) {
    socketSessions.delete(sid);
    return null;
  }

  const node = state.get(session.nodeId);

  if (!node || node.status !== "healthy") return null;

  session.expiresAt = Date.now() + SOCKET_SESSION_TTL_MS;
  return node;
}

function setStatus(node, status) {
  if (node.status !== status) {
    console.log(`[gateway] ${node.id}: ${node.status} -> ${status}`);
    node.status = status;
    node.lastChangeAt = new Date().toISOString();
  }
}

async function probe(node) {
  const started = performance.now();

  try {
    const response = await fetch(`${node.url}/api/health`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });

    const body = await response.json().catch(() => null);

    node.latencyMs = Math.round(performance.now() - started);
    node.lastCheckedAt = new Date().toISOString();
    node.connections = body?.connections ?? null;
    node.checks = body?.checks ?? null;

    const ok = response.ok && body?.status === 'ok';

    if (ok) {
      node.reason = null;
      node.failures = 0;
      node.successes += 1;

      if (node.status === 'unavailable') {
        node.successes = 1;
        setStatus(node, 'recovering');
      } else if (node.status === 'recovering') {
        if (node.successes >= 2) setStatus(node, 'healthy');
      } else {
        setStatus(node, 'healthy');
      }
    } else {
      node.successes = 0;
      node.failures += 1;
      node.reason = `HTTP ${response.status}`;

      if (node.status !== 'healthy' || node.failures >= 2) {
        setStatus(node, 'unavailable');
      }
    }
  } catch (error) {
    node.latencyMs = null;
    node.connections = null;
    node.lastCheckedAt = new Date().toISOString();
    node.reason = error?.name === 'TimeoutError'
      ? 'health check timed out'
      : 'connection refused';

    node.successes = 0;
    node.failures += 1;

    if (node.status !== 'healthy' || node.failures >= 2) {
      setStatus(node, 'unavailable');
    }
  }
}

async function pollAll() {
  await Promise.all([...state.values()].map(probe));
}

function recommended() {
  const healthy = [...state.values()].filter((n) => n.status === 'healthy');

  if (!healthy.length) return null;

  const min = Math.min(...healthy.map((n) => n.connections ?? 0));
  const candidates = healthy.filter((n) => (n.connections ?? 0) === min);

  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

function selectNode() {
  const id = recommended();
  return id ? state.get(id) : null;
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

function setCors(req, res) {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
}

function sendUnavailable(res) {
  if (res.headersSent) return res.destroy();

  res.writeHead(503, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Retry-After': '2',
  });

  res.end(JSON.stringify({
    code: 'NO_HEALTHY_NODE',
    message: 'No healthy backend node is currently available.',
  }));
}

function proxyHttp(req, res) {
  const node = selectNode();

  if (!node) return sendUnavailable(res);

  const target = new URL(node.url);
  const transport = target.protocol === 'https:' ? https : http;

  const headers = { ...req.headers };
  headers.host = target.host;
  headers['x-forwarded-host'] = req.headers.host ?? '';
  headers['x-forwarded-proto'] = 'https';

  const proxyReq = transport.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    method: req.method,
    path: req.url,
    headers,
    timeout: 60_000,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Upstream request timed out'));
  });

  proxyReq.on('error', (error) => {
    console.error(`[gateway] HTTP proxy to ${node.id} failed: ${error.message}`);

    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        code: 'UPSTREAM_ERROR',
        message: 'The backend node could not complete the request.',
      }));
    } else {
      res.destroy(error);
    }
  });

  req.pipe(proxyReq);
}

function proxySocketHttp(req, res) {
  const requestUrl = new URL(req.url ?? "/", "http://gateway");
  const sid = requestUrl.searchParams.get("sid");
  const node = getSocketNode(req.url);

  if (!node) return sendUnavailable(res);

  const target = new URL(node.url);
  const transport = target.protocol === "https:" ? https : http;

  const headers = { ...req.headers };
  headers.host = target.host;
  headers["x-forwarded-host"] = req.headers.host ?? "";
  headers["x-forwarded-proto"] = "https";
  headers["accept-encoding"] = "identity";

  const proxyReq = transport.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    method: req.method,
    path: req.url,
    headers,
    timeout: 60_000,
  }, (proxyRes) => {
    const chunks = [];

    proxyRes.on("data", (chunk) => chunks.push(chunk));

    proxyRes.on("end", () => {
      const body = Buffer.concat(chunks);

      // The first Engine.IO polling response contains packet 0
      // followed by the JSON object containing the new session ID.
      if (!sid && req.method === "GET" && proxyRes.statusCode === 200) {
        const packet = body.toString("utf8");

        if (packet.startsWith("0")) {
          try {
            const handshake = JSON.parse(packet.slice(1));

            if (typeof handshake.sid === "string" && handshake.sid) {
              socketSessions.set(handshake.sid, {
                nodeId: node.id,
                expiresAt: Date.now() + SOCKET_SESSION_TTL_MS,
              });
            }
          } catch {
            // Non-handshake polling packets need no new session mapping.
          }
        }
      }

      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      res.end(body);
    });

    proxyRes.on("error", (error) => {
      console.error(`[gateway] Socket.IO response from ${node.id} failed: ${error.message}`);
      res.destroy(error);
    });
  });

  proxyReq.on("timeout", () => {
    proxyReq.destroy(new Error("Socket.IO polling request timed out"));
  });

  proxyReq.on("error", (error) => {
    console.error(`[gateway] Socket.IO HTTP proxy to ${node.id} failed: ${error.message}`);

    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        code: "SOCKET_UPSTREAM_ERROR",
        message: "The real-time backend could not complete the request.",
      }));
    } else {
      res.destroy(error);
    }
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  setCors(req, res);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');

  const path = new URL(req.url ?? '/', 'http://gateway').pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Name',
      'Access-Control-Max-Age': '600',
    });
    return res.end();
  }

  if (path === '/cluster' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(snapshot()));
  }

  if (path === '/healthz' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"status":"ok"}');
  }

  if (path === '/socket.io' || path.startsWith('/socket.io/')) {
    return proxySocketHttp(req, res);
  }

  if (path === '/api' || path.startsWith('/api/')) {
    return proxyHttp(req, res);
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end('{"code":"NOT_FOUND"}');
});

server.on('upgrade', (req, clientSocket, head) => {
  const path = new URL(req.url ?? '/', 'http://gateway').pathname;

  if (!path.startsWith('/socket.io/')) {
    clientSocket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }

  const node = getSocketNode(req.url);

  if (!node) {
    clientSocket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    return;
  }

  const target = new URL(node.url);
  const transport = target.protocol === 'https:' ? https : http;

  const headers = { ...req.headers };
  headers.host = target.host;
  headers['x-forwarded-host'] = req.headers.host ?? '';
  headers['x-forwarded-proto'] = 'https';

  const upstream = transport.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    method: 'GET',
    path: req.url,
    headers,
    agent: false,
  });

  upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
    const statusLine = `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`;
    const responseHeaders = response.rawHeaders;

    clientSocket.write(statusLine);

    for (let i = 0; i < responseHeaders.length; i += 2) {
      clientSocket.write(`${responseHeaders[i]}: ${responseHeaders[i + 1]}\r\n`);
    }

    clientSocket.write('\r\n');

    if (upstreamHead.length) clientSocket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);

    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);

    clientSocket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => clientSocket.destroy());
  });

  upstream.on('response', (response) => {
    clientSocket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);

    for (let i = 0; i < response.rawHeaders.length; i += 2) {
      clientSocket.write(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`);
    }

    clientSocket.write('\r\n');
    response.pipe(clientSocket);
  });

  upstream.on('error', (error) => {
    console.error(`[gateway] WebSocket proxy to ${node.id} failed: ${error.message}`);

    if (!clientSocket.destroyed) {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    }
  });

  upstream.end();
});

let timer;
let shuttingDown = false;

async function loop() {
  if (shuttingDown) return;

  await pollAll().catch((error) => {
    console.error('[gateway] health polling failed:', error.message);
  });

  if (!shuttingDown) timer = setTimeout(loop, POLL_MS);
}

server.listen(PORT, HOST, () => {
  console.log(`[gateway] listening on ${HOST}:${PORT}`);
  console.log(`[gateway] watching: ${NODES.map((n) => `${n.id}=${n.url}`).join(', ')}`);
  void loop();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(timer);
    server.close(() => process.exit(0));
  });
}
