---
"@idriszade/core": patch
---

Refactor: split `wire/lsp-frame.ts` (462 LOC) into 5 cohesive modules
(encode, decode, async-iter decode, shared header parser, barrel re-export).
Dedups header-validation logic via new `parseFrameHeader()` helper.
Public API unchanged.
