---
"@idriszade/core": minor
"@idriszade/secrets": minor
"@idriszade/memory": minor
---

M1 Core v1 Foundation — 29 ADRs shipped

@idriszade/core: StageErrorCode 19-code taxonomy, UsageAccumulator + CostBudget, TriggerConfig + RunGuard, PipelineContext v1 fields (deps, usage, attempt optional), SerializableContext wire helpers, DisposableRegistry, Gate/Aggregate/AgentProcess patterns, definePipeline + PipelineDefinitionEnriched, PII annotation constants, Composer budget checks + disposal lifecycle + buffer 'all' mode.

@idriszade/secrets: SecretsResolver contract, createVersionAwareResolver (cache + version tracking), createTtlResolver (TTL-based invalidation), scope() namespace facade.

@idriszade/memory: MemoryAdapter v1 contract (read/write with LWW semantics), Listable + isListable guard, Disposable re-export from core.
