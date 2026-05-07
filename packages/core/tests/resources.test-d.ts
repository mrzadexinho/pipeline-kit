import { expect, test } from 'tstyche';
import { createPipelineKit, type PipelineKitClient } from '../src/client.js';
import type { AtomsResource } from '../src/resources/atoms.js';
import type { PipelinesResource } from '../src/resources/pipelines.js';
import type { RunsResource } from '../src/resources/runs.js';
import type { WebhooksResource } from '../src/resources/webhooks.js';

declare const pk: PipelineKitClient;

test('createPipelineKit returns PipelineKitClient', () => {
  expect(createPipelineKit()).type.toBe<PipelineKitClient>();
});

test('PipelineKitClient exposes the 4 v0 resources (NO pk.adapters)', () => {
  expect<PipelineKitClient>().type.toBeAssignableTo<{
    pipelines: PipelinesResource;
    runs: RunsResource;
    atoms: AtomsResource;
    webhooks: WebhooksResource;
  }>();
});

test('PipelineKitClient does NOT have an adapters resource', () => {
  expect<PipelineKitClient>().type.not.toBeAssignableTo<{ adapters: unknown }>();
});

test('webhooks.sign signature is preserved on the resource', () => {
  expect(pk.webhooks.sign('payload', 'secret')).type.toBe<string>();
});
