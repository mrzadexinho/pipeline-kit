import {
  err,
  ok,
  type PipelineContext,
  type Process,
  type ProcessError,
  type Result,
  type RetryPolicy,
} from '@idriszade/core';
import { z } from 'zod';
import { type ClassifyRule, evalRule } from './rule-eval.js';

export interface ClassifyProcessConfig<I> {
  id?: string;
  mode: 'rules' | 'llm';
  categories: ReadonlyArray<string>;
  rules?: ClassifyRule[];
  defaultCategory?: string;
  llm?: {
    extract: Process<I, { category: string }>;
  };
  retryPolicy?: Partial<RetryPolicy>;
}

export interface ClassifyOutput {
  category: string;
  matchedRule?: ClassifyRule;
}

const ClassifyOutputSchema = z.object({
  category: z.string(),
  matchedRule: z
    .object({
      field: z.string(),
      match: z.enum(['equals', 'contains', 'regex', 'gt', 'lt']),
      value: z.unknown(),
      category: z.string(),
      priority: z.number().optional(),
    })
    .optional(),
});

export function createClassifyProcess<I>(
  config: ClassifyProcessConfig<I>,
): Process<I, ClassifyOutput> {
  validateConfig(config);

  const id = config.id ?? `pk_proc_classify_${Date.now()}`;
  const outputSchema = ClassifyOutputSchema;
  const retryPolicy = config.retryPolicy;

  if (config.mode === 'rules') {
    return {
      id,
      outputSchema,
      retryPolicy,
      async run(input: I): Promise<Result<ClassifyOutput, ProcessError>> {
        return classifyWithRules(
          input,
          config as ClassifyProcessConfig<I> & { rules: ClassifyRule[] },
        );
      },
    };
  }

  // mode === 'llm'
  const extract = config.llm?.extract;
  if (!extract) {
    throw new Error('ClassifyProcessConfig: llm.extract required when mode is "llm"');
  }
  return {
    id,
    outputSchema,
    retryPolicy,
    async run(input: I, ctx: PipelineContext): Promise<Result<ClassifyOutput, ProcessError>> {
      const result = await extract.run(input, ctx);
      if (result.error) {
        return result as Result<ClassifyOutput, ProcessError>;
      }
      return ok({ category: result.data.category });
    },
  };
}

function validateConfig<I>(config: ClassifyProcessConfig<I>): void {
  if (config.mode === 'rules') {
    if (!config.rules || config.rules.length === 0) {
      throw new Error('ClassifyProcessConfig: rules required when mode is "rules"');
    }
  }

  if (config.mode === 'llm') {
    if (!config.llm?.extract) {
      throw new Error('ClassifyProcessConfig: llm.extract required when mode is "llm"');
    }
  }
}

function classifyWithRules<I>(
  input: I,
  config: ClassifyProcessConfig<I> & { rules: ClassifyRule[] },
): Result<ClassifyOutput, ProcessError> {
  const sorted = [...config.rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of sorted) {
    if (evalRule(rule, input)) {
      return ok({ category: rule.category, matchedRule: rule });
    }
  }

  if (config.defaultCategory) {
    return ok({ category: config.defaultCategory });
  }

  return err({
    type: 'permanent',
    code: 'classify_no_match',
    message: 'No rule matched and no defaultCategory set',
  } as ProcessError);
}
