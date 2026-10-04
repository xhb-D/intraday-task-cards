# Exit Research Step5A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user authorized implementation in this session and one final Step5A commit.

**Goal:** Connect frozen Step2–4B engines to a local-only research workbench without changing canonical trading facts.

**Architecture:** An isolated UI store, controller, pure view-model and renderer consume copies of current V5 records. Frozen modules retain their ES module scopes in the classic bundle; app.js only mounts and refreshes the research route.

**Tech Stack:** Existing plain JavaScript, Node test runner, no new dependencies.

**Spec:** docs/EXIT_RESEARCH_STEP5A_SPEC.md

## Global Constraints

- Base main 4deac7d3e70bb32f4f50a0f8438ca090554877ee; branch codex/exit-research-v0-step5a-ui.
- No merge, push main, deploy, post-exit, optimization, external data acquisition or automatic transitions.
- Frozen engine files and current production model/storage/Risk/Chime/holding layout remain unchanged.
- No implicit Flat, Hard End or execution tick confirmation.
- CSV/Bundle only in memory; research Store only manual decisions/preferences/settings at exit-research:v1.
- Synthetic-only screenshots and fixtures; one Step5A commit after the six authorized cherry-picks.

## Review Focus

- Malformed or malicious inputs: reject atomically and HTML-escape every imported value.
- Stale manual decisions after Fills changes: retain frozen fingerprint checks and blocked status.
- Missing timezone, Flat or Hard End: show explicit gate, never a plausible official result.
- Conflicting/partial/proxy market data: retain quality bounds and blocked/review distinctions.
- Research storage errors or cross-tab changes: never write canonical storage or interrupt home.

### Task 1: Integrate frozen modules

- [x] Create isolated native worktree and named branch.
- [x] Cherry-pick six commits in prescribed order; no production conflicts.
- [x] Run npm test: 594/594 PASS; production source/bundle unchanged.

### Task 2: UI data boundary

Files: src/exit-research/ui/{store,controller,view-model,export}.js; test/exit-research-ui.test.js; test/fixtures/exit-research-ui.js.
Interfaces: createWorkbenchController({getIntraday,storage,onChange}); buildWorkbenchModel({intraday,files,flatConfirmed,store}); Research Store V1 with frozen manual store plus preferences/settings.
- [x] Add tests for read-only canonical inputs, atomic file import, Flat/reset gate, ambiguity/manual decisions, store round-trip/stale writes.
- [x] Observe failures, implement adapters, verify tests.
- [x] Add Actual risk/bounds/milestones and explicit Hard End replay gates; six frozen policies selected by original setup; BOF manual/fixed comparisons; request JSON using both planners.

### Task 3: Route and render

Files: src/exit-research/ui/render.js; src/router.js; src/app.js; index.html; exit-research.css; scripts/research-bundle.mjs; scripts/build.mjs.
Interfaces: initExitResearchWorkbench(host,{getIntraday,storage}); refresh only when route active; scope all module imports/exports without changing frozen files.
- [x] Add render tests for all quality gates, private IDs hidden, escaped content, collapsed Chinese trace, responsive containers, routes and isolated initialization failures.
- [x] Implement four sections, simple filters, file selectors, store export/import preview, per-trade ISO Hard End and optional explicit execution tick.
- [x] Verify frozen and new suites; build, node --check, diff --check.

### Task 4: Browser QA and completion

Files: scripts/qa-exit-workbench.mjs; docs/EXIT_RESEARCH_STEP5A_REPORT.md; external synthetic QA artifacts.
- [x] Generate synthetic files; verify all routes/back/forward, no-data/import/match/READY/BLOCKED/replay/trace at local isolated origin.
- [x] Capture desktop light/dark and 390×844; inspect geometry and screenshots.
- [x] Verify canonical JSON byte-equivalent across research operations, independent store, all frozen files byte-equivalent and main unchanged.
- [x] Fresh whole-branch review; fix material issues within scope.
- [x] Final tests/build/syntax/diff; one Step5A commit; no push/merge/deploy; report and stop.

## Execution ledger

Ruling: Existing implementation authorization controls execution; no additional design approval gate. This is a UI adapter over frozen research APIs, not a new research engine.
Ruling: Replay Hard End is configured per Opportunity with explicit timezone. Optional execution tick is a research setting; absent tick remains the frozen REVIEW_REQUIRED behavior.
Ruling: Use closure-scoped research bundling to preserve frozen module-local declarations and existing production symbol guard; do not refactor production modules.

Task 2: complete — 46 UI route/data-boundary/render/controller tests PASS. Initial adapters observed RED before implementation; subsequent regressions reproduced RED→GREEN.
Task 3: complete — scoped bundle loads in the full app; all four routes and browser history verified; 641/641 full suite PASS.
Task 4: complete — synthetic-only IAB interactive QA and Chrome same-renderer layout QA; 1280px and 390×844 overflow assertions PASS; canonical before/after backup byte-identical; 27 frozen engine files unchanged.
Ruling: User explicitly prohibited subagents during final review; terminate delegation and complete subsequent review/QA/fixes in this thread — user authority overrides the skill's fresh-reviewer dispatch requirement. Cost: final review has the author's existing context; human acceptance remains pending.
Ruling: IAB viewport override did not take effect, Chrome file chooser API lacked local-file permission — retain IAB full-app interaction tests and use same-renderer/CSS synthetic static fixtures in Chrome for exact viewport geometry. Cost: exact 390×844 testing covers rendered layout/default details expansion, not the full file-import interaction at that exact size.
Final review: self-review after user prohibition; no further subagents used. CSV boundary preflight, supported date range, stale async reads, filtering selection, BOF pairing, incomplete bounds and cross-tab recovery covered by reproducing tests and a green full suite.
Final verification: npm test 641/641; npm run build PASS; node --check dist/app.bundle.js PASS; git diff --check PASS. No new dependencies; no main update, push or deployment.
