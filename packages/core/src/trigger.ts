export type TriggerConfig =
  | { kind: 'cron'; expr: string }
  | { kind: 'webhook'; path: string }
  | { kind: 'event'; name: string }
  | { kind: 'manual' }
  | { kind: 'mcp'; toolName: string };

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the oldest in-window request expires. 0 when allowed. */
  retryAfterMs: number;
}

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

export interface RunGuard {
  concurrency?: {
    limit: number;
    overflow?: 'queue' | 'reject';
  };
  dedup?: {
    period: string;
  };
  rateLimit?: {
    kind: 'rateLimit';
    key: (ctx: { runId: string; metadata?: Record<string, unknown> }) => string;
    limit: number;
    /** Window duration string: '10s' | '1m' | '24h'. Enforcement adapter parses at call time. */
    window: string;
    /** true = discard excess (Inngest rateLimit); false = delay excess (throttle). */
    discardExcess: boolean;
    /** Defaults to InProcessRateLimitStore. Replace with a distributed adapter for multi-process use. */
    store?: RateLimitStore;
  };
}

export interface KitTriggerEnvelope<T> {
  id: string;
  type: string;
  source: string;
  time: string;
  data: T;
  dedupKey?: string;
}

export type TriggerHandler<T = unknown> = (envelope: KitTriggerEnvelope<T>) => Promise<void>;

export interface TriggerAdapter {
  register<T = unknown>(config: TriggerConfig, handler: TriggerHandler<T>): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
