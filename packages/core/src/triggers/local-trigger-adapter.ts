/**
 * LocalTriggerAdapter — dev/local-mode TriggerAdapter implementation.
 *
 * WARNING: This is a development-only adapter. Not suitable for production:
 *   - No HTTPS, no auth, no rate-limiting on the webhook server.
 *   - No persistence; all state is in-memory.
 *   - Cron uses wall-clock minutes, not durable scheduling.
 */

import { EventEmitter } from 'node:events';
import * as http from 'node:http';
import { ulid } from 'ulid';
import type {
  KitTriggerEnvelope,
  TriggerAdapter,
  TriggerConfig,
  TriggerHandler,
} from '../trigger.js';

// ---------------------------------------------------------------------------
// Cron parser
// ---------------------------------------------------------------------------

interface CronField {
  values: Set<number> | null; // null = wildcard (any)
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

function parseField(raw: string, min: number, max: number, expr: string): CronField {
  if (raw === '*') return { values: null };

  const values = new Set<number>();

  for (const part of raw.split(',')) {
    // Step over wildcard or range: */n or a-b/n
    const stepMatch = /^(\*|(\d+)-(\d+))\/(\d+)$/.exec(part);
    if (stepMatch) {
      // Groups 1,2,3,4 are guaranteed by the regex — non-null assertions are safe.
      // biome-ignore lint/style/noNonNullAssertion: stepMatch[4] is capture group 4, guaranteed by regex
      const step = parseInt(stepMatch[4]!, 10);
      if (step <= 0)
        throw new Error(`[@idriszade/core] invalid cron expression: "${expr}" (step <= 0)`);
      // biome-ignore lint/style/noNonNullAssertion: stepMatch[2] and [3] are capture groups guaranteed by regex
      const rangeMin = stepMatch[1] === '*' ? min : parseInt(stepMatch[2]!, 10);
      // biome-ignore lint/style/noNonNullAssertion: stepMatch[3] is capture group 3, guaranteed by regex
      const rangeMax = stepMatch[1] === '*' ? max : parseInt(stepMatch[3]!, 10);
      for (let v = rangeMin; v <= rangeMax; v += step) values.add(v);
      continue;
    }

    // Range: a-b
    const rangeMatch = /^(\d+)-(\d+)$/.exec(part);
    if (rangeMatch) {
      // biome-ignore lint/style/noNonNullAssertion: rangeMatch[1] and [2] are capture groups guaranteed by regex
      const lo = parseInt(rangeMatch[1]!, 10);
      // biome-ignore lint/style/noNonNullAssertion: rangeMatch[2] is capture group 2, guaranteed by regex
      const hi = parseInt(rangeMatch[2]!, 10);
      if (lo > hi)
        throw new Error(`[@idriszade/core] invalid cron expression: "${expr}" (range lo > hi)`);
      for (let v = lo; v <= hi; v++) values.add(v);
      continue;
    }

    // Integer
    if (/^\d+$/.test(part)) {
      const v = parseInt(part, 10);
      if (v < min || v > max) {
        throw new Error(
          `[@idriszade/core] invalid cron expression: "${expr}" (value ${v} out of range ${min}-${max})`,
        );
      }
      values.add(v);
      continue;
    }

    throw new Error(
      `[@idriszade/core] invalid cron expression: "${expr}" (unrecognised token "${part}")`,
    );
  }

  return { values };
}

export function parseCronExpression(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `[@idriszade/core] invalid cron expression: "${expr}" (expected 5 fields, got ${fields.length})`,
    );
  }
  // fields.length === 5 is guaranteed by the check above.
  const [minuteRaw, hourRaw, domRaw, monthRaw, dowRaw] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    minute: parseField(minuteRaw, 0, 59, expr),
    hour: parseField(hourRaw, 0, 23, expr),
    dayOfMonth: parseField(domRaw, 1, 31, expr),
    month: parseField(monthRaw, 1, 12, expr),
    dayOfWeek: parseField(dowRaw, 0, 6, expr),
  };
}

function fieldMatches(field: CronField, value: number): boolean {
  return field.values === null || field.values.has(value);
}

function cronMatches(parsed: ParsedCron, date: Date): boolean {
  return (
    fieldMatches(parsed.minute, date.getMinutes()) &&
    fieldMatches(parsed.hour, date.getHours()) &&
    fieldMatches(parsed.dayOfMonth, date.getDate()) &&
    fieldMatches(parsed.month, date.getMonth() + 1) &&
    fieldMatches(parsed.dayOfWeek, date.getDay())
  );
}

function minuteKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocalTriggerAdapterOptions {
  /** Port to bind the webhook HTTP server. Default 0 (OS-assigned ephemeral). */
  port?: number;
  /** Host to bind the webhook HTTP server. Default '127.0.0.1'. */
  host?: string;
}

interface CronRegistration {
  parsed: ParsedCron;
  handler: TriggerHandler<unknown>;
  lastFiredKey: string | null;
}

interface WebhookRegistration {
  path: string;
  handler: TriggerHandler<unknown>;
}

// ---------------------------------------------------------------------------
// LocalTriggerAdapter
// ---------------------------------------------------------------------------

export class LocalTriggerAdapter implements TriggerAdapter {
  private readonly _options: Required<LocalTriggerAdapterOptions>;
  private readonly _emitter = new EventEmitter();

  private readonly _cronRegs: CronRegistration[] = [];
  private readonly _webhookRegs: WebhookRegistration[] = [];

  private _started = false;
  private _server: http.Server | null = null;
  private _schedulerInterval: ReturnType<typeof setInterval> | null = null;
  private _address: { port: number; host: string } | null = null;

  constructor(options: LocalTriggerAdapterOptions = {}) {
    this._options = {
      port: options.port ?? 0,
      host: options.host ?? '127.0.0.1',
    };
  }

  /** Actual bound address after start(). Null before start() or after stop(). */
  get address(): { port: number; host: string } | null {
    return this._address;
  }

  /**
   * Register a trigger → handler binding.
   * Safe to call before or after start().
   */
  async register<T = unknown>(config: TriggerConfig, handler: TriggerHandler<T>): Promise<void> {
    const typedHandler = handler as TriggerHandler<unknown>;

    switch (config.kind) {
      case 'cron': {
        const parsed = parseCronExpression(config.expr);
        this._cronRegs.push({ parsed, handler: typedHandler, lastFiredKey: null });
        if (this._started && this._schedulerInterval === null) {
          this._startScheduler();
        }
        break;
      }
      case 'webhook': {
        this._webhookRegs.push({ path: config.path, handler: typedHandler });
        if (this._started && this._server === null) {
          await this._startServer();
        }
        break;
      }
      case 'event':
        this._emitter.on(`event:${config.name}`, typedHandler);
        break;
      case 'manual':
        this._emitter.on('manual', typedHandler);
        break;
      case 'mcp':
        this._emitter.on(`mcp:${config.toolName}`, typedHandler);
        break;
    }
  }

  /** Start the adapter. Safe to call after stop() — creates fresh resources. */
  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;

    if (this._webhookRegs.length > 0) {
      await this._startServer();
    }
    if (this._cronRegs.length > 0) {
      this._startScheduler();
    }
  }

  /** Stop the adapter. Idempotent — safe to call when not started. */
  async stop(): Promise<void> {
    if (!this._started) return;
    this._started = false;

    if (this._schedulerInterval !== null) {
      clearInterval(this._schedulerInterval);
      this._schedulerInterval = null;
    }

    if (this._server !== null) {
      const srv = this._server;
      this._server = null;
      await new Promise<void>((resolve) => {
        srv.close(() => resolve());
      });
      srv.unref();
    }

    this._address = null;
  }

  /**
   * Emit an in-memory event — the dev-mode way to fire event/manual/mcp triggers.
   * @param eventName - the event name as registered (e.g. for kind:'event' name:'foo', pass 'event:foo')
   * @param payload   - arbitrary payload; wrapped in a KitTriggerEnvelope before delivery
   */
  fire<T = unknown>(eventName: string, payload: T): void {
    const envelope: KitTriggerEnvelope<T> = {
      id: `pk_trig_${ulid()}`,
      type: eventName,
      source: 'local',
      time: new Date().toISOString(),
      data: payload,
    };
    this._emitter.emit(eventName, envelope);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async _startServer(): Promise<void> {
    const server = http.createServer((req, res) => {
      void this._handleRequest(req, res);
    });
    await new Promise<void>((resolve) => {
      server.listen(this._options.port, this._options.host, () => resolve());
    });
    server.unref();
    this._server = server;
    const addr = server.address();
    if (addr && typeof addr === 'object') {
      this._address = { port: addr.port, host: addr.address };
    }
  }

  private async _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const method = (req.method ?? 'GET').toUpperCase();

    const reg = this._webhookRegs.find((r) => r.path === url);
    if (!reg) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }

    if (method !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const rawBody = Buffer.concat(chunks).toString('utf-8');

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }

    const envelope: KitTriggerEnvelope<unknown> = {
      id: `pk_trig_${ulid()}`,
      type: 'webhook',
      source: url,
      time: new Date().toISOString(),
      data: payload,
    };

    try {
      await reg.handler(envelope);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'handler_failed', message }));
    }
  }

  private _startScheduler(): void {
    this._schedulerInterval = setInterval(() => {
      void this._schedulerTick();
    }, 1000);
  }

  private async _schedulerTick(): Promise<void> {
    const now = new Date();
    const key = minuteKey(now);
    for (const reg of this._cronRegs) {
      if (reg.lastFiredKey === key) continue;
      if (!cronMatches(reg.parsed, now)) continue;
      reg.lastFiredKey = key;
      const envelope: KitTriggerEnvelope<unknown> = {
        id: `pk_trig_${ulid()}`,
        type: 'cron',
        source: 'local-cron',
        time: now.toISOString(),
        data: {},
      };
      try {
        await reg.handler(envelope);
      } catch {
        /* swallow in dev mode */
      }
    }
  }
}
