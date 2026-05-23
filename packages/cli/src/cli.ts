#!/usr/bin/env node

import { devCommand } from './commands/dev.js';
import { GEN_PY_SCHEMA_HELP, genPySchemaCommand } from './commands/gen-py-schema.js';
import { inspectCommand } from './commands/inspect.js';
import { runCommand } from './commands/run.js';
import { traceCommand } from './commands/trace.js';

const USAGE = `Usage: pk <command> [args] [options]

Commands:
  inspect <pipelineId>       Print pipeline definition as JSON
  run <pipelineId> [--input] Execute a pipeline
  dev                        Watch mode with local triggers
  trace [--file <path>] [--run <id>] [--dir <dir>] [--json]
                             Display a trace from a JSONL file
  gen-py-schema --in <ts-file> --out <py-file> [--check] [--no-strict-features]
                             Generate Pydantic v2 models from Zod schemas

Options:
  --input <json>             JSON input for pk run
  --help                     Show this help message
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0];

  if (!command || command === '--help') {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case 'inspect': {
      const pipelineId = argv[1];
      if (!pipelineId) {
        console.error('Usage: pk inspect <pipelineId>');
        process.exitCode = 1;
        return;
      }
      await inspectCommand(pipelineId);
      break;
    }

    case 'run': {
      const pipelineId = argv[1];
      if (!pipelineId) {
        console.error('Usage: pk run <pipelineId>');
        process.exitCode = 1;
        return;
      }
      const inputIdx = argv.indexOf('--input');
      const input = inputIdx !== -1 ? argv[inputIdx + 1] : undefined;
      await runCommand(pipelineId, { input });
      break;
    }

    case 'trace': {
      const fileIdx = argv.indexOf('--file');
      const runIdx = argv.indexOf('--run');
      const dirIdx = argv.indexOf('--dir');
      const jsonFlag = argv.includes('--json');
      await traceCommand({
        file: fileIdx !== -1 ? argv[fileIdx + 1] : undefined,
        runId: runIdx !== -1 ? argv[runIdx + 1] : undefined,
        dir: dirIdx !== -1 ? argv[dirIdx + 1] : undefined,
        json: jsonFlag,
      });
      break;
    }

    case 'dev': {
      const { stop } = await devCommand();
      // Handle graceful shutdown
      process.on('SIGINT', () => {
        stop();
        process.exit(0);
      });
      process.on('SIGTERM', () => {
        stop();
        process.exit(0);
      });
      break;
    }

    case 'gen-py-schema': {
      if (argv.includes('--help')) {
        console.log(GEN_PY_SCHEMA_HELP);
        return;
      }
      const inIdx = argv.indexOf('--in');
      const outIdx = argv.indexOf('--out');
      const inFile = inIdx !== -1 ? argv[inIdx + 1] : undefined;
      const outFile = outIdx !== -1 ? argv[outIdx + 1] : undefined;

      if (!inFile || !outFile) {
        console.error(
          'Usage: pk gen-py-schema --in <ts-file> --out <py-file> [--check] [--no-strict-features]',
        );
        process.exitCode = 1;
        return;
      }

      const check = argv.includes('--check');
      // --strict-features is ON by default; --no-strict-features opts out
      const strictFeatures = !argv.includes('--no-strict-features');

      const code = await genPySchemaCommand({ inFile, outFile, check, strictFeatures });
      if (code !== 0) process.exitCode = code;
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error(USAGE);
      process.exitCode = 1;
  }
}
