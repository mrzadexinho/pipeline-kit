import type { PipelineContext, Process, ProcessError, Result } from '@pipeline-kit/core';
import { err } from '@pipeline-kit/core';

export interface RouteProcessConfig<I, O> {
  readonly id?: string;
  readonly predicate: (input: I, ctx: PipelineContext) => string | Promise<string>;
  readonly branches: Readonly<Record<string, Process<I, O>>>;
  readonly defaultBranch?: string;
}

export function createRouteProcess<I, O>(config: RouteProcessConfig<I, O>): Process<I, O> {
  const id = config.id ?? `pk_proc_route_${Math.random().toString(36).slice(2, 9)}`;

  return {
    id,
    async run(input: I, ctx: PipelineContext): Promise<Result<O, ProcessError>> {
      let branchName: string;

      try {
        branchName = await config.predicate(input, ctx);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return err<ProcessError>({
          type: 'permanent',
          code: 'predicate_error',
          message,
        });
      }

      const branch = config.branches[branchName] ?? config.branches[config.defaultBranch ?? ''];

      if (!branch) {
        return err<ProcessError>({
          type: 'permanent',
          code: 'route_no_branch',
          message: `No branch '${branchName}' and no defaultBranch`,
        });
      }

      return branch.run(input, ctx);
    },
  };
}
