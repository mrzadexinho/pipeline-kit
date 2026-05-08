# @pipeline-kit/process-route

Process adapter for predicate-based routing of atoms to downstream stages.

## Install

```bash
pnpm add @pipeline-kit/process-route
```

## Usage

```typescript
import { createRouteProcess } from '@pipeline-kit/process-route';

const route = createRouteProcess<Ticket, Handled>({
  predicate: (ticket) => (ticket.priority === 'p0' ? 'urgent' : 'normal'),
  branches: {
    urgent: urgentProcess,
    normal: normalProcess,
  },
  defaultBranch: 'normal',
});
```

## Reference

Canonical API surface: [`docs/spec-adapters.md`](../../docs/spec-adapters.md). Core types: [`docs/spec-api-surface.md`](../../docs/spec-api-surface.md).
