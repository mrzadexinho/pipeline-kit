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

export interface TriggerAdapter {
  register(
    config: TriggerConfig,
    handler: (envelope: KitTriggerEnvelope<unknown>) => Promise<void>,
  ): Promise<void>;
}
