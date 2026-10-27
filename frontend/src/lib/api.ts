import type { ClusterMonitor } from './cluster';
import type { AuthPayload, ConversationSummary, FileMeta, Member, WireMessage } from './types';

export interface FieldIssue {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSec?: number,
    readonly issues?: FieldIssue[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** The request never reached any server. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
  get isAuth(): boolean {
    return this.status === 401;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: Method;
  body?: unknown;
  /** Raw bytes (file upload). Sent as application/octet-stream. */
  raw?: Blob;
  headers?: Record<string, string>;
  /** Return the response as a Blob instead of JSON (downloads). */
  blob?: boolean;
  /** Set false for endpoints that must work without a session (login, register). */
  auth?: boolean;
  /**
   * Allow trying the next node after a network error. GET requests always may;
   * a POST must opt in, because a request that died mid-flight may have been processed.
   */
  retry?: boolean;
}

interface ErrorBody {
  code?: string;
  message?: string;
  retryAfterSec?: number;
  issues?: FieldIssue[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * HTTP client that knows about the cluster. It sticks to one node while that
 * node works, moves to the next healthy node when it does not, and quietly
 * refreshes the short-lived access token (cookie-based refresh token) when needed.
 */
export class ApiClient {
  private token: string | null = null;
  private tokenExpiresAtMs = 0;
  private currentNode: string | null = null;
  private refreshing: Promise<AuthPayload> | null = null;
  private readonly tokenListeners = new Set<(token: string | null) => void>();

  constructor(private readonly monitor: ClusterMonitor) {}

  get accessToken(): string | null {
    return this.token;
  }

  get expiresAtMs(): number {
    return this.tokenExpiresAtMs;
  }

  onToken(listener: (token: string | null) => void): () => void {
    this.tokenListeners.add(listener);
    return () => {
      this.tokenListeners.delete(listener);
    };
  }

  private setSession(accessToken: string, expiresInSec: number): void {
    this.token = accessToken;
    this.tokenExpiresAtMs = Date.now() + expiresInSec * 1000;
    for (const listener of this.tokenListeners) listener(accessToken);
  }

  clearSession(): void {
    this.token = null;
    this.tokenExpiresAtMs = 0;
    for (const listener of this.tokenListeners) listener(null);
  }

  /** A token that is good for at least another 30 seconds, refreshing first if necessary. */
  async ensureToken(): Promise<string> {
    if (this.token && this.tokenExpiresAtMs - Date.now() > 30_000) return this.token;
    const session = await this.refresh();
    return session.accessToken;
  }

  /** Concurrent callers share one refresh, because each refresh rotates the cookie. */
  refresh(): Promise<AuthPayload> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async doRefresh(): Promise<AuthPayload> {
    for (let attempt = 0; ; attempt++) {
      try {
        const payload = await this.send<AuthPayload>('/auth/refresh', { method: 'POST', retry: true });
        this.setSession(payload.accessToken, payload.expiresInSec);
        return payload;
      } catch (err) {
        // Another tab rotated the cookie a moment ago. Give the browser time to
        // pick up the new cookie, then try once more.
        if (err instanceof ApiError && err.code === 'REFRESH_RACE' && attempt === 0) {
          await sleep(600);
          continue;
        }
        throw err;
      }
    }
  }

  // ---------------------------------------------------------------- auth calls

  async login(email: string, password: string, remember = true): Promise<AuthPayload> {
    const payload = await this.send<AuthPayload>('/auth/login', {
      method: 'POST',
      body: { email, password, remember },
      retry: true,
    });
    this.setSession(payload.accessToken, payload.expiresInSec);
    return payload;
  }

  /** Students get a session straight away; lecturers wait for approval and get `{ pending: true }`. */
  async register(input: Record<string, unknown>): Promise<AuthPayload | { pending: true; message: string }> {
    const payload = await this.send<AuthPayload | { pending: true; message: string }>('/auth/register', {
      method: 'POST',
      body: input,
      retry: false,
    });
    if ('accessToken' in payload) this.setSession(payload.accessToken, payload.expiresInSec);
    return payload;
  }

  forgot(email: string): Promise<{ ok: true; message: string }> {
    return this.send('/auth/forgot', { method: 'POST', body: { email }, retry: true });
  }

  reset(input: { token: string; password: string; confirmPassword: string }): Promise<{ ok: true }> {
    return this.send('/auth/reset', { method: 'POST', body: input });
  }

  async changePassword(input: { currentPassword: string; newPassword: string; confirmPassword: string }): Promise<AuthPayload> {
    const payload = await this.request<AuthPayload>('/auth/change-password', { method: 'POST', body: input });
    this.setSession(payload.accessToken, payload.expiresInSec);
    return payload;
  }

  async logoutAll(): Promise<void> {
    await this.request<void>('/auth/logout-all', { method: 'POST' });
    this.clearSession();
  }

  me(): Promise<{ user: AuthPayload['user'] }> {
    return this.request('/auth/me');
  }

  /** Public (no sign-in): the list of programmes, for the sign-up form. */
  publicCourses(): Promise<{ courses: { id: string; code: string; name: string; department: string; durationYears: number; semestersPerYear: number }[] }> {
    return this.send('/catalog/courses', { method: 'GET' });
  }

  // ---------------------------------------------------------------- generic calls

  get<T>(path: string): Promise<T> { return this.request<T>(path); }
  post<T>(path: string, body?: unknown, retry = false): Promise<T> { return this.request<T>(path, { method: 'POST', body: body ?? {}, retry }); }
  put<T>(path: string, body?: unknown): Promise<T> { return this.request<T>(path, { method: 'PUT', body: body ?? {} }); }
  patch<T>(path: string, body?: unknown): Promise<T> { return this.request<T>(path, { method: 'PATCH', body: body ?? {} }); }
  del<T = { ok: true }>(path: string): Promise<T> { return this.request<T>(path, { method: 'DELETE' }); }

  async upload(file: File): Promise<FileMeta> {
    const res = await this.request<{ file: FileMeta }>('/files', {
      method: 'POST',
      raw: file,
      headers: { 'X-File-Name': encodeURIComponent(file.name) },
    });
    return res.file;
  }

  /** Fetches a protected file (needs the access token, so a plain link will not work) and saves it. */
  async download(path: string, fallbackName: string): Promise<void> {
    const blob = await this.request<Blob>(path, { blob: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async logout(): Promise<void> {
    try {
      await this.send<void>('/auth/logout', { method: 'POST', retry: true });
    } catch {
      // Signing out must always succeed locally, even if no node could be reached.
    }
    this.clearSession();
  }

  // ---------------------------------------------------------------- chat calls

  openDirect(userId: string): Promise<{ conversation: ConversationSummary }> {
    return this.request('/conversations/direct', { method: 'POST', body: { userId }, retry: true });
  }

  listConversations(): Promise<{ conversations: ConversationSummary[] }> {
    return this.request('/conversations');
  }

  createConversation(name: string, description: string): Promise<{ conversation: ConversationSummary }> {
    return this.request('/conversations', { method: 'POST', body: { name, description } });
  }

  joinConversation(inviteCode: string): Promise<{ conversation: ConversationSummary }> {
    // Joining twice is harmless (the server ignores duplicates), so retrying across nodes is safe.
    return this.request('/conversations/join', { method: 'POST', body: { inviteCode }, retry: true });
  }

  listMembers(conversationId: string): Promise<{ members: Member[] }> {
    return this.request(`/conversations/${conversationId}/members`);
  }

  history(
    conversationId: string,
    query: { before?: number; after?: number; limit?: number },
  ): Promise<{ messages: WireMessage[]; hasMore: boolean }> {
    const params = new URLSearchParams();
    if (query.before !== undefined) params.set('before', String(query.before));
    if (query.after !== undefined) params.set('after', String(query.after));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const qs = params.toString();
    return this.request(`/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`);
  }

  // ------------------------------------------------------------------ plumbing

  /** An authenticated request. Refreshes the token first if needed, and once more after a 401. */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = await this.ensureToken();
    try {
      return await this.send<T>(path, { ...options, token });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && (err.code === 'TOKEN_EXPIRED' || err.code === 'INVALID_TOKEN')) {
        const session = await this.refresh();
        return this.send<T>(path, { ...options, token: session.accessToken });
      }
      throw err;
    }
  }

  /** One logical request, tried against nodes in order of preference. */
  private async send<T>(path: string, options: RequestOptions & { token?: string }): Promise<T> {
    const method: Method = options.method ?? (options.body !== undefined || options.raw ? 'POST' : 'GET');
    const mayRetryOnNetworkError = method === 'GET' || options.retry === true;
    const candidates = this.monitor.candidates({ prefer: this.currentNode ?? undefined });
    let lastError: ApiError | null = null;

    for (const node of candidates) {
      let response: Response;
      try {
        response = await fetch(`${node.url}/api${path}`, {
          method,
          credentials: 'include',
          headers: {
            ...(options.raw ? { 'Content-Type': 'application/octet-stream' } : options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
            ...(options.headers ?? {}),
          },
          body: options.raw ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
          signal: AbortSignal.timeout(options.raw || options.blob ? 60_000 : 10_000),
        });
      } catch {
        this.monitor.reportFailure(node.id);
        lastError = new ApiError(0, 'NETWORK', 'Cannot reach Elimu right now. Check your connection.');
        if (!mayRetryOnNetworkError) break;
        continue;
      }

      if (response.ok) {
        this.currentNode = node.id;
        this.monitor.reportSuccess(node.id);
        if (response.status === 204) return undefined as T;
        if (options.blob) return (await response.blob()) as T;
        return (await response.json()) as T;
      }

      const body = (await response.json().catch(() => ({}))) as ErrorBody;
      const error = new ApiError(
        response.status,
        body.code ?? 'ERROR',
        body.message ?? 'Something went wrong.',
        body.retryAfterSec,
        body.issues,
      );

      // 503 means this node refused before doing any work (a dependency is down),
      // so trying another node is always safe, even for a POST.
      if (response.status === 503) {
        this.monitor.reportFailure(node.id);
        lastError = error;
        continue;
      }
      throw error;
    }

    throw lastError ?? new ApiError(0, 'NETWORK', 'Cannot reach Elimu right now. Check your connection.');
  }
}
