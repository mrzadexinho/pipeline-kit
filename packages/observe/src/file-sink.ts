import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { KitSpanRecord, SpanSink } from './exporter.js';

export interface FileSinkOptions {
  /**
   * Optional run ID used as the filename stem: `<runId>.jsonl`.
   * If omitted, the sink falls back to the first record's traceId on first write.
   */
  runId?: string;
  /**
   * Directory to write trace files into.
   * Resolution order:
   *   1. constructor `dir`
   *   2. PK_TRACE_DIR env var
   *   3. `.pk/traces/` relative to cwd
   */
  dir?: string;
}

/**
 * SpanSink that appends JSONL records to a file under a configurable directory.
 * Uses lazy directory creation on first write. No sync I/O on hot path.
 */
export class FileSinkExporter implements SpanSink {
  readonly #runId: string | undefined;
  readonly #dir: string;
  #dirCreated = false;

  constructor(options: FileSinkOptions = {}) {
    this.#runId = options.runId;
    this.#dir = options.dir ?? process.env.PK_TRACE_DIR ?? join(process.cwd(), '.pk', 'traces');
  }

  async write(records: ReadonlyArray<KitSpanRecord>): Promise<void> {
    if (records.length === 0) return;

    if (!this.#dirCreated) {
      await mkdir(this.#dir, { recursive: true });
      this.#dirCreated = true;
    }

    // Determine filename: use runId or fall back to first record's traceId.
    const stem = this.#runId ?? records[0]?.traceId ?? 'unknown';
    const filePath = join(this.#dir, `${stem}.jsonl`);

    const lines = records.map((r) => `${JSON.stringify(r)}\n`).join('');
    await appendFile(filePath, lines, 'utf8');
  }

  /** No-op: appendFile auto-closes file handles. Reserved for future flush logic. */
  async close(): Promise<void> {
    // intentional no-op
  }
}
