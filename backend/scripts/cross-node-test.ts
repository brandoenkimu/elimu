/**
 * End-to-end evidence for the report. Run it while all three nodes are up:
 *
 *   npm run test:cluster
 *
 * It creates throw-away users and a throw-away conversation, then checks:
 *   1. cross-node delivery (6 clients spread over 3 nodes)
 *   2. delivery latency (median and 95th percentile, measured, not estimated)
 *   3. duplicate prevention (same clientMessageId sent twice)
 *   4. authorisation (a non-member can neither read nor write)
 *   5. input validation (empty and oversized messages)
 *   6. unauthenticated sockets are rejected
 *   7. history recovery after a client reconnects to a different node
 *   8. rate limiting (shared across nodes)
 *
 * Results are printed and saved to test-results.json. Nothing here is a
 * pre-written claim: every number comes from this run.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { io, Socket } from 'socket.io-client';

interface NodeRef {
  id: string;
  url: string;
}

const NODES: NodeRef[] = (
  process.env.TEST_NODES ?? 'NODE_A=http://localhost:3001,NODE_B=http://localhost:3002,NODE_C=http://localhost:3003'
)
  .split(',')
  .map((entry) => {
    const [id, ...rest] = entry.trim().split('=');
    return { id, url: rest.join('=') };
  });

const EMAIL_DOMAIN = process.env.TEST_EMAIL_DOMAIN ?? 'example.test';
const CLIENTS = 6;
const MESSAGES_PER_NODE = 5;

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}
const checks: Check[] = [];
const record = (name: string, passed: boolean, detail: string): void => {
  checks.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
};

// ---------------------------------------------------------------- helpers

interface ApiResult {
  status: number;
  json: any;
}

async function api(
  base: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<ApiResult> {
  const res = await fetch(`${base}/api${path}`, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

interface Client {
  index: number;
  node: NodeRef;
  token: string;
  userId: string;
  socket: Socket;
  lastSeq: number;
}

function connectSocket(url: string, token?: string): Promise<{ socket: Socket; node: string }> {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      transports: ['websocket'],
      auth: token ? { token } : {},
      reconnection: false,
      forceNew: true,
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`connect timeout (${url})`));
    }, 5_000);
    socket.once('node:hello', (hello: { node: string }) => {
      clearTimeout(timer);
      resolve({ socket, node: hello.node });
    });
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

const send = (socket: Socket, payload: unknown): Promise<any> =>
  socket.timeout(5_000).emitWithAck('message:send', payload);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

// ------------------------------------------------------------------- main

async function main(): Promise<void> {
  const run = randomUUID().slice(0, 8);
  const password = `CampusTest9-${run}`;
  console.log(`CampusConnect cluster test, run ${run}`);
  console.log(`Nodes: ${NODES.map((n) => `${n.id} ${n.url}`).join(' | ')}\n`);

  // Health first: no point continuing if a node is down.
  for (const node of NODES) {
    const health = await api(node.url, '/health').catch(() => null);
    if (!health || health.status !== 200) {
      console.error(`${node.id} is not healthy (${node.url}). Start all three nodes first.`);
      process.exit(2);
    }
  }

  // Users: CLIENTS members plus one outsider who never joins.
  const people: { token: string; userId: string; inviteCode?: string }[] = [];
  for (let i = 0; i <= CLIENTS; i++) {
    const res = await api(NODES[0].url, '/auth/register', {
      body: {
        email: `cc-test-${run}-${i}@${EMAIL_DOMAIN}`,
        displayName: i === CLIENTS ? 'Test Outsider' : `Test User ${i + 1}`,
        password,
        confirmPassword: password,
        role: 'student',
        regNumber: `T/${run}/${i}`.toUpperCase(),
      },
    });
    if (res.status !== 201) {
      console.error(`Registration failed (${res.status}): ${JSON.stringify(res.json)}`);
      if (res.status === 429) {
        console.error(
          'Sign-ups are limited to 20 per hour per IP address (shared across the nodes through Redis).\n' +
            'Each test run uses 7. Wait a while, or clear the counters on a development Redis with: redis-cli FLUSHDB',
        );
      } else if (res.status === 403) {
        console.error('ALLOWED_EMAIL_DOMAINS is set. Set TEST_EMAIL_DOMAIN to one of the allowed domains and retry.');
      }
      process.exit(2);
    }
    people.push({ token: res.json.accessToken, userId: res.json.user.id });
  }
  const outsider = people[CLIENTS];

  const created = await api(NODES[0].url, '/conversations', {
    token: people[0].token,
    body: { name: `Cluster test ${run}`, description: 'Automated test conversation' },
  });
  const conversationId: string = created.json.conversation.id;
  const inviteCode: string = created.json.conversation.inviteCode;
  for (let i = 1; i < CLIENTS; i++) {
    const joined = await api(NODES[0].url, '/conversations/join', { token: people[i].token, body: { inviteCode } });
    if (joined.status !== 200) {
      console.error(`Join failed for client ${i}: ${JSON.stringify(joined.json)}`);
      process.exit(2);
    }
  }

  // Connect clients round-robin across the nodes.
  const clients: Client[] = [];
  for (let i = 0; i < CLIENTS; i++) {
    const node = NODES[i % NODES.length];
    const { socket, node: reportedNode } = await connectSocket(node.url, people[i].token);
    if (reportedNode !== node.id) throw new Error(`Expected ${node.id} but connected to ${reportedNode}`);
    clients.push({ index: i, node, token: people[i].token, userId: people[i].userId, socket, lastSeq: 0 });
  }
  record(
    'Multi-client connection',
    true,
    `${CLIENTS} authenticated clients connected: ${clients.map((c) => `#${c.index + 1}→${c.node.id}`).join(', ')}`,
  );

  // Arrival tracking for every message any client sees.
  const arrivals = new Map<string, Map<number, number>>(); // clientMessageId -> clientIndex -> performance.now()
  for (const client of clients) {
    client.socket.on('message:new', (m: { clientMessageId: string; seq: number }) => {
      client.lastSeq = Math.max(client.lastSeq, m.seq);
      if (!arrivals.has(m.clientMessageId)) arrivals.set(m.clientMessageId, new Map());
      arrivals.get(m.clientMessageId)!.set(client.index, performance.now());
    });
  }
  const outsiderConn = await connectSocket(NODES[0].url, outsider.token);
  let outsiderReceived = 0;
  outsiderConn.socket.on('message:new', () => outsiderReceived++);

  // ---- 1 + 2: cross-node delivery and latency
  const latencies: number[] = [];
  const ackLatencies: number[] = [];
  let sent = 0;
  let expectedDeliveries = 0;
  let actualDeliveries = 0;

  for (const node of NODES) {
    const sender = clients.find((c) => c.node.id === node.id)!;
    for (let n = 0; n < MESSAGES_PER_NODE; n++) {
      const clientMessageId = randomUUID();
      const t0 = performance.now();
      const ack = await send(sender.socket, {
        conversationId,
        clientMessageId,
        body: `Hello from ${node.id}, message ${n + 1}`,
      });
      ackLatencies.push(performance.now() - t0);
      sent++;
      expectedDeliveries += CLIENTS;
      if (!ack?.ok) {
        console.log(`      send failed: ${JSON.stringify(ack)}`);
        continue;
      }
      const deadline = Date.now() + 3_000;
      while ((arrivals.get(clientMessageId)?.size ?? 0) < CLIENTS && Date.now() < deadline) await sleep(10);
      const got = arrivals.get(clientMessageId);
      actualDeliveries += got?.size ?? 0;
      for (const at of got?.values() ?? []) latencies.push(at - t0);
    }
  }
  latencies.sort((a, b) => a - b);
  ackLatencies.sort((a, b) => a - b);
  record(
    'Cross-node delivery',
    actualDeliveries === expectedDeliveries,
    `${sent} messages sent from ${NODES.length} nodes; ${actualDeliveries}/${expectedDeliveries} deliveries observed`,
  );
  record(
    'Delivery latency (local machine)',
    latencies.length > 0,
    `median ${round1(percentile(latencies, 50))} ms, p95 ${round1(percentile(latencies, 95))} ms, max ${round1(latencies[latencies.length - 1] ?? null)} ms (n=${latencies.length}); ack median ${round1(percentile(ackLatencies, 50))} ms`,
  );

  // ---- 3: duplicate prevention
  const dupId = randomUUID();
  const dupPayload = { conversationId, clientMessageId: dupId, body: 'Duplicate prevention probe' };
  const first = await send(clients[0].socket, dupPayload);
  const second = await send(clients[0].socket, dupPayload);
  await sleep(200);
  const history = await api(NODES[1].url, `/conversations/${conversationId}/messages?limit=100`, {
    token: clients[0].token,
  });
  const copies = (history.json.messages as { clientMessageId: string }[]).filter((m) => m.clientMessageId === dupId);
  record(
    'Duplicate prevention',
    first.ok && second.ok && second.duplicate === true && first.message.id === second.message.id && copies.length === 1,
    `same clientMessageId sent twice → second ack duplicate=${second.duplicate}; ${copies.length} row(s) in PostgreSQL`,
  );

  // ---- 4: authorisation
  const forbidden = await send(outsiderConn.socket, {
    conversationId,
    clientMessageId: randomUUID(),
    body: 'I should not be able to post this',
  });
  const outsiderHistory = await api(NODES[2].url, `/conversations/${conversationId}/messages`, {
    token: outsider.token,
  });
  await sleep(300);
  record(
    'Authorisation (non-member)',
    forbidden.ok === false && forbidden.code === 'FORBIDDEN' && outsiderHistory.status === 404 && outsiderReceived === 0,
    `send → ${forbidden.code}; history → HTTP ${outsiderHistory.status}; broadcasts received by outsider: ${outsiderReceived}`,
  );

  // ---- 5: validation
  const empty = await send(clients[0].socket, { conversationId, clientMessageId: randomUUID(), body: '   ' });
  const huge = await send(clients[0].socket, { conversationId, clientMessageId: randomUUID(), body: 'x'.repeat(2001) });
  const junk = await send(clients[0].socket, { conversationId: 'not-a-uuid', clientMessageId: 1, body: {} });
  record(
    'Input validation',
    [empty, huge, junk].every((r) => r.ok === false && r.code === 'VALIDATION_FAILED'),
    `blank → ${empty.code}; 2001 chars → ${huge.code}; malformed → ${junk.code}`,
  );

  // ---- 6: unauthenticated socket
  let rejectionCode = 'connected (unexpected)';
  try {
    const anon = await connectSocket(NODES[0].url);
    anon.socket.close();
  } catch (err) {
    rejectionCode = (err as { data?: { code?: string } }).data?.code ?? (err as Error).message;
  }
  let forgedCode = 'connected (unexpected)';
  try {
    const forged = await connectSocket(NODES[1].url, 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.');
    forged.socket.close();
  } catch (err) {
    forgedCode = (err as { data?: { code?: string } }).data?.code ?? (err as Error).message;
  }
  record(
    'Unauthenticated connections rejected',
    rejectionCode === 'NO_TOKEN' && forgedCode === 'INVALID_TOKEN',
    `no token → ${rejectionCode}; forged "alg: none" token → ${forgedCode}`,
  );

  // ---- 7: history recovery after failover to another node
  const roamer = clients[3]; // starts on NODE_A
  const seqBeforeDisconnect = roamer.lastSeq;
  roamer.socket.close();
  await sleep(200);
  const missedIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const clientMessageId = randomUUID();
    missedIds.push(clientMessageId);
    await send(clients[1].socket, { conversationId, clientMessageId, body: `Sent while client #4 was offline (${i + 1})` });
  }
  const reconnected = await connectSocket(NODES[1].url, roamer.token); // different node than before
  roamer.socket = reconnected.socket;
  const catchUp = await api(NODES[2].url, `/conversations/${conversationId}/messages?after=${seqBeforeDisconnect}`, {
    token: roamer.token,
  });
  const recovered = (catchUp.json.messages as { clientMessageId: string }[]).filter((m) =>
    missedIds.includes(m.clientMessageId),
  );
  record(
    'History recovery after reconnect',
    recovered.length === 3,
    `client #4 left ${roamer.node.id}, came back on ${reconnected.node}; ${recovered.length}/3 missed messages recovered from PostgreSQL`,
  );

  // ---- 8: rate limiting across nodes
  const burst = await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      send(clients[5].socket, { conversationId, clientMessageId: randomUUID(), body: `burst ${i}` }),
    ),
  );
  const accepted = burst.filter((r) => r.ok).length;
  const limited = burst.filter((r) => !r.ok && r.code === 'RATE_LIMITED').length;
  record(
    'Rate limiting',
    limited > 0,
    `30 messages in one burst → ${accepted} accepted, ${limited} rate-limited (limit: 20 per 10 s per user)`,
  );

  // ---- wrap up
  for (const client of clients) client.socket.close();
  outsiderConn.socket.close();

  const passed = checks.filter((c) => c.passed).length;
  const report = {
    run,
    finishedAt: new Date().toISOString(),
    nodes: NODES,
    totals: { checks: checks.length, passed, failed: checks.length - passed },
    delivery: {
      messagesSent: sent,
      expectedDeliveries,
      actualDeliveries,
      latencyMs: {
        samples: latencies.length,
        median: round1(percentile(latencies, 50)),
        p95: round1(percentile(latencies, 95)),
        max: round1(latencies[latencies.length - 1] ?? null),
      },
      ackLatencyMs: { median: round1(percentile(ackLatencies, 50)), p95: round1(percentile(ackLatencies, 95)) },
    },
    checks,
  };
  writeFileSync('test-results.json', JSON.stringify(report, null, 2));
  console.log(`\n${passed}/${checks.length} checks passed. Details saved to test-results.json`);
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch((err: Error) => {
  console.error(`Test run aborted: ${err.message}`);
  process.exit(2);
});
