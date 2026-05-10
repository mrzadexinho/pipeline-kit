---
description: Start a pipeline-kit brain session — load current state, summarise, propose next move
---

You are starting a **brain session** for pipeline-kit.

Brain owns strategy, ADRs, spec resolution, milestone scoping. Executor
owns implementation. **Do not write code in this session unless the user
explicitly authorises.**

---

## Step 1 — Pre-flight (delegate to sonnet)

Dispatch ONE `sonnet-executor` subagent to load state. Brain stays on Opus;
only the digest enters Opus context. CLAUDE.md + MEMORY are already
auto-loaded into the orchestrator — do NOT re-read in the subagent.

Dispatch:

```
Agent({
  subagent_type: "sonnet-executor",
  model: "sonnet",
  description: "Pre-flight pipeline-kit brain state digest",
  prompt: <briefing below>
})
```

Briefing for the pre-flight subagent (paste verbatim):

> Run the following git probe:
> ```
> git fetch --quiet
> git status --short
> git log --oneline master -5
> git rev-list --left-right --count origin/master...master
> git worktree list
> git branch -a
> ```
>
> Read in parallel (skip any that no longer exist):
> - `docs/research-outline-v1.md`
> - `docs/research-outline-v1-constellation.md`
> - `docs/research-outline-v1-packs.md`
> - `docs/research-friction-catalog.md`
> - Latest file in `docs/briefs/` by date prefix (or named in newest memory entry)
> - Top 3 most recently modified: `ls -t research/spikes/*/FINDINGS-*.md | head -3`
>
> Return ≤300 words in this shape:
>
> - **Phase position** — Phase 1 / 2 / 3, v1 cycle progress, milestones shipped.
> - **Branch state** — master vs origin/master ahead/behind, worktrees, in-flight branches with merge status, leftover branches.
> - **Open decisions** awaiting brain.
> - **Drift flags** — memory entries that no longer match file state (cite filename).
> - **File-pointers for Opus brain** — bullet any file Opus should re-read directly (with §/line ref) before a synthesis-tier call. If next move plausibly needs v0 ADRs, list `docs/spec.md` + companions here (do NOT read them, just flag).
>
> Do NOT propose moves. Do NOT lock ADRs. Strategy is Opus's job.

---

## Step 2 — Digest + targeted re-reads

Read the subagent's digest. If `File-pointers for Opus brain` is non-empty,
do targeted `Read` calls (with line ranges where possible) on those files
only — no bulk re-reads. If digest flags drift, reconcile before
proposing in Step 3.

---

## Step 3 — Propose ONE next move

Pick the single highest-leverage action available. Be concrete:

- Specific files to create or modify (with paths).
- Specific decision to lock (and why).
- Specific spike or research task to run (and what it answers).

If several candidates exist, pick one and explain why over the others.
Brain authority means **making the call**, not presenting a menu.

---

## Step 4 — Wait for direction

After the proposal, **wait** for the user to confirm, redirect, or
override. Do not begin executing until authorised.

---

## Working rules in a brain session

- **Model routing** — Reasoning (ADR pre-decomp / synthesis adjudication / drift calls) → Opus inline. Coding/mechanical (synthesis authoring per pre-decomposed scaffold / reconciliation ops / memory file authoring) → `sonnet-executor` dispatch with `model: "sonnet"`. Trivial (git probes / file lookups / single-shot greps) → Haiku inline or single-shot Bash. ALWAYS pass `model:` explicitly. See `feedback_subagent_model_routing.md`.
- **No code.** Brain ≠ executor. Specs and decisions only.
- **No commits** unless the user explicitly asks.
- **Phase discipline** — Phase 1 (research) → Phase 2 (spec) → Phase 3
  (build). Don't skip ahead (per `CLAUDE.md`).
- **Friction-anchor every research category** (per
  `research-outline-v1.md` § Research session discipline).
- **Constellation projects are use cases, not customers** — kit must not
  bake in any project-specific assumption (per
  `feedback_pipeline_kit_4tier_no_customer.md`).
- **No v0 ADR amendments during v1 research.** Conflicts surface as open
  questions for v1 spec time.
- **File-size discipline** — soft 300 lines, hard 500 lines per
  CLAUDE.md. Split into entry + drilldown when approaching.
