import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

describe('@pipeline-kit/core bootstrap', () => {
  it('module loads', () => {
    expect(core).toBeDefined();
  });
});
