import { describe, expect, it } from 'vitest';
import { createClassifyProcess } from '../src/index.js';

describe('unsupported mode', () => {
  it("mode='llm' without config.llm.extract throws", () => {
    expect(() => {
      createClassifyProcess({
        mode: 'llm',
        categories: ['urgent', 'normal'],
        // Missing llm.extract
      });
    }).toThrow('llm.extract required');
  });

  it("mode='rules' without rules throws", () => {
    expect(() => {
      createClassifyProcess({
        mode: 'rules',
        categories: ['a', 'b'],
        // Missing rules
      });
    }).toThrow('rules required');
  });
});
