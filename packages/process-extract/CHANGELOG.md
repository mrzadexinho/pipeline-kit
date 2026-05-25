# @idriszade/process-extract

## 0.1.10

### Patch Changes

- Updated dependencies [102c627]
  - @idriszade/core@0.6.2

## 0.1.9

### Patch Changes

- Updated dependencies [62c7446]
  - @idriszade/core@0.6.1

## 0.1.8

### Patch Changes

- Updated dependencies [7c46265]
  - @idriszade/core@0.6.0

## 0.1.7

### Patch Changes

- Updated dependencies [4ca032d]
  - @idriszade/core@0.5.2

## 0.1.6

### Patch Changes

- Updated dependencies [7a07c7f]
  - @idriszade/core@0.5.1

## 0.1.5

### Patch Changes

- Updated dependencies [6875740]
  - @idriszade/core@0.5.0

## 0.1.4

### Patch Changes

- Updated dependencies [d0a4472]
  - @idriszade/core@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies [e899b17]
  - @idriszade/core@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [a331d6b]
- Updated dependencies [68d3766]
  - @idriszade/core@0.2.0

## 0.1.1

### Patch Changes

- 9d57b38: Swap zod-to-json-schema (Zod 3 lib) for native Zod 4 toJSONSchema; add applyStrictMode helper for OpenAI strict-mode prerequisites.

  Zod 3-era zod-to-json-schema emitted `type: "None"` at root for Zod 4
  outputSchemas, which OpenAI strict structured outputs rejected with
  HTTP 400. Switching to Zod 4's native `toJSONSchema()` produces correct
  JSON Schema. New `applyStrictMode()` helper strips `default`/`$schema`
  and enforces `additionalProperties: false` + `required` matching all
  property keys on every nested object — applied automatically for the
  OpenAI provider only. Anthropic and Gemini providers unchanged.

## 0.1.0

### Minor Changes

- Initial public release — M0 + M0.5 reference adapters under @idriszade
  scope. Composer + Pipeline factory + 4 Sources + 3 Stores + 5 Processes +
  4 Serves. v0 contracts per spec.md ADRs 1-23. APIs may break before
  1.0.0.

### Patch Changes

- Updated dependencies
  - @idriszade/core@0.1.0
