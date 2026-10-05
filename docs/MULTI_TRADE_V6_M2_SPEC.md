# Multi-Trade V6 M2 — Capture UI and Production Persistence Candidate

## Authorization and frozen source

- Base: `b6cc7e8eba910b224f4fb3c98535e308e44fcc16` (accepted M1).
- Branch: `codex/multi-trade-v6-m2-capture-ui`.
- Scope: wire the frozen M1 model to capture, storage, reload, backups and history. Local candidate only.
- No push, merge or deployment. UI acceptance and the separately agreed Real V5 Backup Dry-Run Gate remain before release. Step5B and Real Market Bundle POC remain paused.

## One canonical domain

Production is Intraday V6 inside Unified V2. Cards retain only current market background; `records[]` owns each lifecycle exactly once. Active trades and pending opportunities are derived by the frozen M1 queries. No persisted aggregate state, active-trade cache, current stop or current management is added.

`src/intraday-v6/index.js` exposes the frozen modules as one scoped production facade. `src/model.js` remains the legacy validator/migration and pure event/reducer dependency. Its V5 lifecycle commands are not the production UI entry points. `src/persistence.js`, `src/unified-persistence.js` and `src/startup.js` retain legacy contracts for compatibility verification and are excluded from the production build.

Production startup runs `app.load → capture-unified.loadUnified → capture-persistence.migrateEnvelope → original migrateWorkspace (V3→V4→V5 where needed) → frozen migrateV5ToV6`. The boundary caller supplies `migratedAt`; the frozen migration reads no clock/storage.

## Guarded persistence

The production Unified service carries forward the existing guarded snapshot/write/readback/rollback transaction. It validates all sections before writing, retains the exact prior raw in `pre-upgrade`, verifies the snapshot, compares the canonical raw again, writes V6 and validates the actual readback. Failed migration returns no usable migrated state. A concurrent replacement is never overwritten by rollback.

Every app write carries the previously observed raw. Restore also retains `pre-import` and checks raw again after snapshot. Expected stale conflicts lock editing and require a reload; they are displayed as status rather than runtime console errors. A failed capture save restores the last persisted truth and does not announce successful capture.

A blocked startup shows Chinese reasons, preserves old raw, offers raw download and hides fresh-start bypass. Parsed domain exports are disabled when canonical migration is blocked. Valid full backup recovery remains available. Risk/Chime schema and Research Store V1 are unchanged; CSV/Market Bundle are excluded from Unified.

## Capture UI

Each symbol shows editable background, compact current holdings, and a permanently available new-opportunity region. Direction follows active records and is locked while active/pending. Repeated same Setup is available after entry. Pending stages and entry keep the same record identity.

All trade actions, editors, DOM IDs and focus targets use `opportunityId`. Initial Stop corrections and BOF→PB/reverts append only that record's events. The frozen PB 6–10R / BOF 3–6R reference is rendered per record.

Single exit has one confirmation with STOP_EXIT / OTHER_EXIT / UNKNOWN (default UNKNOWN). Flatten has a distinct, stronger confirmation, captures IDs and raw/revision when opened, rejects stale confirmation, calls the frozen atomic flatten once and leaves pending records alive. Cancel changes no canonical state.

History renders one row per record, Chinese lifecycle labels and no delete control for unended records. Ended records remain deletable. Markdown is manual capture only; full JSON retains records, complete event chains, exitCapture, groups and audits.

## Exit Research compatibility

A detached, read-only adapter detects overlapping V6 capture intervals for the same family and excludes those records from the frozen matching input. Blocked records have no Logical Trade, actual execution values or manual candidate controls. No existing manual decision is rebound. Nonoverlapping inputs still use the original engines and fingerprint semantics. The page displays the actual capture schema version.

Step2 reconstruction, Step3 reconciliation/matching, Step4A/B math/replay and Research Store algorithms are unchanged. Overlap blocking is conservative capture compatibility, not execution attribution.

## Verification contracts

Keep all old domain/fixture assertions. V5/M1 UI-layout and M1 no-production-wiring assertions are phase-specific and run against byte-verified frozen M1 artifacts. New M2 tests run the actual current production bundle. The classic-bundle resource-version assertions are updated to the candidate version while retaining the same strict checks.

Required gates: full regression; production bundle syntax; build; whitespace checks; migration fault/CAS/reload tests; actual synthetic browser interaction, downloads and mobile dimensions. No real browser storage or real Tradovate files are used.
