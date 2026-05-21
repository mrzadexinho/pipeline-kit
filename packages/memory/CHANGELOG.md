# @idriszade/memory

## 0.2.3

### Patch Changes

- Updated dependencies [6875740]
  - @idriszade/core@0.5.0

## 0.2.2

### Patch Changes

- Updated dependencies [d0a4472]
  - @idriszade/core@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [e899b17]
  - @idriszade/core@0.3.0

## 0.2.0

### Minor Changes

- a331d6b: M1 Core v1 Foundation — 29 ADRs shipped

  @idriszade/core: StageErrorCode 19-code taxonomy, UsageAccumulator + CostBudget, TriggerConfig + RunGuard, PipelineContext v1 fields (deps, usage, attempt optional), SerializableContext wire helpers, DisposableRegistry, Gate/Aggregate/AgentProcess patterns, definePipeline + PipelineDefinitionEnriched, PII annotation constants, Composer budget checks + disposal lifecycle + buffer 'all' mode.

  @idriszade/secrets: SecretsResolver contract, createVersionAwareResolver (cache + version tracking), createTtlResolver (TTL-based invalidation), scope() namespace facade.

  @idriszade/memory: MemoryAdapter v1 contract (read/write with LWW semantics), Listable + isListable guard, Disposable re-export from core.

### Patch Changes

- Updated dependencies [a331d6b]
- Updated dependencies [68d3766]
  - @idriszade/core@0.2.0
