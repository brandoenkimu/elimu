import { GATEWAY_URL, NODES, POLL_MS } from './config';
import type { NodeDef } from './config';
import type { NodeInfo, NodeStatus } from './types';

export interface ClusterState {
  nodes: NodeInfo[];
  recommended: string | null;
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

const PROBE_TIMEOUT_MS = 2_500;

const blank = (def: NodeDef): NodeInfo => ({
  id: def.id,
  url: def.url,
  status: 'unknown',
  latencyMs: null,
  connections: null,
  reason: null,
  lastChangeAt: null,
});

export class ClusterMonitor {
  private raw: NodeInfo[];
  private recommendedId: string | null = null;
  private viaGateway = false;
  private updatedAt: number | null = null;
  private state: ClusterState;
  private readonly listeners = new Set<() => void>();
  private timer: number | undefined;
  private running = false;
  private polling = false;

  constructor(
    private readonly defs: NodeDef[] = NODES,
    private readonly gatewayUrl: string = GATEWAY_URL,
  ) {
    this.raw = defs.map(blank);
    this.state = this.compute();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

  refreshNow(): void {
    void this.poll();
  }

  private async loop(): Promise<void> {
    if (!this.running) return;
    await this.poll();
    if (this.running) {
      this.timer = window.setTimeout(() => void this.loop(), POLL_MS);
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      const available = await this.pollGateway();
      if (!available) {
        this.viaGateway = false;
        this.recommendedId = null;
        this.raw = this.defs.map((def) => ({
          ...blank(def),
          status: 'unavailable',
          reason: 'Gateway unavailable',
        }));
      }

      this.updatedAt = Date.now();
      this.publish();
    } finally {
      this.polling = false;
    }
  }

  private async pollGateway(): Promise<boolean> {
    try {
      const res = await fetch(`${this.gatewayUrl}/cluster`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        cache: 'no-store',
      });

      if (!res.ok) return false;

      const body = (await res.json()) as GatewayBody;
      if (!Array.isArray(body.nodes)) return false;

      this.raw = this.defs.map((def) => {
        const node = body.nodes.find((item) => item.id === def.id);
        return node
          ? {
              id: def.id,
              url: def.url,
              status: node.status,
              latencyMs: node.latencyMs,
              connections: node.connections,
              reason: node.reason,
              lastChangeAt: node.lastChangeAt,
            }
          : {
              ...blank(def),
              status: 'unavailable' as NodeStatus,
              reason: 'Node missing from gateway response',
            };
      });

      this.recommendedId = body.recommended;
      this.viaGateway = true;
      return true;
    } catch {
      return false;
    }
  }

  private compute(): ClusterState {
    const nodes = this.raw;
    const healthy = nodes.filter((node) => node.status === 'healthy');

    let recommended: string | null = null;

    if (this.recommendedId && healthy.some((node) => node.id === this.recommendedId)) {
      recommended = this.recommendedId;
    } else if (healthy.length > 0) {
      recommended = [...healthy].sort(
        (a, b) => (a.connections ?? 0) - (b.connections ?? 0),
      )[0].id;
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
