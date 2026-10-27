import { StatusDot, statusLabel, useCluster } from '../../../components/bits';
import { Badge, Button, Card, PageHeader, Stat } from '../../../components/ui';
import { monitor } from '../../../lib/singletons';
import { relative } from '../../../lib/format';

export default function System() {
  const cluster = useCluster();
  const healthy = cluster.nodes.filter((n) => n.status === 'healthy').length;
  return (
    <>
      <PageHeader title="System" sub="Live status of the chat servers. Only administrators see this page." actions={<Button onClick={() => monitor.refreshNow()}>Check now</Button>} />
      <div className="grid cols-3" style={{ marginBottom: 20 }}>
        <Stat label="Servers healthy" value={`${healthy} of ${cluster.nodes.length}`} />
        <Stat label="Total connections" value={cluster.nodes.reduce((n, x) => n + (x.connections ?? 0), 0)} />
        <Stat label="Source" value={cluster.viaGateway ? 'Gateway' : 'Browser probe'} />
      </div>
      <div className="grid cols-3">
        {cluster.nodes.map((n) => (
          <Card key={n.id} className="stack">
            <div className="row"><StatusDot status={n.status} /><b>{n.id}</b><span className="spacer" /><Badge tone={n.status === 'healthy' ? 'good' : n.status === 'recovering' ? 'warn' : n.status === 'unavailable' ? 'bad' : 'neutral'}>{statusLabel(n.status)}</Badge></div>
            <dl className="facts"><dt>Latency</dt><dd>{n.latencyMs === null ? '—' : `${n.latencyMs} ms`}</dd><dt>Connections</dt><dd>{n.connections ?? '—'}</dd>{n.reason && <><dt>Reason</dt><dd>{n.reason}</dd></>}{n.lastChangeAt && <><dt>Changed</dt><dd>{relative(n.lastChangeAt)}</dd></>}</dl>
          </Card>
        ))}
      </div>
    </>
  );
}
