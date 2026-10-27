import { GATEWAY_URL, NODES, POLL_MS } from './config';
import type { NodeDef } from './config';
import type { NodeInfo, NodeStatus } from './types';

export interface ClusterState {
  nodes: NodeInfo[];
  recommended: string | null;
  /** True when the picture came from the gateway, false when this browser probed the nodes itself. */
  viaGateway: boolean;
  updatedAt: number | null;
  anyHealthy: boolean;
}

interface GatewayNode {
  id: string;
  status: NodeStatus;
  latencyMs: number | null;
  connections: number | null;
  reason: string | null;
  lastChangeAt: string | null;
}

interface GatewayBody {
  recommended: string | null;
  nodes: GatewayNode[];
}

interface HealthBody {
  status?: string;
  connections?: number;
  checks?: Record<string, { ok?: boolean } | undefined>;
}

export interface CandidateOptions {
  /** Stay on this node if it is still usable (keeps one session on one node). */
  prefer?: string;
  /** Try this node last (it just failed us). */
  avoid?: string;
}

const PROBE_TIMEOUT_MS = 1_500;
/** After a real connection failure, distrust a node for a couple of poll cycles. */
const SUSPECT_MS = POLL_MS * 2;

const blank = (def: NodeDef): NodeInfo => ({
  id: def.id,
  url: def.url,
  status: 'unknown',
  latencyMs: null,
  connections: null,
  reason: null,
  lastChangeAt: null,
});

/**
 * Keeps a live picture of which nodes are usable.
 *
 * Preferred source is the gateway (/gateway), which polls from a stable place.
 * If the gateway is absent or down, the browser probes each node's /api/health
 * itself, so the app still works with nothing but the three nodes running.
 * Real connection failures seen by the API client or the socket are reported
 * back here, so the next attempt skips a dead node immediately instead of
 * waiting for the next poll.
 */
export class ClusterMonitor {
  private raw: NodeInfo[];
  private recommendedId: string | null = null;
  private viaGateway = false;
  private updatedAt: number | null = null;
  private state: ClusterState;

  private readonly listeners = new Set<() => void>();
  private readonly suspect = new Map<string, number>();
  private readonly direct = new Map<string, { status: NodeStatus; successes: number; changedAt: string }>();
  private timer: number | undefined;
  private running = false;
  private polling = false;

  constructor(
    private readonly defs: NodeDef[] = NODES,
    private readonly gatewayUrl: string | null = GATEWAY_URL,
  ) {
    this.raw = defs.map(blank);
    this.state = this.compute();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ClusterState => this.state;

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    window.clearTimeout(this.timer);
  }

  /** Poll right now (used after a failure so the UI catches up quickly). */
  refreshNow(): void {
    void this.poll();
  }

  reportFailure(nodeId: string): void {
    this.suspect.set(nodeId, Date.now() + SUSPECT_MS);
    this.publish();
    this.refreshNow();
  }

  reportSuccess(nodeId: string): void {
    if (this.suspect.delete(nodeId)) this.publish();
  }

  /**
   * Nodes in the order they should be tried: healthy first, then recovering,
   * then unknown, and unavailable ones only as a last resort. The list is never
   * empty, so a stale picture can never leave the app with nowhere to try.
   */
  candidates(options: CandidateOptions = {}): NodeDef[] {
    const { nodes, recommended } = this.state;
    const rank = (n: NodeInfo): number =>
      n.status === 'healthy' ? 0 : n.status === 'recovering' ? 1 : n.status === 'unknown' ? 2 : 3;
    const score = (n: NodeInfo): number => {
      let s = rank(n) * 1_000 + Math.min(n.connections ?? 0, 999) / 1_000;
      if (n.id === options.prefer) s -= 2;
      else if (n.id === recommended) s -= 1;
      if (n.id === options.avoid) s += 500;
      return s;
    };
    return [...nodes].sort((a, b) => score(a) - score(b)).map((n) => ({ id: n.id, url: n.url }));
  }

  // ------------------------------------------------------------------ internals

  private async loop(): Promise<void> {
    if (!this.running) return;
    await this.poll();
    if (this.running) this.timer = window.setTimeout(() => void this.loop(), POLL_MS);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const fromGateway = this.gatewayUrl ? await this.pollGateway(this.gatewayUrl) : false;
      if (!fromGateway) await this.pollDirect();
      this.updatedAt = Date.now();
      this.publish();
    } finally {
      this.polling = false;
    }
  }

  private async pollGateway(url: string): Promise<boolean> {
    try {
      const res = await fetch(`${url}/cluster`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), cache: 'no-store' });
      if (!res.ok) return false;
      const body = (await res.json()) as GatewayBody;
      if (!Array.isArray(body.nodes)) return false;
      this.raw = this.defs.map((def) => {
        const g = body.nodes.find((n) => n.id === def.id);
        return g
          ? {
              id: def.id,
              url: def.url,
              status: g.status,
              latencyMs: g.latencyMs,
              connections: g.connections,
              reason: g.reason,
              lastChangeAt: g.lastChangeAt,
            }
          : blank(def);
      });
      this.recommendedId = body.recommended;
      this.viaGateway = true;
      return true;
    } catch {
      return false;
    }
  }

  private async pollDirect(): Promise<void> {
    this.viaGateway = false;
    this.recommendedId = null;
    this.raw = await Promise.all(this.defs.map((def) => this.probe(def)));
  }

  private async probe(def: NodeDef): Promise<NodeInfo> {
    const started = performance.now();
    let ok = false;
    let reason: string | null = null;
    let connections: number | null = null;
    let latencyMs: number | null = null;
    try {
      const res = await fetch(`${def.url}/api/health`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      latencyMs = Math.round(performance.now() - started);
      const body = (await res.json().catch(() => null)) as HealthBody | null;
      connections = typeof body?.connections === 'number' ? body.connections : null;
      ok = res.ok && body?.status === 'ok';
      if (!ok) {
        const failed = Object.entries(body?.checks ?? {})
          .filter(([, v]) => v?.ok === false)
          .map(([k]) => k);
        reason = failed.length ? `dependency down: ${failed.join(', ')}` : `HTTP ${res.status}`;
      }
    } catch (err) {
      reason = (err as Error).name === 'TimeoutError' ? 'health check timed out' : 'connection refused';
    }

    // Same recovery rule as the gateway: two clean checks before a node counts as healthy again.
    const prev = this.direct.get(def.id) ?? { status: 'unknown' as NodeStatus, successes: 0, changedAt: new Date().toISOString() };
    let status: NodeStatus = prev.status;
    let successes = prev.successes;
    if (ok) {
      successes += 1;
      if (prev.status === 'unavailable') {
        status = 'recovering';
        successes = 1;
      } else if (prev.status === 'recovering') {
        status = successes >= 2 ? 'healthy' : 'recovering';
      } else {
        status = 'healthy';
      }
    } else {
      successes = 0;
      status = 'unavailable';
    }
    this.direct.set(def.id, {
      status,
      successes,
      changedAt: status === prev.status ? prev.changedAt : new Date().toISOString(),
    });

    return {
      id: def.id,
      url: def.url,
      status,
      latencyMs,
      connections,
      reason: ok ? null : reason,
      lastChangeAt: this.direct.get(def.id)?.changedAt ?? null,
    };
  }

  private compute(): ClusterState {
    const now = Date.now();
    const nodes = this.raw.map((n): NodeInfo => {
      const until = this.suspect.get(n.id);
      if (until && until > now && n.status !== 'unavailable') {
        return { ...n, status: 'unavailable', reason: 'connection failed', latencyMs: null, connections: null };
      }
      return n;
    });
    const healthy = nodes.filter((n) => n.status === 'healthy');
    let recommended: string | null = null;
    if (this.recommendedId && healthy.some((n) => n.id === this.recommendedId)) {
      recommended = this.recommendedId;
    } else if (healthy.length > 0) {
      const least = Math.min(...healthy.map((n) => n.connections ?? 0));
      const pool = healthy.filter((n) => (n.connections ?? 0) === least);
      recommended = pool[Math.floor(Math.random() * pool.length)].id;
    }
    return {
      nodes,
      recommended,
      viaGateway: this.viaGateway,
      updatedAt: this.updatedAt,
      anyHealthy: healthy.length > 0,
    };
  }

  private publish(): void {
    this.state = this.compute();
    for (const listener of this.listeners) listener();
  }
}
