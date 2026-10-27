export interface NodeDef {
  id: string;
  url: string;
}

const DEFAULT_NODES =
  'NODE_A=http://localhost:3001,NODE_B=http://localhost:3002,NODE_C=http://localhost:3003';

function parseNodes(spec: string): NodeDef[] {
  return spec
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.indexOf('=');
      return { id: entry.slice(0, at).trim(), url: entry.slice(at + 1).trim().replace(/\/+$/, '') };
    })
    .filter((node) => node.id && node.url);
}

export const NODES: NodeDef[] = parseNodes(import.meta.env.VITE_NODES || DEFAULT_NODES);

const gateway = import.meta.env.VITE_GATEWAY_URL;
/** null disables the gateway; the browser then checks node health on its own. */
export const GATEWAY_URL: string | null =
  gateway === undefined ? 'http://localhost:4000' : gateway.trim() === '' ? null : gateway.trim().replace(/\/+$/, '');

export const POLL_MS = 3_000;
export const MAX_MESSAGE_LENGTH = 2_000;
