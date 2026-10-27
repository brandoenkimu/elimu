import { ApiClient } from './api';
import { ClusterMonitor } from './cluster';
import { RealtimeClient } from './realtime';

// One of each per browser tab. They live outside React so a re-render never
// opens a second socket or starts a second poller.
export const monitor = new ClusterMonitor();
export const api = new ApiClient(monitor);
export const realtime = new RealtimeClient(monitor, api);
