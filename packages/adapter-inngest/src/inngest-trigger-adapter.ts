import type { KitTriggerEnvelope, TriggerAdapter, TriggerConfig, TriggerHandler } from '@idriszade/core';
import { mapTriggerConfig } from './create-kit-function.js';

type InngestClient = {
  createFunction: (...args: unknown[]) => unknown;
};

export class InngestTriggerAdapter implements TriggerAdapter {
  private readonly _inngest: InngestClient;
  private readonly _functions: unknown[] = [];
  private _started = false;
  private _counter = 0;

  constructor(inngest: InngestClient) {
    this._inngest = inngest;
  }

  async register<T = unknown>(config: TriggerConfig, handler: TriggerHandler<T>): Promise<void> {
    const inngestTrigger = mapTriggerConfig(config);
    const fnId = `kit-trigger-${config.kind}-${this._counter++}`;

    const fn = this._inngest.createFunction(
      { id: fnId },
      inngestTrigger,
      async ({ event }: { event: Record<string, unknown> }) => {
        const eventData = event['data'] as Record<string, unknown> | undefined;
        const envelope: KitTriggerEnvelope<T> = {
          id: typeof event['id'] === 'string' ? event['id'] : crypto.randomUUID(),
          type: config.kind,
          source: 'inngest',
          time: typeof event['ts'] === 'number'
            ? new Date(event['ts']).toISOString()
            : new Date().toISOString(),
          data: (eventData ?? {}) as T,
          ...(typeof eventData?.['dedupKey'] === 'string'
            ? { dedupKey: eventData['dedupKey'] }
            : {}),
        };
        await handler(envelope);
      },
    );

    this._functions.push(fn);
  }

  async start(): Promise<void> {
    this._started = true;
  }

  async stop(): Promise<void> {
    this._started = false;
  }

  get functions(): unknown[] {
    return this._functions;
  }

  get started(): boolean {
    return this._started;
  }
}
