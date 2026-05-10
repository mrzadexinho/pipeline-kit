---
'@idriszade/process-extract': patch
---

Swap zod-to-json-schema (Zod 3 lib) for native Zod 4 toJSONSchema; add applyStrictMode helper for OpenAI strict-mode prerequisites.

Zod 3-era zod-to-json-schema emitted `type: "None"` at root for Zod 4
outputSchemas, which OpenAI strict structured outputs rejected with
HTTP 400. Switching to Zod 4's native `toJSONSchema()` produces correct
JSON Schema. New `applyStrictMode()` helper strips `default`/`$schema`
and enforces `additionalProperties: false` + `required` matching all
property keys on every nested object — applied automatically for the
OpenAI provider only. Anthropic and Gemini providers unchanged.
