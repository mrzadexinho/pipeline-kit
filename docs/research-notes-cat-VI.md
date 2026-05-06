> Phase 1 research notes — Category VI (Type / schema / validation). Back to [research-notes.md](research-notes.md) (synthesis) · [research-notes-full.md](research-notes-full.md) (master).

## Category VI — Type / schema / validation

Why SEVENTH: directly informs ADR6 (Zod boundary validation) + ADR11 (migration story / Drizzle). Cross-references Cat I source 1 (Effect Schema) and Cat II source 13 (Gatewerk-sdk-ts uses Zod).

### 33. Zod — https://zod.dev
- **Purpose:** TypeScript-first runtime schema validation with static type inference. Industry default for boundary validation in TS.
- **Core abstractions (verbatim):** `z.object`, `z.string`, `z.number`, `z.array`, `z.union`, `z.discriminatedUnion`, `z.literal`, `z.enum`, `z.coerce`, `z.refine`, `z.transform`, `ZodSchema`, `ZodError`, `z.infer<typeof Schema>`.
- **API surface (representative):**
  ```typescript
  const User = z.object({ name: z.string(), age: z.number().int().positive() });
  const data = User.parse(input);                    // throws ZodError on fail
  const result = User.safeParse(input);              // { success, data | error }
  type UserType = z.infer<typeof User>;              // static type extraction
  z.string().transform(s => s.toUpperCase());        // pipe transformations
  z.object({ password: z.string() }).refine(d => d.password.length > 8);
  ```
- **What to lift:**
  - **Whole library at every Source/Serve boundary** → **ADR6** locked. Zod is industry default; ecosystem already has bindings (`drizzle-zod`, `@hono/zod-validator`, tRPC).
  - **`safeParse` returning `{ success, data | error }` discriminated union** → mirrors kit's Result<T,E> shape (**ADR4**). Direct compatibility.
  - **`z.discriminatedUnion`** → use for kit's webhook event types, Reviewable response types, error kinds.
  - **`z.transform` + `z.coerce`** → boundary coercion at Source intake (Pydantic-boundary-coercion lesson from pursuit's `feedback_pydantic_boundary_coercion.md` — coerce, don't reject).
- **What to avoid:**
  - Don't use `z.parse` (throws) at kit boundaries — use `z.safeParse` to keep errors in Result shape.
  - Don't define schemas inside hot paths — schema construction has a one-time cost.
  - Don't pair with TypeScript `<5.5` — Zod 4 requires 5.5+ and `strict: true`.
- **Stated non-goals:** Not an ORM, not a serialization framework — boundary validator only.
- **License + community:** MIT. ~45k+ stars (per ArkType comparison). Zero dependencies. 2KB gzipped core. **Already used across Gatewerk + pursuit + agent-forge.**

### 34. Pydantic AI — https://pydantic.dev/docs/ai/overview/
- **Purpose:** Python framework for production-grade typed agent applications. Type-safe LLM interactions, structured outputs via Pydantic models, auto-derived tool schemas. **Conceptual reference for `extract-process` adapter design**, not for direct adoption (kit is TS).
- **Core abstractions (verbatim):**
  - `Agent[Deps, Output]` — main orchestrator with typed deps + output channels.
  - `Tool` — LLM-callable function with auto-derived JSON schema from type hints + docstring.
  - `RunContext` — carrier for dependency injection into tools and instructions.
  - `deps_type` / `output_type` — generic type parameters for compile-time safety.
  - `@agent.tool` — decorator registering a tool.
  - `@agent.instructions` — static or dynamic system-prompt directives.
- **API surface (canonical Python):**
  ```python
  agent = Agent('anthropic:claude-sonnet-4-6', instructions='Be concise.')

  @agent.tool
  async def customer_balance(ctx: RunContext[Deps]) -> float:
      """Returns account balance."""
      return await ctx.deps.db.fetch(ctx.deps.customer_id)

  class SupportOutput(BaseModel):
      advice: str
      risk: int = Field(ge=0, le=10)

  agent = Agent(..., output_type=SupportOutput)
  result = await agent.run('What is my balance?', deps=deps)
  ```
- **What to lift (TS-transferable patterns):**
  - **Generic agent typing `Agent<Deps, Output>`** → kit's `Process<I, O>` is conceptually similar; `extract-process` adapter wraps LLM call with input I + output O. Type-level safety from end to end.
  - **Schema-from-types via Pydantic → Zod equivalent for TS:** `extract-process` adapter accepts a Zod schema for output; auto-derives JSON schema for LLM (using `zod-to-json-schema`); validates LLM response against same schema. **Direct pattern lift.**
  - **Validation-driven retry loop on structured-output failures** → ADR13 reinforced. If LLM emits malformed JSON, kit retries with the schema in the prompt.
  - **RunContext for dependency threading** → kit's pass-through Context (**ADR5**) is conceptually equivalent.
- **What to avoid:**
  - Don't ship a Python pipeline-kit (TS-primary per CLAUDE.md). Pursuit's pursuit-kit-Python bridges via MCP per **ADR20**.
  - Don't lift Pydantic AI's decorator-based registration verbatim — TS uses higher-order functions per Cat IV synthesis open question 4.
- **Stated non-goals:** Python-only; not a workflow engine; not a multi-agent orchestrator (single-agent focus, child-agents via tools).
- **License + community:** MIT. Actively maintained by Pydantic team. ~10k+ stars. Production adoption growing.

### 35. Effect Schema — `@effect/schema` package (REFERENCED via Cat I source 1)
- **Purpose:** Effect ecosystem's data validation + serialization library. Type-aligned schemas with bidirectional encode/decode. **Alternative to Zod IF ADR1 adopts Effect.**
- **Core abstractions (verbatim, from source 1 + common knowledge):**
  - `Schema.Struct({ ... })` — object schema.
  - `Schema.String`, `Schema.Number`, `Schema.Array(...)`, `Schema.Union(...)`, etc.
  - `Schema.decode(schema)(input)` — runtime decode (returns Effect).
  - `Schema.encode(schema)(value)` — bidirectional encode (rare in Zod).
  - `Schema.transform(from, to, { decode, encode })` — bidirectional transformations.
- **API surface (representative):**
  ```typescript
  import * as Schema from "@effect/schema/Schema";

  const User = Schema.Struct({
    name: Schema.String,
    age: Schema.Number.pipe(Schema.greaterThan(0)),
  });

  const decoded = Schema.decodeUnknown(User)(input); // Effect<User, ParseError>
  ```
- **What to lift:**
  - **Bidirectional encode/decode** is genuinely novel vs Zod — useful for Atom serialization round-tripping (test plan §12 lists "Store.put().then(Store.get) round-trips Atom integrity").
  - **Effect-aware composition** — if **ADR1** adopts Effect, Schema integrates with Layer DI + error channel natively.
- **What to avoid:**
  - Don't adopt Effect Schema in v0 — locks **ADR1** decision. Vanilla TS + Zod is the v0 path.
  - Don't dual-import Zod + Effect Schema — pick one per project area.
- **Stated non-goals:** Not a standalone library — coupled to Effect runtime.
- **License + community:** MIT (part of Effect-TS monorepo). See source 2 for ecosystem.

### 36. ArkType — https://arktype.io
- **Purpose:** TypeScript runtime validator with **string-syntax schemas** (TS-string-as-schema parsing) and editor-level type feedback. Positions as faster alternative to Zod (claims 20x faster object validation; 14ns vs 281ns Node v23.6.1).
- **Core abstractions (verbatim):**
  - `type({...})` — schema definition (replaces `z.object`).
  - `type.errors` — error introspection.
  - `.extends(other)` — type relationship introspection.
  - `.or(other)` — union with discriminated narrowing.
  - **String-syntax schemas:** `"'android' | 'ios'"`, `"number > 0"`, `"string[]"`, `"date | null"` — TS strings parsed as runtime types.
  - `scope({...})` — namespaced type definitions.
- **API surface (representative):**
  ```typescript
  const User = type({
    name: "string",
    platform: "'android' | 'ios'",
    "version?": "number | string",  // optional via key suffix
  });

  const Account = type({ kind: "'admin'", "powers?": "string[]" })
    .or({ kind: "'superadmin'", "superpowers?": "string[]" });

  User.extends("object"); // true
  ```
- **What to lift:**
  - **Performance signal** is real (20x on object validation) — relevant if kit's hot path includes per-Atom Zod parsing in production. **Possible Phase 2 ADR addition** — switch to ArkType in v1+ if perf becomes a concern.
  - **String-syntax** is terse for simple types but reduces IDE ergonomics for complex schemas.
- **What to avoid:**
  - Don't switch from Zod in v0 — ecosystem maturity matters. Drizzle has `drizzle-zod`; Hono has `@hono/zod-validator`; tRPC integrates with Zod. ArkType ecosystem is younger.
  - Don't use string-syntax for complex schemas with dependent fields — Zod's fluent builder is clearer.
- **Stated non-goals:** Not an ORM; not a serialization framework. Focused on validation alone.
- **License + community:** MIT (per common knowledge — ArkType is OSS). 6.5k+ stars vs Zod's ~45k. Less mature ecosystem; faster runtime.

### 37. Drizzle ORM — https://orm.drizzle.team
- **Purpose:** "Headless TypeScript ORM with a head." Schema-first, type-safe relational database toolkit for PostgreSQL, MySQL, SQLite, MSSQL, CockroachDB, SingleStore, Gel. v0 default for pipeline-kit per **ADR11**.
- **Core abstractions (verbatim):**
  - **Schema:** `pgTable()`, `mysqlTable()`, `sqliteTable()`. Column helpers: `integer()`, `varchar()`, `text()`, `jsonb()`, `serial()`, `uuid()`, `timestamp()`. `relations()` for foreign keys + joins.
  - **Query builder:** `db.select().from().where()`, filters `eq() / and() / or() / like() / inArray()`.
  - **Mutations:** `db.insert(table).values()`, `db.update(table).set().where()`, `db.delete()`.
  - **Transactions:** `db.transaction(async (tx) => {...})`.
  - **Migrations (drizzle-kit):** `generate` (TS schema → SQL files), `migrate` (apply files), `push` (dev-only schema sync), `pull` (reverse-introspect).
- **API surface (canonical):**
  ```typescript
  import { pgTable, integer, varchar, serial, relations } from "drizzle-orm/pg-core";

  export const users = pgTable("users", {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 255 }).unique(),
  });

  // Query
  const result = await db.select().from(users).where(eq(users.email, "x@y.com"));

  // Insert / update / transaction
  await db.transaction(async (tx) => {
    await tx.insert(users).values({ email: "z@y.com" });
    await tx.update(users).set({ email: "new@y.com" }).where(eq(users.id, 1));
  });
  ```
- **Migration story:** Schema-first → `drizzle-kit generate` → SQL files in `migrations/` → commit → `drizzle-kit migrate` in CI/prod. `drizzle-kit push` for dev-only direct sync. **Manual rollback** via folder-based versioning. v1.0-beta added migration table versioning for reliable env tracking.
- **Bun + multi-runtime:** Native `bun:sql` (PostgreSQL mode via Bun v1.2.0+), `bun-sqlite`, plus standard Node drivers (`node-postgres`, `postgres-js`), Neon HTTP, Vercel Postgres, Supabase, AWS Data API.
- **What to lift:**
  - **Whole library for v0 `postgres-store` + `sqlite-store` adapters** → **ADR11** locked. Direct adoption.
  - **`drizzle-zod` (now bundled via `drizzle-orm/zod`)** — auto-generate Zod schemas from Drizzle table definitions. Removes duplicate type definitions. **ADR6 + ADR11 alignment.**
  - **Schema-first migration workflow** → kit ships migrations alongside adapter code (e.g., `@pk-store/postgres` includes `migrations/0001_init.sql`).
  - **Native Bun support** → CLAUDE.md "Bun-tested in CI" requirement met natively.
  - **`@effect/sql-drizzle` integration** → if **ADR1** adopts Effect, the Drizzle bridge is free.
- **What to avoid:**
  - Don't use `drizzle-kit push` in production — schema drift risk. Use `generate` + `migrate` for prod.
  - Don't lift Drizzle's full multi-dialect surface in v0 — kit ships Postgres + SQLite first; MySQL/MSSQL/CockroachDB on demand.
- **Stated non-goals:** Not an "active record" ORM; not a query magic ORM (TypeORM/Prisma style). Drizzle is "SQL-shaped TypeScript."
- **License + community:** MIT. ~33k+ stars. v1.0-beta.15+ (Feb 2025). 164+ bugs fixed in beta cycle; 3000+ drizzle-kit test cases. Astro DB, SST adoption. Very active.

---

### Category VI — Synthesis

**Top 3 patterns to lift across type/schema category:**

1. **Zod at every Source/Serve boundary + schema-as-source-of-truth.** Zod schemas drive: (a) input validation at HTTP edge (Hono); (b) Atom shape per Source<O>; (c) LLM output schema for `extract-process` (zod-to-json-schema); (d) drizzle-zod-derived insert/select schemas for Store. Maps to **ADR6**. **Confidence HIGH.**

2. **Schema-first ORM workflow with Drizzle + auto-derived migrations + drizzle-zod bridging.** TypeScript schema is single source of truth; SQL migrations generated; Zod schemas auto-derived. Maps to **ADR11 + ADR6**. **Confidence HIGH.**

3. **Boundary coercion (don't reject) at Source intake + Validation-driven retry on Process output.** Cross-references Pursuit's `feedback_pydantic_boundary_coercion.md` lesson + Pydantic AI's reflection/retry pattern. Kit's Source<O> coerces malformed-but-recoverable input via `z.coerce` / `z.transform`; Process<I,O>'s LLM-backed adapters retry on schema-validation failure. Maps to **ADR6 + ADR13**. **Confidence HIGH.**

**Top 2 pitfalls to avoid:**

1. **Adopting ArkType in v0 despite perf signal.** Zod's ecosystem (drizzle-zod, hono-zod, tRPC, zod-to-json-schema, OpenAI structured outputs SDK) is materially deeper. ArkType perf advantage is real but irrelevant for v0; revisit if production hot path bottlenecks on validation.

2. **Adopting Effect Schema before adopting Effect.** Schema is coupled to Effect runtime; using it without Effect adds wrapper overhead. **ADR1** says vanilla TS v0; Effect Schema follows ADR1.

**Implications for ADRs:**

- **ADR6 (Zod at boundaries):** Strongly confirmed. Zod 4 + `strict: true` TS + ecosystem cohesion. **Confidence HIGH.**
- **ADR11 (Drizzle ORM):** Strongly confirmed. Multi-runtime Bun/Node; native Postgres + SQLite; drizzle-zod bundled; v1.0-beta production-ready. **Confidence HIGH.**
- **ADR1 (Effect.ts adoption):** Reinforced — Effect Schema is appealing IF Effect adopted, but locks ADR1. v0 vanilla + Zod is correct. **Confidence HIGH for v0 vanilla.**
- **ADR13 (retry policy):** Pydantic AI's validation-driven retry on structured output confirms kit's `extract-process` should retry on Zod parse failure with schema in prompt. **Confidence HIGH.**

**Open questions for brain adjudication:**

1. **ArkType escape hatch for hot-path validation in v1+?** Current ADR6 locks Zod; perf signal suggests revisit if production bottlenecks. *Brain recommend: defer; profile first.*
2. **Auto-derive JSON schemas for `extract-process` LLM adapter via zod-to-json-schema?** Kit ships this as default. *Brain recommend: yes, ship as utility.*
3. **drizzle-zod or Zod-from-scratch for Store schemas?** drizzle-zod removes duplication. *Brain recommend: drizzle-zod for Store schemas; standalone Zod for Source/Serve schemas.*
4. **Strict-mode TS enforcement for kit users?** Zod 4 requires it; CLAUDE.md already mandates it. *Confirmed; document explicitly.*
5. **Schema versioning for migrations?** Drizzle v1.0-beta has migration table versioning. *Brain recommend: adopt as default; document upgrade path.*

---

