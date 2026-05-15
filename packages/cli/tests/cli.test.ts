import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';

// Mock all command modules so we only test arg-parsing in main()
vi.mock('../src/commands/inspect.js', () => ({
  inspectCommand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/commands/run.js', () => ({
  runCommand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/commands/dev.js', () => ({
  devCommand: vi.fn().mockResolvedValue({ stop: vi.fn() }),
}));

import { inspectCommand } from '../src/commands/inspect.js';
import { runCommand } from '../src/commands/run.js';
import { devCommand } from '../src/commands/dev.js';

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
});

describe('main() — help / no args', () => {
  it('prints USAGE when called with no args', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main([]);

    expect(logSpy).toHaveBeenCalledOnce();
    const output = logSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain('Usage: pk');
    expect(output).toContain('inspect');
    expect(output).toContain('run');
    expect(output).toContain('dev');
    expect(process.exitCode).toBeUndefined();

    logSpy.mockRestore();
  });

  it('prints USAGE when called with --help', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main(['--help']);

    expect(logSpy).toHaveBeenCalledOnce();
    const output = logSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain('Usage: pk');
    expect(process.exitCode).toBeUndefined();

    logSpy.mockRestore();
  });
});

describe('main() — inspect command', () => {
  it('calls inspectCommand with pipelineId', async () => {
    await main(['inspect', 'pk_pipe_test']);

    expect(inspectCommand).toHaveBeenCalledOnce();
    expect(inspectCommand).toHaveBeenCalledWith('pk_pipe_test');
    expect(process.exitCode).toBeUndefined();
  });

  it('prints error and sets exitCode=1 when pipelineId is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await main(['inspect']);

    expect(errorSpy).toHaveBeenCalledOnce();
    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain('pk inspect');
    expect(process.exitCode).toBe(1);
    expect(inspectCommand).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});

describe('main() — run command', () => {
  it('calls runCommand with pipelineId and no input', async () => {
    await main(['run', 'pk_pipe_test']);

    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith('pk_pipe_test', { input: undefined });
    expect(process.exitCode).toBeUndefined();
  });

  it('calls runCommand with pipelineId and parsed --input value', async () => {
    await main(['run', 'pk_pipe_test', '--input', '{"key":"value"}']);

    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledWith('pk_pipe_test', { input: '{"key":"value"}' });
  });

  it('prints error and sets exitCode=1 when pipelineId is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await main(['run']);

    expect(errorSpy).toHaveBeenCalledOnce();
    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain('pk run');
    expect(process.exitCode).toBe(1);
    expect(runCommand).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('passes --input value that appears after the flag', async () => {
    await main(['run', 'pk_pipe_test', '--input', 'hello']);

    expect(runCommand).toHaveBeenCalledWith('pk_pipe_test', { input: 'hello' });
  });

  it('passes undefined input when --input flag is absent', async () => {
    await main(['run', 'pk_pipe_other']);

    expect(runCommand).toHaveBeenCalledWith('pk_pipe_other', { input: undefined });
  });
});

describe('main() — dev command', () => {
  it('calls devCommand', async () => {
    await main(['dev']);

    expect(devCommand).toHaveBeenCalledOnce();
    expect(process.exitCode).toBeUndefined();
  });

  it('registers SIGINT and SIGTERM listeners after devCommand', async () => {
    const onSpy = vi.spyOn(process, 'on').mockImplementation((_event, _handler) => process);

    await main(['dev']);

    const events = onSpy.mock.calls.map((c) => c[0]);
    expect(events).toContain('SIGINT');
    expect(events).toContain('SIGTERM');

    onSpy.mockRestore();
  });
});

describe('main() — unknown command', () => {
  it('prints error and sets exitCode=1 for an unknown command', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await main(['unknown']);

    expect(errorSpy).toHaveBeenCalled();
    const firstMsg = errorSpy.mock.calls[0]?.[0] as string;
    expect(firstMsg).toContain('unknown');
    expect(process.exitCode).toBe(1);

    errorSpy.mockRestore();
  });

  it('includes USAGE in output for unknown command', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await main(['bogus-command']);

    const allOutput = errorSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(allOutput).toContain('Usage: pk');

    errorSpy.mockRestore();
  });
});
