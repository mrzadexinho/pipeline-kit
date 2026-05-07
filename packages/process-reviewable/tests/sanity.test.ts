import { describe, expect, it } from 'vitest';
import * as processReviewable from '../src/index.js';

describe('@pipeline-kit/process-reviewable bootstrap', () => {
  it('module loads', () => {
    expect(processReviewable).toBeDefined();
  });
});
