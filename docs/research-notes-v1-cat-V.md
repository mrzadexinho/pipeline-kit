# v1 Research Notes — Cat V: Memory, State & Feedback Protocols

> Phase 1 v1 synthesis. Author: Brain — 2026-05-10.
> Inputs: 3 spike FINDINGS files (`research/spikes/memory-feedback/`).
> Friction anchor: F-MEMORY (catalog top-15 #4, 4 incompatible memory shapes) + F-X-mem (#13).
> Status: synthesis complete; 6 ADR candidates locked direction; 5 carry-forwards.

---

## Sources reviewed

### Spike evidence (this kit, 3 throwaway spikes — empirical truth)
- Spike #1 (`8ed8b78`, 2026-05-09) — `deps-shape-lift`. Single-cell PASS: Cat VIII `deps:{secrets}` lifts to memory `deps:{memory}` unchanged at call site. orchestr8-mcp npm direct via `SQLiteBackend(:memory:)`. New friction: §5.2 lifecycle (`close()` / `initialize()`) is not present on secrets resolver but IS present on memory backends. 8 carry-forwards.
- Spike #2 (`80ba230`, 2026-05-09) — `lifecycle-and-disposable`. 3-cell α/β/γ probe over orchestr8 `SQLiteBackend(:memory:)`. **Day-2 lean β** (separate `Disposable` opt-in interface) on sibling-cost + greppability axes. Cat VI bump-out confirmed for γ only (`DisposableRegistry` is pipeline-lifetime; β ships at Cat V scope with ~10 LOC Composer helper). 5 new carry-forwards (#9-#13).
- Spike #3 (`81dcd61`, 2026-05-09) — `cross-run-persistence-and-verb-set`. 2-cell / 4-process-invocations probe over orchestr8 sql.js disk-backed `SQLiteBackend({databasePath})`. Cross-run R+W round-trip PASS. **Headline α.2:** orchestr8 silently does first-write-wins; kit contract MUST specify last-write-wins + reference adapter MUST wrap. β.5 pattern-lift CONFIRMED (`Listable` opt-in follows identical shape to `Disposable`). Zero category bump-outs. 5 new carry-forwards (#14-#18).

### External sources (modern industry landscape 2024-26)
- **Mastra** — TS-native agent memory; structured working memory + semantic long-term. Confirms 2-verb read/write as baseline; search/forget as layered capability.
- **mem0** — multi-level memory (user / session / agent); self-hostable; distinguishes structured vs semantic tiers. Supports the marker-interface extension model: structured = `read/write`; semantic = opt-in `search`.
- **Zep** — structured memory + temporal context; graph-based long-term memory for agents. Memory scope concept (session / user / entity) maps onto kit's construction-time namespace argument.
- **LangMem / LangChain memory** — abstraction layers over various backends; friction source: every project rolls a bespoke abstraction. Confirms F-MEMORY ubiquity.
- **pgvector patterns** — semantic search composition; confirms that vector memory is a DISTINCT capability tier from structured KV (cf #5 — `deps: { memory, embeddings }`, not widened core verbs).
- **Pursuit feedback corpus pattern** — Python-side reference; demonstrates `wasEdited` backpropagation through a memory store (Q3 shape; deferred to v1.x).
- **orchestr8 MCP** — Phase 0 reference impl (confirmed locked); `SQLiteBackend` from `orchestr8-mcp/dist/memory/index.js`; `IMemoryBackend { initialize, store, retrieve, query, update, delete, close }`. Maps to 2-verb kit contract via 18-LOC wrap. sql.js not real SQLite — autoSave = full DB re-serialise per write.

---

## Spike #1 — deps-shape-lift

### What was built
Single Source→Process→Serve pipeline, one run, `SQLiteBackend(:memory:)`. Process splits into 2 internal atoms: atom-A writes key; atom-B reads it back. `PipelineContext` carries only `run_id + signal`. `deps.memory` is the sole adapter dep, mirroring Cat VIII's `deps.secrets`.

### What it revealed
1. **Call-site shape lifts verbatim.** `deps.memory.write/read` mirrors `deps.secrets.resolve` pattern. Early-return-on-error, `Result<T,E>` envelope, and construction-site contract transfer unchanged. One verb count change only: Cat VIII has 1 verb; Cat V has 2 (`read`, `write`).
2. **`write` returning `Result<void, _>` creates no deps-shape friction.** Both verbs ride the same `deps.memory` reference, same error type, same Result envelope.
3. **Lifecycle is the NEW friction vs Cat VIII.** orchestr8's `IMemoryBackend` requires `initialize()` + `close()`; pure secrets resolvers do not. The spike factory returned a `{ memory, close }` tuple — no clean kit pattern yet. Load-bearing carry-forward #1.
4. **Phase 0 claim validated empirically.** `SQLiteBackend.store/retrieve` maps 1:1 onto kit R+W verbs in 18 LOC. The Phase 0 finding "orchestr8 already kit-shaped" holds at the deps-shape axis.
5. **Subpath import packaging concern.** `orchestr8-mcp` lacks an `exports` map; deep subpath `orchestr8-mcp/dist/memory/index.js` required (carry-forward #4).

```ts
// Cat V (R+W memory) — identical pattern to Cat VIII (read-only secrets)
const wResult = await deps.memory.write(composedKey, value);
if (wResult.error !== null) { yield err(wResult.error); return; }
const rResult = await deps.memory.read(composedKey);
if (rResult.error !== null) { yield err(rResult.error); return; }
```

---

## Spike #2 — lifecycle-and-disposable

### What was built
3-cell structural comparison. Same orchestr8 `:memory:` backend. Cells differ ONLY in how lifecycle is exposed: **α** `{ read, write, close }` (3-verb contract); **β** `{ read, write }` + separate `Disposable` opt-in interface; **γ** `{ read, write }` (2-verb) + `DisposableRegistry` owned by Composer. Two scenarios each: happy-path + `AbortController`-triggered abort before write.

### What it revealed
1. **Axes 1, 2, 5 tied across all cells.** All three close cleanly; all use pipeline-level finally; all compose with the existing async-factory shape.
2. **α loses on sibling-adapter cost.** lifecycle-free SecretsResolver required a stub `async close() {}` wrapper. 12 LOC delta; noisy `close:` grep pattern (every adapter has it; zero signal).
3. **β wins on axes 3+4.** `Disposable` opt-in: lifecycle-free siblings consume verbatim without wrapper; high-signal grep (`implements Disposable` = real lifecycle, no false positives). Composer-side `isDisposable` + `disposeAll` = ~10 LOC fixed kit cost.
4. **γ is the strongest Composer guarantee but forces Cat VI.** `DisposableRegistry` is inherently pipeline-lifetime — analogous to how Cat VIII's `version-aware-resolver` became a cross-cutting construct. γ ships only after a Cat VI ADR for "Composer owns pipeline-resource lifetime" lands. β defers this commitment; β's `Disposable` interface is forwards-compatible with γ's registry via a trivial wrapper.
5. **Cat VI bump-out is β+γ together, not α.** α's verb-cost stays at adapter-tier with no kit-shape decision forced.

```ts
// β: Composer-side disposal — pays once, zero cost to lifecycle-free deps
function isDisposable(dep: unknown): dep is Disposable {
  return typeof dep === 'object' && dep !== null && 'close' in dep;
}
async function disposeAll(deps: Record<string, unknown>) {
  for (const dep of Object.values(deps)) {
    if (isDisposable(dep)) await dep.close();
  }
}
```

---

## Spike #3 — cross-run-persistence-and-verb-set

### What was built
2-cell, 4-process-invocations probe. Disk-backed `SQLiteBackend({databasePath})` with sql.js autoSave. **Cell α** (minimum-verbs): run-1 writes 3 atoms; run-2 reads same 3 keys + probes key-reuse (re-write existing key). **Cell β** (verb-growth): run-1 writes 5 atoms into a namespace; run-2 uses `list(namespace)` via `Listable` opt-in to enumerate and read all 5.

### What it revealed
1. **Cross-run R+W round-trip PASS.** All 3 α round-trips held across separate `bun run` invocations. No new core verb required; cf #3 RESOLVED.
2. **α.2 HEADLINE: orchestr8 silently first-write-wins.** `write(existingKey, newValue)` returns `ok(undefined)` (success) but re-read returns the ORIGINAL value. Underlying cause: `store()` does `INSERT INTO memory ... PRIMARY KEY` on a fresh `mem_<ts>_<rand6>` id, not the `(key, namespace)` composite; `retrieve()` uses `LIMIT 1` without `ORDER BY` — returns oldest row. **Kit contract MUST specify last-write-wins (LWW). Reference adapter MUST wrap** with delete-then-insert or update-when-exists flow.
3. **β.5 pattern-lift CONFIRMED.** `Listable` opt-in follows identical shape to `Disposable`: intersection type, runtime type-guard, zero cost to lifecycle-free siblings.
4. **`list` is genuinely required.** `cursor-file-workaround` (sentinel key containing atom-id index) is viable but forces unspecified naming convention + index synchronisation on every write site. Process code naturally reaches for `list(namespace) -> string[]`.
5. **Zero category bump-outs.** `isListable` narrows at call site, NOT via a cross-adapter kit primitive. Cat I (LWW-vs-idempotency) and Cat VI (verb-tier-discovery) both close inside Cat V scope.

```
[run-2 alpha.2 result] re-read-after-rewrite key='...' observed='value-from-run-1-atom-1'
# write returned ok, but orchestr8 silently kept first value — first-write-wins uncontracted
```

---

## Open questions answered (5 outline questions)

### Q5 — Memory as Context concern (`ctx.memory`) or stage type (`Memory<T>`)?
**Adapter dependency (variant B).** Spike #1: `deps.memory` lifts verbatim from Cat VIII `deps.secrets` at call site. `PipelineContext` stays minimal (`run_id / signal`). Memory is NOT on `PipelineContext`. No new stage type needed at Cat V scope. (See ADR-v1-V-1 + ADR-v1-V-5.)

### Q1 — Concrete `MemoryAdapter` interface beyond stub?
**Two-verb core (read, write) + opt-in markers for lifecycle and verb-growth.** Spike #1 establishes 2-verb minimum; spike #2 resolves lifecycle via `Disposable` opt-in; spike #3 resolves enumeration via `Listable` opt-in. Future extensions (search, forget, update) follow same marker pattern. (See ADR-v1-V-1 + ADR-v1-V-2 + ADR-v1-V-3.)

### Q2 — Memory scope — pipeline / stage / atom / user?
**Namespace as construction-time adapter argument.** Spike #3 α.3: composed-key `<namespace>::<atom-id>` convention at call site + `opts.namespace` threaded through factory. No `scope()` method on `MemoryAdapter`; no namespace member on `PipelineContext`. Mirrors Cat VIII ADR-v1-VIII-4 flat-naming default. (See ADR-v1-V-5.)

### Q1 (verb-set) — Idempotency on `write`?
**Last-write-wins specified at contract level; no parameter.** Spike #3 α.2: LWW is the universal KV semantic. Verb count stays 2; spec gets sharper. Reference adapter must enforce. (See ADR-v1-V-4.)

### Q3 — Feedback loop (`EditableField<T>` → memory → next run)?
**Deferred to v1.x.** Spike #1 flagged; no spike exercised `wasEdited` backpropagation. Carry-forward #6 owns this; Q3 is out of scope for the 3-spike synthesis window.

---

## Open questions unresolved (carry-forwards)

1. **(spike-1 cf #1 — PROMOTED)** `Disposable` opt-in for `MemoryAdapter` lifecycle — confirmed by spike-2 β-lean; confirmed at multi-run scale by spike-3 α.5. Locked pending Cat V synthesis (this document).
2. **(spike-2 cf #2 — RESOLVED/ESCALATED)** Idempotency convention on `write` — RESOLVED on contract (LWW is the spec; no extra parameter). ESCALATED on reference-adapter: orchestr8 adapter must wrap `store()` to enforce LWW. ADR-v1-V-4 absorbs.
3. **(spike-3 cf #14 — sql.js durability model)** orchestr8's `SQLiteBackend` is sql.js (not real SQLite). autoSave = full DB re-serialise per write (`db.export() + fs.writeFileSync`). Degradation: linear at >10k entries. Reference-adapter spec note: best-suited for small KV namespaces; consider node:sqlite-based adapter for >10k workloads. Anchor for M2 perf eval.
4. **(spike-1 cf #4 — subpath-import packaging)** orchestr8-mcp lacks `exports` map; reference adapter must pin `orchestr8-mcp/dist/memory/index.js` or upstream a PR. M2 packaging note; doesn't block ADR direction.
5. **(spike-3 cf #17 — WAL/checkpoint axis moot)** `close()` timing axis is moot for sql.js (no WAL). Re-probe if kit gains a node:sqlite or better-sqlite3 reference adapter. Carry to M2.

---

## Modern-direction framing (2024-26 industry context)

Direction of travel in agent memory is **away from single-tier KV → toward multi-level memory** (working / episodic / semantic). Mastra TS-native memory, mem0 multi-level memory (user / session / agent), Zep structured + temporal context are the 2024-26 leaders. All share a structural insight: **structured KV (read/write) and semantic search are distinct tiers**, not co-habitating verbs on one interface.

**Good news for kit's 2-verb core + marker-interface architecture:** this is already the right abstraction. `MemoryAdapter { read, write }` + `Listable { list }` + (future) `Searchable { search }` mirrors the multi-tier model without collapsing them. A semantic backend implements `MemoryAdapter & Searchable`; a structured-only backend implements `MemoryAdapter & Listable`; a write-only event-log implements `MemoryAdapter` alone.

**orchestr8 as reference impl:** its sql.js `SQLiteBackend` is structured-KV tier. Its `query({ type: 'semantic', embedding })` pathway leads toward a `Searchable` marker. Spikes did NOT exercise the semantic path — correct for Cat V scope; that is Cat V Q4 (pgvector composition), which is v1.x deferred.

**Non-goals (explicit rejections — do NOT ship):**
- Kit is NOT a memory store — lean on orchestr8 / mem0 / Zep / pgvector at user-glue or pack tier.
- Kit ships NO embedding primitives — lean on the embeddings adapter at `deps: { embeddings }`.
- Memory is NOT secrets; do NOT couple `MemoryAdapter` contract to `SecretsResolver` (Cat VIII ADR-v1-VIII-1 orthogonality preserved).
- Semantic/vector memory belongs to Cat V Q4 deferred scope — no `search` verb in kit core at v1.0.

---

## ADR candidates

### ADR-v1-V-1 — Two-verb core (read + write) for `MemoryAdapter` contract

**Status:** v1 candidate (synthesis 2026-05-10). Awaiting brain v1 spec lock.

**Context:** v0 `MemoryAdapter` stub had no reference impl. Cat V Q1 asks for the concrete interface. Spike #1 established that Cat VIII's 1-verb (`resolve`) deps-shape lifts to a 2-verb (`read`, `write`) shape without structural friction. Spike #2 resolved lifecycle via opt-in, not core verb. Spike #3 resolved enumeration via opt-in. No spike surfaced a case where a third core verb was required.

**Decision:** `MemoryAdapter` core contract exposes exactly two verbs:
```ts
interface MemoryAdapter {
  read(key: string): Promise<Result<string | null, MemoryError>>;
  write(key: string, value: string): Promise<Result<void, MemoryError>>;
}
```
No `batch`, no `list`, no `delete`, no `search`, no CAS at core. LWW semantic is CONTRACT-level (see ADR-v1-V-4). Opt-in markers extend without breaking core (see ADR-v1-V-2 + V-3).

**Alternatives considered:**
- *3-verb core (read/write/delete).* Rejected — delete is use-case-specific; only backends with TTL or eviction policies need it. Fits `Forgettable` marker better.
- *4-verb core (read/write/list/delete).* Rejected — `list` belongs to enumerable backends only; non-enumerable adapters (write-only stream hypothetical) would stub `list()` — identical to spike-2 cell-α's verb-cost anti-pattern.
- *Transactional CAS (compare-and-swap).* Deferred — LWW at contract level is the baseline; CAS is adapter-implementation detail when the backend supports it.
- *`string | null` vs `Result<string, MemoryNotFound>` for absent key.* Chose `string | null` — matches `Map.get` ergonomics + orchestr8's `retrieve(): MemoryEntry | undefined` shape directly. Simpler at call site; avoids splitting error arm for a structural sentinel.

**Reference:** spike-#1 §2-§4; spike-#2 §5-§6 verdict; spike-#3 α.1; modern-direction framing (2-verb as structured-tier baseline across Mastra / mem0 / Zep).

**Consequences:**
- Trivially implementable by any get/set backend (Redis, SQLite, Map, pgvector).
- Adapter authors who implement only `read/write` satisfy the full core contract.
- Opt-in markers (`Listable`, `Disposable`, future `Searchable`, `Forgettable`) extend without amending the core interface.
- `MemoryError` envelope: `{ type, code, message, param?, doc_url? }` — matches kit actionable-error convention. Minimum codes: `memory_unavailable`, `key_invalid`, `unknown`.
- `string` value type at v1.0 — JSON-serialised by caller convention. `MemoryAdapter<T>` generics deferred to v1.x if adopter pressure surfaces.

### ADR-v1-V-2 — `Disposable` opt-in marker for adapter lifecycle

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike #2 surfaced that orchestr8's `SQLiteBackend` requires `initialize()` + `close()` — resource lifecycle absent from pure secrets resolvers. Three cells probed how lifecycle fits the kit type system. Cell β (separate `Disposable` opt-in) won on sibling-adapter cost + greppability axes. Cell γ (`DisposableRegistry`) was structurally strongest but requires a Cat VI ADR for pipeline-resource lifetime to land first.

**Decision:** Adapters needing lifecycle cleanup implement `Disposable`:
```ts
interface Disposable {
  close(): Promise<void>;
}
```
Composer detects via type guard at dep-injection time:
```ts
function isDisposable(dep: unknown): dep is Disposable {
  return typeof dep === 'object' && dep !== null && 'close' in dep;
}
```
Composer calls `disposeAll(deps)` inside the pipeline-level `finally` block (~10 LOC kit cost, paid once). Lifecycle-free adapters (in-memory Map, static fixtures) are NOT modified.

**Alternatives considered:**
- *`close()` in core (cell α — 3-verb contract).* Rejected — forces stub `close()` on every lifecycle-free sibling; discoverability inversion (presence carries no signal); 75 stub LOC at N=15 reference adapters.
- *`DisposableRegistry` as Composer primitive (cell γ).* Deferred — structurally strongest; requires Cat VI "Composer owns pipeline-resource lifetime" ADR first. β defers that commitment; β's `Disposable` interface is forwards-compatible with γ via trivial wrapper: `registry.register(name, async () => adapter.close())`.
- *TC39 `Symbol.asyncDispose` alignment.* Noted — explicit-resource-management proposal targets `[Symbol.asyncDispose]`. Kit uses `close()` at v1.0 for self-containedness; align at v1.x if the proposal stabilises in Node 22+.

**Reference:** spike-#2 §3 + §6 verdict; spike-#3 α.5 (Disposable survives disk-backed boundary unchanged); spike-#2 §5 Cat VI bump-out analysis.

**Consequences:**
- Composer ~10-LOC `isDisposable` + `disposeAll` — fixed kit cost regardless of adapter count.
- Stateless adapters (in-memory Map) stay minimal — no lifecycle code written.
- Reviewer grep for `implements Disposable` (or `& Disposable` in return type) produces a clean inventory of real-lifecycle backends.
- Cell γ (`DisposableRegistry`) remains the long-game option if Cat VI synthesis-tier lands a pipeline-lifetime primitive — β is forwards-compatible.
- `initialize()` not on `Disposable` — async factory `await create<X>Adapter({ args, deps })` is sufficient for construction-time setup (spike-#1 §4.2 confirmed; no secondary init-phase friction observed).

### ADR-v1-V-3 — `Listable` opt-in marker for key enumeration

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike #3 cell β probed whether `list(namespace)` belongs on `MemoryAdapter` core or on an opt-in marker. Run-2 Source emitted ONLY the namespace; the 2-verb contract genuinely cannot supply enumeration. Two strategies wired: `Listable` (exercised) vs cursor-file-workaround (structural evaluation only). Process code naturally reached for `list(namespace) -> string[]`.

**Decision:** Adapters that can enumerate keys implement `Listable`:
```ts
interface Listable {
  list(namespace: string): Promise<Result<string[], MemoryError>>;
}
```
Composer-side narrowing via `isListable(dep)` runtime guard — parallel to `isDisposable`. Same intersection-type adapter shape (`MemoryAdapter & Disposable & Listable`). Zero cost to non-enumerable adapters.

**Alternatives considered:**
- *`list()` in core.* Rejected — identical rationale as `close()` in core (ADR-v1-V-2 § alternatives): write-only or ephemeral adapters would stub `list()`, paying verb-cost for a capability they don't have.
- *cursor-file-workaround (no marker).* Rejected — forces unspecified sentinel-key naming convention + index synchronisation on every write site; ~10 LOC viable but non-standard; every adapter invents its own convention.
- *`list({ namespace, prefix?, limit?, offset? })` richer signature.* Deferred to v1.x — spike took minimum `list(namespace): string[]`; pagination real at >1k keys; return type `{ key, updatedAt }[]` also deferred.

**Reference:** spike-#3 β.1 + β.2 + β.5 pattern-lift; spike-#3 §4 (zero Cat VI bump-out confirmed).

**Consequences:**
- Pattern-lift β.5 CONFIRMED: `Disposable` and `Listable` both follow core-2-verb + opt-in marker shape — Cat V ships a SINGLE ADR-shape discipline rather than per-extension hacks.
- Cross-run enumeration backends (SQLite, FS) implement `Listable`; ephemeral backends (in-memory Map) do not.
- `isListable(dep)` check at call site (~5 LOC) — not a kit-level cross-adapter primitive (no Cat VI bump-out).
- Future markers (`Searchable`, `Forgettable`, `Updatable`) follow same opt-in intersection pattern; no core amendment needed.
- Sibling-cost cf #11 taxonomy CONFIRMED for verb-set additions: adapter-type cost = 0; Composer-side = ~5 LOC fixed; factory-wiring = 0; call-site = 0.

### ADR-v1-V-4 — LWW semantic specification + reference-adapter wrap discipline

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike #3 α.2 HEADLINE: orchestr8 `store()` does `INSERT INTO memory` with a fresh `mem_<ts>_<rand6>` id; `retrieve()` uses `LIMIT 1` without `ORDER BY` → physical-insertion-order → OLDEST row wins. `write(existingKey, newValue)` returns `ok(undefined)` (success) but re-read returns the original value. The 2-verb contract communicates nothing about this; a naive adapter author expects last-write-wins (the universal KV semantic).

**Decision:** Kit specifies last-write-wins (LWW) at the contract level. `MemoryAdapter.write()` MUST: given a key that already exists, the re-read after a successful `write(key, newValue)` MUST return `newValue`. Reference adapters with divergent native semantics (orchestr8 silent first-write-wins) MUST wrap to enforce LWW:
- Option A: `DELETE WHERE (key, namespace)` then `store(key, value)` — atomic delete-then-insert.
- Option B: `query({type:'exact', key, namespace})` → if found, `update(id, {value})`; else `store(key, value)`.

**Alternatives considered:**
- *Leave concurrency semantics unspecified.* Rejected — invisible footgun; spike-3 Q-O-5 confirms a junior author would observe wrong data on re-read after a structurally successful write. Same failure mode as spike-1 Q3 optional-field-drop-silently.
- *Specify first-write-wins (FWW).* Rejected — counterintuitive default; contradicts universal KV semantic (`Map.set`, Redis `SET`, SQLite `INSERT OR REPLACE`).
- *Force a `delete` verb onto the core contract to expose LWW mechanism.* Rejected — verb-cost anti-pattern; LWW is a SEMANTIC specification, not a verb.
- *Add `idempotencyKey?` parameter to `write()`.* Rejected — Spike-3 α.2 confirms LWW at contract level is the correct framing; composite-key constructed at call site provides natural idempotency; no extra parameter needed.

**Reference:** spike-#3 §2 α.2 (headline finding); spike-#3 §6 cf #15 (wrap options A+B); Cat IX ADR-v1-IX-1 framing precedent (wire semantics specified at contract level).

**Consequences:**
- **Resolves carry-forward #15** from spike #3.
- orchestr8 reference adapter MUST ship with LWW-enforcement wrap. ADR sub-section documents the wrap approach (option A or B per adapter author choice; both behaviorally equivalent).
- In-memory Map adapter is trivially LWW (`Map.set` overwrites by key); no wrap needed.
- sql.js adapter (disk-backed) requires same wrap as orchestr8 (same `store()` behaviour).
- Adapter compliance test: write key K with value V1; write same key K with value V2; read K → MUST return V2. Part of `MemoryAdapter` conformance suite.
- Concurrent writes (two processes writing same key simultaneously) are explicitly OUT OF scope at v1.0 — LWW is single-writer semantic; concurrent behaviour is adapter-implementation-defined.

### ADR-v1-V-5 — Namespace as construction-time adapter argument

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** Spike #3 α.3 probed namespace / scope (outline Q2). Two layers wired: composed-key `<namespace>::<atom-id>` at call site + `opts.namespace` threaded through factory. Both worked cleanly. No `scope()` method or namespace argument on `read/write` was needed. Mirrors Cat VIII ADR-v1-VIII-4 flat-naming-plus-scope precedent.

**Decision:** Namespace is part of adapter identity, supplied at construction time via factory `opts.namespace`, NOT per call. Call-site composed-key convention: `${namespace}::${atomId}` (double-colon separator; consistent with `NAME_RE` and existing kit prefixed-ID conventions). `MemoryAdapter.read/write` accept only the composed key — no namespace argument on the methods themselves.

**Alternatives considered:**
- *`namespace` as per-call argument on `read(key, namespace)` / `write(key, value, namespace)`.* Rejected — noisier call site; namespace is stable per adapter instance; per-call argument duplicates context already encoded in the factory opts.
- *`scope(prefix)` per-call wrapper on `MemoryAdapter`.* Rejected as DEFAULT; acceptable as opt-in façade (same pattern as Cat VIII ADR-v1-VIII-4). Multi-namespace apps construct multiple adapters — one per namespace.
- *Namespace on `PipelineContext` (`ctx.namespace`).* Rejected — `PipelineContext` stays minimal (`run_id / signal`); namespace is adapter-construction concern, not pipeline-run concern.
- *No explicit namespace; adapter is inherently single-namespace.* Rejected — spike-3 patterns required `<namespace>::<atomId>` composed keys for cross-run disambiguation; implicit is worse than explicit.

**Reference:** spike-#3 α.3; Cat VIII ADR-v1-VIII-4 (flat-naming default + scope() optional façade); spike-#3 cf #18 (namespace propagation through Composer).

**Consequences:**
- **Resolves carry-forward #18** from spike #3.
- Matches Cat VIII flat-naming default; no new naming primitive.
- Multi-namespace apps construct multiple adapters (`workingMemory`, `episodicMemory`) — clean separation at DI boundary.
- `scope()` façade (analogous to `SecretsResolver.scope()`) is OPTIONAL for adapter authors who prefer `adapter.scope('sub-ns').read(key)` ergonomics; not a v1.0 kit primitive.
- Composer-level namespace propagation (cf #18 open question: from `pipelineId` / `stageId`?) is OUT OF SCOPE for v1.0 — factory opts are explicit; auto-propagation deferred to v1.x Composer-API ADR.

### ADR-v1-V-6 — 3-reference-adapter trio + non-goals

**Status:** v1 candidate. Awaiting brain v1 spec lock.

**Context:** v1 outline § Cat V Q5 asks "does kit ship a concrete adapter, or only a contract?" Phase 0 catalog evidence (F-MEMORY 4/9 projects; 4 incompatible shapes) shows real adopters need a runnable starting point. Modern-direction framing (multi-tier memory 2024-26) confirms the trio must span the spectrum from ephemeral test fixture to persistent cross-run store to workload-identity-compatible MCP reference impl.

**Decision:** Kit ships at v1 / M2:
- **Contract:** `MemoryAdapter` interface + `Disposable` opt-in + `Listable` opt-in + `isDisposable`/`isListable` guards + `disposeAll` Composer helper (per ADRs V-1 → V-5).
- **Reference-adapter trio (M2 packs under `@idriszade/memory`):**
  - **`@idriszade/memory-map`** — in-memory `Map` adapter. Zero deps. Canonical test fixture. Trivially LWW. No `Disposable` (no lifecycle). No `Listable` (no enumeration; Map.keys() would work but in-memory is ephemeral — no cross-run relevance).
  - **`@idriszade/memory-orchestr8`** — orchestr8-mcp sql.js SQLiteBackend wrapper. LWW-enforced (per ADR-v1-V-4 wrap). Implements `MemoryAdapter & Disposable & Listable`. Best for <10k KV entries (cf #14 sql.js durability note). Phase 0 confirmed reference impl.
  - **`@idriszade/memory-sqlite`** — node:sqlite (Node 22+) or better-sqlite3 backed. LWW via `INSERT OR REPLACE`. Implements `MemoryAdapter & Disposable & Listable`. Suited for >10k entries; WAL mode for concurrent-read workloads.

**Non-goals (explicit rejections — do NOT ship):**
- Kit is NOT a memory store — lean on orchestr8 / mem0 / Zep / pgvector at user-glue or pack tier.
- NO Redis adapter at v1.0 — infra dependency; pack-tier later if adoption pressure surfaces.
- NO pgvector adapter in this trio — semantic memory (vector search) is DISTINCT from structured KV; belongs to Cat V Q4 deferred scope or future `@idriszade/memory-pgvector` pack.
- NO Vault-backed memory — memory is NOT secrets; see Cat VIII ADR-v1-VIII-1 (orthogonal concerns).
- Memory is NOT an observability concern — `MemoryAdapter` does NOT carry PII redaction hooks; that lives at the Zod boundary per Cat VIII ADR-v1-VIII-6.

**Reference:** Phase 0 friction catalog (F-MEMORY 4/9 + F-X-mem); spike-#1 §5.4 (orchestr8 empirically validated); spike-#3 cf #14 + cf #17 (sql.js limitations); modern-direction framing (multi-level memory 2024-26).

**Consequences:**
- M2 LOC budget: ~400-600 LOC for the trio vs ~150 LOC for Map-only.
- All three reference adapters expose the same `MemoryAdapter` shape; user composes via `deps: { memory }` uniformly.
- `@idriszade/memory-orchestr8` documents the LWW-wrap approach + subpath-import concern (cf #4).
- Future v1.x: `@idriszade/memory-pgvector` welcomed as ecosystem addition; not v1.0 scope.
- Pack roster (`-packs.md` §2 launch tier `@idriszade/memory`) updated to enumerate the trio.

---

*End of v1 Cat V research notes. 6 ADR candidates locked direction; 5 carry-forwards. Modern-direction framing (multi-level memory 2024-26; Mastra / mem0 / Zep) confirms 2-verb core + opt-in marker architecture is the right abstraction layer. orchestr8 LWW wrap (ADR-v1-V-4) is the headline finding from spike #3 α.2. Cat I spike NOW RUNNABLE (pg-boss durable execution).*

*Author: Brain — 2026-05-10. Inputs: spike #1 `8ed8b78` / spike #2 `80ba230` / spike #3 `81dcd61`. Branch: `master`. Master tip at synthesis: `1f1b9da`.*
