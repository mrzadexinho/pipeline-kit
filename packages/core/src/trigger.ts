export type TriggerConfig =
  | { kind: 'cron'; expr: string }
  | { kind: 'webhook'; path: string }
  | { kind: 'event'; name: string }
  | { kind: 'manual' }
  | { kind: 'mcp'; toolName: string };

export interface RunGuard {
  concurrency?: {
    limit: number;
    overflow?: 'queue' | 'reject';
  };
  dedup?: {
    period: string;
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

export type TriggerHandler<T = unknown> = (
  envelope: KitTriggerEnvelope<T>,
) => Promise<void>;

export interface TriggerAdapter {
  register<T = unknown>(config: TriggerConfig, handler: TriggerHandler<T>): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
