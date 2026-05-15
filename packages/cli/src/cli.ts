#!/usr/bin/env node

import { inspectCommand } from './commands/inspect.js';
import { runCommand } from './commands/run.js';
import { devCommand } from './commands/dev.js';

const USAGE = `Usage: pk <command> [args] [options]

Commands:
  inspect <pipelineId>       Print pipeline definition as JSON
  run <pipelineId> [--input] Execute a pipeline
  dev                        Watch mode with local triggers

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

    default:
      console.error(`Unknown command: ${command}`);
      console.error(USAGE);
      process.exitCode = 1;
  }
}
