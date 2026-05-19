import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KitSpanRecord } from '@idriszade/observe';
import { CACHE_SUB_FIELDS, REASONING_SUB_FIELDS } from '@idriszade/observe';

export interface TraceCommandOptions {
  file?: string;
  runId?: string;
  dir?: string;
  json?: boolean;
}

function resolvePath(opts: TraceCommandOptions): string | null {
  if (opts.file) return opts.file;
  if (opts.runId) {
    const base = opts.dir ?? process.env['PK_TRACE_DIR'] ?? '.pk/traces';
    return join(base, `${opts.runId}.jsonl`);
  }
  return null;
}

function parseSpans(raw: string, filePath: string): KitSpanRecord[] {
  const spans: KitSpanRecord[] = [];
  raw.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      spans.push(JSON.parse(line) as KitSpanRecord);
    } catch {
      console.error(`Malformed JSONL at line ${i + 1} in ${filePath}`);
    }
  });
  return spans;
}

const NON_ADDITIVE = new Set<string>([...CACHE_SUB_FIELDS, ...REASONING_SUB_FIELDS]);

function rollupUsage(spans: KitSpanRecord[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const span of spans)
    for (const [k, v] of Object.entries(span.attributes))
      if (k.startsWith('gen_ai.usage.') && !NON_ADDITIVE.has(k) && typeof v === 'number')
        totals[k] = (totals[k] ?? 0) + v;
  return totals;
}

function sumAttr(spans: KitSpanRecord[], key: string): number {
  return spans.reduce((acc, s) => {
    const v = s.attributes[key];
    return acc + (typeof v === 'number' ? v : 0);
  }, 0);
}

interface TreeNode {
  span: KitSpanRecord;
  children: TreeNode[];
}

function buildTree(spans: KitSpanRecord[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(spans.map((s) => [s.spanId, { span: s, children: [] }]));
  const spanIds = new Set(spans.map((s) => s.spanId));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const pid = node.span.parentSpanId;
    if (pid && spanIds.has(pid)) byId.get(pid)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function renderTree(roots: TreeNode[]): string[] {
  const lines: string[] = [];
  function walk(node: TreeNode, prefix: string, isLast: boolean): void {
    const ms = ((node.span.endTimeNs - node.span.startTimeNs) / 1_000_000).toFixed(2);
    lines.push(
      `${prefix}${isLast ? '└─' : '├─'} ${node.span.name}` +
        ` [${ms}ms] runId=${node.span.traceId.slice(0, 8)} stage=${node.span.spanId.slice(-6)}`,
    );
    const cp = prefix + (isLast ? '   ' : '│  ');
    node.children.forEach((c, i) => {
      walk(c, cp, i === node.children.length - 1);
    });
  }
  roots.forEach((r, i) => {
    walk(r, '', i === roots.length - 1);
  });
  return lines;
}

function renderUsageTable(spans: KitSpanRecord[]): string[] {
  return spans.flatMap((span) => {
    const entries = Object.entries(span.attributes).filter(
      ([k, v]) => k.startsWith('gen_ai.usage.') && typeof v === 'number' && (v as number) > 0,
    );
    if (!entries.length) return [];
    const parts = entries.map(([k, v]) => `${k.replace('gen_ai.usage.', '')}=${v}`).join(' ');
    return [`  ${span.name}: ${parts}`];
  });
}

export async function traceCommand(opts: TraceCommandOptions): Promise<void> {
  const filePath = resolvePath(opts);
  if (!filePath) {
    console.error('Usage: pk trace [--file <path>] [--run <id>]');
    process.exitCode = 1;
    return;
  }

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    console.error(`Cannot read trace file: ${filePath}`);
    process.exitCode = 1;
    return;
  }

  const spans = parseSpans(raw, filePath);
  if (!spans.length) {
    console.error(`No spans in ${filePath}`);
    process.exitCode = 1;
    return;
  }

  const sorted = [...spans].sort((a, b) => a.startTimeNs - b.startTimeNs);

  if (opts.json) {
    console.log(JSON.stringify({ spans: sorted, usage: rollupUsage(sorted) }, null, 2));
    return;
  }

  for (const l of renderTree(buildTree(sorted))) console.log(l);

  const usageLines = renderUsageTable(sorted);
  if (usageLines.length) {
    console.log('');
    console.log('Usage per stage:');
    for (const l of usageLines) console.log(l);
  }

  const totals = rollupUsage(sorted);
  console.log('');
  console.log(
    `Total: input=${totals['gen_ai.usage.input_tokens'] ?? 0}` +
      ` output=${totals['gen_ai.usage.output_tokens'] ?? 0}` +
      ` reasoning=${sumAttr(sorted, 'gen_ai.usage.output_tokens.reasoning')}` +
      ` cache_read=${sumAttr(sorted, 'gen_ai.usage.input_tokens.cache_read')} *non-additive*`,
  );
}
