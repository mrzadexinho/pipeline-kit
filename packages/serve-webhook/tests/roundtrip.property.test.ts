import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sign, verify } from '@pipeline-kit/core';

describe('sign/verify roundtrip', () => {
  it('for arbitrary secrets and payloads: sign then verify succeeds', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }), // secret
        fc.string({ minLength: 1, maxLength: 100 }), // arbitrary text payload
        async (secret, text) => {
          // Wrap in a valid PipelineKitEvent to satisfy verify's event check
          const payload: unknown = {
            type: 'pipeline.run.created',
            data: { runId: 'pk_run_1', pipelineId: 'pk_pipe_1', text },
          };
          const body = JSON.stringify(payload);
          const sigHeader = sign(body, secret);
          const result = verify(body, sigHeader, secret);
          expect(result.error).toBeNull();
        },
      ),
      { numRuns: 50 },
    );
  });
});
