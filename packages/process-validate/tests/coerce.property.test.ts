import type { PipelineContext, TraceContext } from '@idriszade/core';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { z } from 'zod';
import { createValidateProcess } from '../src/index.js';

// Minimal trace context stub
const stubTrace = {} as TraceContext;

describe('ValidateProcess property tests', () => {
  const makeCtx = (): PipelineContext => ({
    runId: 'pk_run_test',
    pipelineId: 'pk_pipe_test',
    attempt: 1,
    metadata: {},
    signal: new AbortController().signal,
    trace: stubTrace,
    attachMetadata() {},
  });

  it('coerce mode with schema-with-catch always succeeds', async () => {
    const schemaWithCatch = z.object({
      a: z.string().catch('default'),
      b: z.number().catch(0),
    });

    await fc.assert(
      fc.asyncProperty(fc.object({ a: fc.anything(), b: fc.anything() }), async (input) => {
        const process = createValidateProcess({
          schema: schemaWithCatch,
          mode: 'coerce',
        });
        const result = await process.run(input as never, makeCtx());
        // With .catch() on all fields, coerce mode should always succeed
        return result.error === null;
      }),
      { numRuns: 50 },
    );
  });
});
