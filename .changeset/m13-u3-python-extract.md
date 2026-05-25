---
---

feat(adapter-python-process-extract): new Python adapter mirroring process-extract TS

Adds `pkit-process-extract` PyPI package with `create_extract_process` factory.
Three-provider support (anthropic / openai / google) via optional peer deps,
Pydantic schema → JSON Schema conversion, retry-on-schema-failure loop with
configurable max attempts. Mirrors `@idriszade/process-extract` TS shape.

Publish job in release.yml will be added in a follow-up commit after PyPI
Trusted Publisher registration completes for `pkit-process-extract`.
