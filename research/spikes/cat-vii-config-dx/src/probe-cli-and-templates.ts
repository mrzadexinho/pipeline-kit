/**
 * Cat VII — Cell B: probe-cli-and-templates.ts
 * Q3+Q4+Q5: CLI surface, template factories, PRP-as-Source, env-specific config.
 *
 * Compare: Inngest CLI (Go binary), @trigger.dev/cli (npm), Temporal CLI (Go binary),
 *          Hatchet CLI (npm wrapper), Pulumi TS SDK (code > config files).
 */

import { z } from 'zod';

// ─── Kit types (inline, spike-only) ──────────────────────────────────────────

type Ok<T>  = { ok: true; value: T };
type Err<E> = { ok: false; error: E };
type Result<T, E> = Ok<T> | Err<E>;

interface Source<O>  { readonly _brand: 'Source';  fetch(): AsyncGenerator<Result<O, Error>> }
interface Process<I, O> { readonly _brand: 'Process'; run(i: I): Promise<Result<O, Error>> }
interface Serve<I>   { readonly _brand: 'Serve';   send(p: I): Promise<Result<void, Error>> }

type TriggerConfig = { type: 'cron'; schedule: string }
  | { type: 'webhook'; path: string }
  | { type: 'manual' };

interface RetryPolicy { maxAttempts: number; backoff: 'linear' | 'exponential' | 'fixed' }
interface ConcurrencyPolicy { maxConcurrent: number; queue?: 'drop' | 'buffer' }

interface DefinedPipeline<O> {
  readonly id: string;
  readonly trigger?: TriggerConfig;
  readonly retry?: RetryPolicy;
  readonly concurrency?: ConcurrencyPolicy;
  readonly source: Source<O>;
  readonly process?: Process<unknown, O>;
  readonly serve?: Serve<O>;
}

// ─── §O1: Minimum CLI surface ─────────────────────────────────────────────────
// Map each `pk` command to framework equivalent.

interface CliCommand {
  command: string;
  description: string;
  analogues: string[];
  estimatedLoc: number;  // implementation lines — target thin wrapper
}

const pkCliSurface: CliCommand[] = [
  {
    command: 'pk dev',
    description: 'Local dev server: loads pipeline files, auto-reloads, exposes manual trigger UI',
    analogues: ['inngest dev (Go binary, local event server)', 'npx trigger.dev@latest dev (npm, tunnel)'],
    estimatedLoc: 60,  // file-watcher + HTTP server stub + pipeline loader
  },
  {
    command: 'pk run <pipeline-id>',
    description: 'Manual trigger: resolves pipeline by id, calls run() with empty input',
    analogues: ['temporal workflow start --workflow-type X', 'hatchet run <workflow-name>'],
    estimatedLoc: 30,  // id-lookup + run() invocation + result pretty-print
  },
  {
    command: 'pk inspect <pipeline-id>',
    description: 'Print pipeline.describe() output as structured JSON (id, steps, trigger, retry)',
    analogues: ['inngest --help (no direct equivalent)', 'kubectl describe (closest analogue)'],
    estimatedLoc: 20,  // id-lookup + JSON.stringify(pipeline.describe())
  },
  {
    command: 'pk trace <run-id>',
    description: 'Fetch + pretty-print OTel trace for a completed run (local OTLP or Jaeger)',
    analogues: ['inngest dashboard CLI view (no direct CLI, UI only)', 'jaeger-query CLI'],
    estimatedLoc: 40,  // OTLP fetch + span tree pretty-print
  },
];

// VERDICT: PASS — 4 commands, ~150 LOC total.
//   CLI is a THIN wrapper over pipeline.run() + pipeline.describe() + OTLP.
//   NOT a config DSL. NOT a YAML processor. Just TS ergonomics.
//   Compare: Trigger.dev @trigger.dev/cli (npm) — same pattern as @idriszade/cli.

const totalCliLoc = pkCliSurface.reduce((s, c) => s + c.estimatedLoc, 0);
// totalCliLoc = 150

// ─── §O2: CLI as @idriszade/cli package ──────────────────────────────────────
// Package shape comparison.

interface CliPackageShape {
  name: string;
  binEntry: string;
  coreDep: string;
  delivery: 'npm' | 'go-binary' | 'standalone';
  rationale: string;
}

const cliPackageComparison: CliPackageShape[] = [
  {
    name: '@idriszade/cli',
    binEntry: 'dist/cli.js → bin: { pk: "dist/cli.js" }',
    coreDep: '@idriszade/core (pipeline.describe(), pipeline.run())',
    delivery: 'npm',
    rationale: 'TS ecosystem consistency; no build/install step beyond npm i -g; pnpm monorepo',
  },
  {
    name: 'inngest-cli',
    binEntry: 'Go binary — released as GitHub release asset',
    coreDep: 'None (separate language boundary)',
    delivery: 'go-binary',
    rationale: 'Inngest server-side infra written in Go; CLI is infra tool not SDK wrapper',
  },
  {
    name: '@trigger.dev/cli',
    binEntry: 'npx trigger.dev@latest (npm package with bin)',
    coreDep: '@trigger.dev/core (same language boundary)',
    delivery: 'npm',
    rationale: 'Same pattern as @idriszade/cli — TS CLI for TS runtime',
  },
];

// VERDICT: PASS — @idriszade/cli as npm package is correct.
//   Trigger.dev's pattern (@trigger.dev/cli) is identical and proven.
//   Go binary only makes sense when the runtime is Go (Inngest, Temporal server).
//   Kit is pure TS/Node — npm package, same monorepo, shares @idriszade/core.

// ─── §O3: Templates = factory functions, NOT JSON ────────────────────────────
// createExtractPipeline() as convenience factory — Pulumi's component model in TS.

const apifySchema = z.object({ title: z.string(), url: z.string() });
type ApifyItem = z.infer<typeof apifySchema>;

const extractSchema = z.object({ summary: z.string(), tags: z.array(z.string()) });
type ExtractResult = z.infer<typeof extractSchema>;

function createApifySourceStub(_c: { datasetId: string; schema: z.ZodObject<z.ZodRawShape> }): Source<ApifyItem> {
  return { _brand: 'Source', async *fetch(): AsyncGenerator<Result<ApifyItem, Error>> { yield { ok: true, value: { title: 'T', url: 'U' } } } };
}
function createExtractProcessStub(_c: { model: string; schema: z.ZodObject<z.ZodRawShape> }): Process<ApifyItem, ExtractResult> {
  return { _brand: 'Process', async run(_i: ApifyItem) { return { ok: true as const, value: { summary: 's', tags: [] } } } };
}
function createEmailServeStub(_c: { to: string; subject: string }): Serve<ExtractResult> {
  return { _brand: 'Serve', async send(_p: ExtractResult) { return { ok: true as const, value: undefined } } };
}

// Template factory: createExtractPipeline — wraps common pattern, returns DefinedPipeline
interface ExtractPipelineConfig {
  id: string;
  datasetId: string;
  model: 'claude-sonnet-4-6' | 'claude-opus-4-5';
  schema: z.ZodObject<z.ZodRawShape>;
  emailTo: string;
  emailSubject: string;
  trigger?: TriggerConfig;
  retry?: RetryPolicy;
}

function createExtractPipeline(cfg: ExtractPipelineConfig): DefinedPipeline<ExtractResult> {
  // Pulumi component model: a TS function that encapsulates a common pattern.
  // NOT a JSON template. NOT a YAML file. Real TS with real types.
  return {
    id: cfg.id,
    trigger: cfg.trigger ?? { type: 'manual' },
    retry:   cfg.retry  ?? { maxAttempts: 3, backoff: 'exponential' },
    source:  createApifySourceStub({ datasetId: cfg.datasetId, schema: cfg.schema }),
    process: createExtractProcessStub({ model: cfg.model, schema: cfg.schema }),
    serve:   createEmailServeStub({ to: cfg.emailTo, subject: cfg.emailSubject }),
  };
}

// Compare: Hatchet's migration FROM JSON workflow definitions TO hatchet.task() factory.
// "More ergonomic" in their changelog — same reason factory > JSON template.
const extractPipeline = createExtractPipeline({
  id: 'pk_pipe_apify-extract',
  datasetId: 'ds_123',
  model: 'claude-sonnet-4-6',
  schema: extractSchema,
  emailTo: 'user@example.com',
  emailSubject: 'Weekly Extract',
  trigger: { type: 'cron', schedule: '0 9 * * 1' },
});
// VERDICT: PASS — factory function IS the template.
//   Encapsulates pattern, preserves types, no deserialization.
//   IDE: rename model → auto-updates everywhere. JSON: find-replace only.

// ─── §O4: PRP-as-Source, NOT PRP-as-Spec ────────────────────────────────────
// PRP (Project Requirements Prompt) from cole-memdex.

interface PRPContent {
  projectId: string;
  requirements: string;
  context: string;
  constraints: string[];
}

interface AnalysisResult {
  findings: string[];
  recommendations: string[];
  confidence: number;
}

// PRP is structured prompt data — it is a Source atom, not a new stage type.
function createPRPSource(_cfg: { prpPath: string }): Source<PRPContent> {
  return {
    _brand: 'Source',
    async *fetch(): AsyncGenerator<Result<PRPContent, Error>> {
      // Reads PRP file, emits one PRPContent atom per run
      yield {
        ok: true,
        value: { projectId: 'pk_src_prp', requirements: '...', context: '...', constraints: [] },
      };
    },
  };
}

// Compare with Cat II ADR-II-2: MCP Prompts = Source variant.
// PRP is the same: structured prompt document → Source<PRPContent>
// It is NOT: Spec<I> (no new stage type needed), NOT: Process (no transform logic)
// The pipeline: Source<PRPContent> → Process<PRPContent, AnalysisResult> → Serve<AnalysisResult>
const prpSource = createPRPSource({ prpPath: './docs/prp/project.md' });
// VERDICT: PASS — PRP maps cleanly to Source<PRPContent>.
//   No new stage type. Same pattern as MCP Prompts (Cat II ADR-II-2).
//   PRP specifics live in the Source adapter config, not the stage contract.

// ─── §O5: Environment-specific config via definePipeline overrides ───────────
// Pulumi principle: "real programming language = real conditionals."

function definePipelineO5<O>(config: DefinedPipeline<O>): DefinedPipeline<O> {
  if (!config.id.startsWith('pk_pipe_')) throw new Error('bad id prefix');
  return config;
}

const envAwarePipeline = definePipelineO5<ExtractResult>({
  id: 'pk_pipe_extract-env-aware',
  trigger: process.env['NODE_ENV'] === 'production'
    ? { type: 'cron', schedule: '0 9 * * 1' }   // prod: scheduled
    : { type: 'manual' },                          // dev: manual only
  retry: {
    maxAttempts: process.env['NODE_ENV'] === 'production' ? 5 : 1,
    backoff: 'exponential',
  },
  concurrency: {
    maxConcurrent: process.env['NODE_ENV'] === 'production' ? 10 : 1,
    queue: 'buffer',
  },
  source: createApifySourceStub({ datasetId: 'ds_456', schema: extractSchema }),
  process: createExtractProcessStub({ model: 'claude-sonnet-4-6', schema: extractSchema }),
  serve:   createEmailServeStub({ to: 'user@example.com', subject: 'Report' }),
});

// TS ternary IS the environment switch. No .env-specific YAML files.
// No template substitution. No env-aware deserialization.
// Compare: Pulumi — TS conditionals ARE the IaC branching mechanism.
//   Won over Terraform HCL specifically because: if/else, loops, real types.
// VERDICT: PASS — process.env ternary in definePipeline() is the idiomatic pattern.
//   No YAML overrides. No config files per environment. One TS file, one truth.

console.log('[Cell B] cli-and-templates probe complete');
console.log('  CLI total estimated LOC:', totalCliLoc);
console.log('  CLI delivery: npm package (@idriszade/cli)');
console.log('  Template factory: createExtractPipeline() returns', typeof extractPipeline.source._brand);
console.log('  PRP brand:', prpSource._brand, '(Source — no new stage type)');
console.log('  Env-aware trigger:', envAwarePipeline.trigger?.type);
console.log('  Env-aware retry maxAttempts:', envAwarePipeline.retry?.maxAttempts);
console.log('  CLI comparison:', cliPackageComparison.map(c => `${c.name}=${c.delivery}`).join(', '));
