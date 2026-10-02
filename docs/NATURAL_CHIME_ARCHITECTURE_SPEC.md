# Natural Chime — Architecture / Technical Spec

- Status: APPROVED ARCHITECTURE SPEC; IMPLEMENTATION AUTHORIZED
- Version: 1.0
- Date: 2026-10-02
- Decision path: `REUSE_COMPONENTS`
- Depends on: `NATURAL_CHIME_BUSINESS_SPEC.md`

## 1. Authority and Architecture Decision

`NATURAL_CHIME_BUSINESS_SPEC.md` is the only business authority for the chime. This document translates it into module/data/lifecycle constraints and must not change its behavior. The existing `UNIFIED_BUSINESS_SPEC.md`, `UNIFIED_ARCHITECTURE_SPEC.md`, and `UNIFIED_COMPATIBILITY_VERIFICATION_SPEC.md` remain authoritative for intraday, risk manager, theme, backup, conflict, and scroll behavior.

Reuse the current static Vanilla JavaScript application, unified persistence transaction, router, appearance system, conflict policy, and test/build tooling. Adapt the user's authorized `natural-time-chime` cycle/config/audio/voice code into product modules; do not embed the old standalone HTML wholesale. Use Web APIs only. Do not add a runtime dependency, Tone.js, framework, service worker, server, native macOS app, or Screen Wake Lock.

The existing canonical localStorage key remains `trading-control-center:v1` for continuity. Its JSON envelope `schemaVersion` advances from 1 to 2. Unified-v1→v2 migration adds and validates `sections.chime` while preserving the already-validated `sections.intraday`, `sections.riskManager`, and `preferences` by value; it does not rewrite card, account, session, event, or trade data. Existing nested intraday V3→V4 migration remains a separate, already-frozen migration stage. Chime settings share one full JSON export/import.

## 2. Component Overview

```text
index.html / App Shell
  ├─ #/home   Risk Summary (unchanged) + Chime Summary + Intraday Cards
  ├─ #/risk   Existing full Risk Manager (unchanged)
  └─ #/chime  Full Chime Settings
       │
       ├─ Chime Model / Validation / Pure Time Functions
       ├─ Same-Origin Runtime Coordinator
       │    ├─ Global run intent (origin-scoped runtime control)
       │    ├─ Visible + audio-unlocked candidate eligibility
       │    ├─ Web Locks leader (primary)
       │    └─ localStorage lease + BroadcastChannel (fallback)
       ├─ Scheduler (five independent slot clocks; leader only)
       ├─ Output adapter (Web Audio / Speech Synthesis / Notification)
       └─ Unified persistence v2
            ├─ intraday V4 (unchanged)
            ├─ riskManager (unchanged)
            ├─ chime section v1
            └─ appearance preference (unchanged)
```

The scheduler/coordinator is created once by the app shell. Hash-route changes only change view visibility; they never destroy the scheduler, coordinator, AudioContext, or global listeners.

## 3. Module Boundaries

| Responsibility | Proposed boundary | Owns | Must not own |
| --- | --- | --- | --- |
| Chime state | `src/natural-chime/model.js` | Five-slot defaults, validation, immutable slot/global-setting updates, legacy settings normalization | DOM, timers, storage, risk or intraday state |
| Wall-clock math | `src/natural-chime/time.js` | Pure `nextBoundary`, early target, due-event merge/dedup helpers with injected `now` | Browser timers, storage, audio output |
| Unified migration | `src/unified-persistence.js` plus a small chime migration helper | Unified schema v2 validation, deterministic top-level V1→V2 orchestration, existing nested intraday migration, import/export, revision guard | Risk formula changes; separate chime JSON export |
| Same-origin runtime | `src/natural-chime/coordinator.js` | Global run intent, tab visibility/audio eligibility, leader election, status broadcast, relinquish/handoff | Persisted slot configuration or chime content |
| Scheduler | `src/natural-chime/scheduler.js` | Per-slot early/main timers, watchdog, lifecycle rescheduling, stale-event cancellation | Authority to bypass coordinator checks |
| Output adapter | `src/natural-chime/output.js` | AudioContext unlock/beeps, SpeechSynthesis selection, Notification permission/output and visible error results | Business schedule math or duplicate output |
| Home/settings view | `src/natural-chime/view.js`, `src/app.js`, `index.html`, existing CSS | Two-column home card, 0–5 tags and in-tag controls, `#/chime` settings | Risk summary meaning/calculation or intraday semantics |
| Routing/theme | `src/router.js`, existing appearance variables | Add `#/chime`; use existing `#/home`/`#/risk` and appearance behavior | Scheduler mount/unmount decisions |

The exact file split may be kept smaller if pure logic remains independently testable. It must not collapse time math, tab coordination, persistence, and output into one DOM-bound script.

## 4. Persisted Data Model

### 4.1 Unified envelope v2

The top-level envelope is schema 2; its localStorage key is unchanged:

```json
{
  "app": "trading-control-center",
  "schemaVersion": 2,
  "savedAt": 0,
  "timezone": "Asia/Shanghai",
  "revision": 0,
  "sections": {
    "intraday": { "schemaVersion": 4 },
    "riskManager": { "schemaVersion": 2 },
    "chime": {
      "schemaVersion": 1,
      "slots": [
        { "slotId": "slot-1", "enabled": true, "paused": false, "preset": "5", "minutes": 5, "earlySeconds": 30 },
        { "slotId": "slot-2", "enabled": false, "paused": false, "preset": "5", "minutes": 5, "earlySeconds": 30 },
        { "slotId": "slot-3", "enabled": false, "paused": false, "preset": "5", "minutes": 5, "earlySeconds": 30 },
        { "slotId": "slot-4", "enabled": false, "paused": false, "preset": "5", "minutes": 5, "earlySeconds": 30 },
        { "slotId": "slot-5", "enabled": false, "paused": false, "preset": "5", "minutes": 5, "earlySeconds": 30 }
      ],
      "voiceEnabled": true,
      "selectedVoiceURI": "",
      "notifyEnabled": false,
      "legacyImport": { "status": "defaults", "sourceVersion": null }
    }
  },
  "preferences": { "appearance": "system" }
}
```

The example shows the default only. Each actual slot array has exactly five ordered entries with stable slot IDs `slot-1` through `slot-5`. The `paused` flag is durable and independent from `enabled` and global run intent. Values and limits are those in the Business Spec. Browser permission, AudioContext state, global run intent, current leader, timers, and pending events are not persisted in `sections.chime` and are not exported.

`legacyImport.status` is one of `defaults`, `legacy-v1`, `unified-v1-import-default`, or `recovery-default`; `sourceVersion` is null or 1. It documents how settings were obtained and is validated as part of the chime section. It is not used to change schedule behavior. A schema-2 canonical envelope itself is the one-time-migration marker; no separate receipt key is used. The canonical envelope's schema version 2 is unrelated to legacy chime data version 2.

### 4.2 Unified validation invariants

- Top-level schema v2 must contain exactly `sections.intraday`, `sections.riskManager`, and `sections.chime`, plus valid existing preferences. `sections.intraday` and `sections.riskManager` are validated by their existing validators without transformation.
- Chime must contain exactly five ordered slots, unique expected IDs, strict booleans, a supported preset, integer custom minutes in [1, 1440], and integer `earlySeconds` in [0, `min(600, periodMinutes * 60 - 1)`].
- `legacyImport` has only the enumerated values. Unknown fields/enum values or invalid types fail closed rather than being silently dropped/coerced.
- A slot with `enabled=false` keeps its cycle and `paused` values; it is absent from home tags. Per-slot pause updates only that slot and unified `revision`.
- Global run intent and leadership never enter the unified envelope. Every slot/settings edit goes through the existing clone → validate → revision guard → write → read-back → replace-memory transaction.

## 5. Unified Persistence and Migration

### 5.1 Storage identifiers

- Canonical full app data: existing `trading-control-center:v1` key; envelope schema becomes 2.
- Chime legacy settings: exact existing `natural-chime-settings` key; read-only source only when upgrading an existing local unified-v1 canonical, never deleted or rewritten.
- Pre-upgrade snapshot: a dedicated internal key containing the exact pre-upgrade unified-v1 canonical raw string so the V1→V2 transaction can roll back. It is not a user export and does not replace the existing pre-import snapshot.
- Runtime coordination keys/channel are specified in §7 and never included in user backup.

All keys are origin-scoped. When old and new GitHub Pages routes share the same origin, the legacy key is readable regardless of path. No cross-origin fetch or migration is attempted.

### 5.2 Priority and migration matrix

| Input state | Chime source | Result |
| --- | --- | --- |
| Valid unified v2 canonical | Canonical `sections.chime` only | Validate and load. Do not inspect/reabsorb `natural-chime-settings`. |
| Valid local unified v1 canonical | Verified legacy chime V1 if present; otherwise frozen defaults | Validate every section and the exact supported legacy V1 shape before writes; preserve intraday/risk/preferences by value; construct unified v2 with chime; one guarded migration. |
| No canonical | Frozen chime defaults | Completely ignore `natural-chime-settings`: do not read, inspect, validate, or absorb it. Continue the existing risk/appearance bootstrap. |
| Imported unified v1 JSON file | Defaults with `legacyImport.status = unified-v1-import-default` | Portable restore; do not read browser-local legacy chime data. Preview the added defaults, then use the existing confirmed import transaction. |
| Imported unified v2 JSON file | The file's complete sections and preferences | Strictly validate all sections before preview; after confirmation use the existing pre-import snapshot, revision guard, one commit, and exact read-back. |
| Risk-only backup | Existing risk-only path | Replace only risk section; chime/intraday/appearance are unchanged. |
| Valid local unified v1 plus corrupt/unknown legacy chime, including `version: 2` | No automatic chime defaults or repair | Use the one read-only recovery behavior and exact message in Business Spec §11; preserve raw sources, show validated intraday/risk read-only, and lock writes until explicit recovery. |
| Unknown/corrupt canonical, chime section, or other section | No guessed defaults | Fail closed; do not partially migrate, overwrite, delete the old key, or mutate validated sections. Preserve raw sources and use the existing recovery/export path. |

The only supported legacy chime format is the verified V1 flat object: `version` is absent or the number `1`; the only allowed keys are `version`, `preset`, `minutes`, `early`, `voice`, and `notify`. `preset` is an existing select value (`3`, `5`, `15`, `30`, `60`, `240`, or `custom`) and defaults to `5`; `minutes` and `early`, when present, are decimal integer strings as written by the old HTML inputs. `minutes` must be in [1, 1440]; `early` must be in [0, 60], then also satisfy the current chime slot's stricter representable bound. `voice` and `notify`, when present, must be booleans; missing values use the old UI defaults (voice on, notification off). It maps to slot 1 enabled/unpaused and slots 2–5 disabled/unpaused, with an empty selected voice URI. No clamping or coercion is allowed. Legacy `version: 2` and every other explicit unknown version or malformed shape enter the read-only recovery behavior in Business Spec §11; their source bytes remain unchanged. This rule concerns the old chime key only and does not change unified envelope schema 2. A local bootstrap without canonical and a unified-v1 file import do not read the browser-local chime key.

### 5.3 Migration transaction and rollback

1. Capture the exact current canonical raw, legacy raw, and expected revision. Do not change any of them during parsing/validation.
2. Validate unified-v1 top-level and every section, the full current intraday V4 state, full risk section, appearance, and the exact supported legacy chime V1 shape if present. Legacy chime `version: 2`, malformed, or unrepresentable data enters the single safe recovery behavior in Business Spec §11 before any write.
3. Create the dedicated pre-upgrade snapshot and verify byte-for-byte read-back. If this cannot be written and verified, abort with original storage untouched.
4. Construct unified v2 in memory. Set top-level `schemaVersion = 2`, increment the canonical `revision` exactly once, and preserve top-level `savedAt`, `app`, and `timezone`. For a current V4 canonical, `sections.intraday`, `sections.riskManager`, and `preferences` must compare deeply equal to their validated V1 values; add only the validated chime section. If the pre-existing nested intraday V3→V4 migration applies, run and verify it as a separate stage first, then verify the envelope-only V1→V2 transform leaves its resulting V4 section unchanged.
5. Commit through the existing revision-guarded unified writer and verify exact canonical read-back. The schema-2 canonical is the idempotence marker; no separate receipt key is used.
6. If write or verification fails, restore the exact pre-upgrade canonical raw and verify rollback. If rollback cannot be verified, enter recovery-required and preserve the snapshot and all source keys.
7. A valid schema-2 canonical is always authoritative. Never read or reabsorb the legacy settings key after it exists.
8. Never delete the legacy settings key, including after successful migration or import.

Startup migration and JSON import are separate paths: only the first migration of an existing local unified-v1 canonical may read and absorb the verified legacy V1 chime key. A local bootstrap without canonical and a unified-v1 file import use chime defaults and never read the browser-local key. A unified-v1 file import still runs preview → confirmation → pre-import snapshot → revision/raw guard → one canonical commit → read-back. Unified-v2 import strictly validates every section before that flow.

## 6. Scheduler and Wall-Clock Functions

### 6.1 Pure functions

All time math receives an explicit `nowMs` and timezone parameter/default `Asia/Shanghai`; it must not read the DOM, current locale, or `Date.now()` internally when a test argument is provided.

- `nextBoundary(periodMinutes, nowMs, 'Asia/Shanghai')`: strictly later boundary, anchored to the current Beijing calendar day's midnight.
- `earlyTarget(boundaryMs, earlySeconds)`: boundary minus offset; no event if offset is zero or target is not future when scheduling.
- `mergeDueEvents(events)`: group to one-second resolution; main event suppresses coincident early events; identical events deduplicate deterministically.
- `effectiveSlots(settings, runIntent, visible, audioUnlocked, isLeader)`: only enabled and unpaused slots under all runtime gates.

### 6.2 Runtime scheduler

- Exactly one app-shell scheduler coordinator owns five slot runtime records. Each eligible slot has a main timer and optional early timer; disabled, individually paused, global-paused, hidden, audio-locked, conflicted, or non-leader states cannot emit.
- The leader schedules from the next future boundary on acquisition. Each callback rechecks run intent, visibility, AudioContext state, leader token, current slot flags, and due-event freshness immediately before output.
- Early timer is dropped if it would already be past at scheduling time or if it fires after its target boundary. Main timer events delayed by more than 1500 ms are stale and discarded; the next future cycle remains scheduled. The 1500 ms threshold is an engineering tolerance, not a claim of timer precision.
- One watchdog may re-evaluate future targets at a bounded interval (10 seconds, inherited from the reference behavior). It may repair timer drift but must never replay past events.
- On slot setting change, re-evaluate only that slot. On global pause, per-slot pause, hidden/pagehide, AudioContext suspension, external unified conflict, leader loss, or app teardown, clear the affected timers and queued events before releasing leadership.
- On visibility restoration/focus/pageshow, a previously eligible tab requests election only after checking live same-origin run intent, current visibility, and unlocked audio. After becoming leader, compute new strictly future targets; never reuse pre-hide pending events.

## 7. Same-Origin Global Run Intent and Single Audible Leader

### 7.1 Run-intent lifecycle

- Global run intent (`running`/`paused`) is an origin-scoped runtime record observed by open/reloaded app tabs, not a per-slot field and not backup data. `开始报时` sets it to running; global `暂停` sets it to paused in every tab and makes every tab stop output. The record does not expire on leader loss, route change, hidden state, or reload. Starting never changes the independent slot `paused` flags.
- A same-origin session with no run-intent record initializes paused. An app tab joining or reloading into a session with a run-intent record reads its current status but has no audio eligibility until its own AudioContext is successfully unlocked by a user gesture.
- A `BroadcastChannel` carries status/commands promptly. A versioned localStorage runtime record carries the current same-origin run intent and generation so a newly opened/reloaded tab can discover it. The run intent is not expired when the audible leader disappears, pages become hidden, or a tab reloads; it changes only through explicit global `开始报时`/`暂停` actions. Per-tab AudioContext unlock is never persisted, so page load/reload cannot produce audio automatically.
- Run intent is not chime configuration; it is not included in exported JSON. Conflict/error does not convert a slot's `paused` flag.

### 7.2 Eligibility and handoff

A tab is eligible to compete only if all are true:

1. same-origin global run intent is `running`;
2. `document.visibilityState === 'visible'` and no `pagehide` suspension is active;
3. this tab's AudioContext state is `running` after an explicit gesture; and
4. its unified data is validated and not stale/conflict-locked.

On `visibilitychange` to hidden, `pagehide`, AudioContext suspension, global pause, external storage conflict, or teardown, the current leader cancels timers/queued output, relinquishes its leadership claim, and broadcasts status. It does not rewrite global run intent or any setting. An eligible visible/unlocked follower may take over; if none exists, every open page reports `global running, no audible leader` (or equivalent) and no page claims reliable delivery. When a candidate becomes visible/unlocked again, it may compete. Handoff re-anchors all eligible slots to their next future `Asia/Shanghai` boundary.

Non-leaders may render canonical settings and status but may not emit sound, speech, Notification, or preview. A non-leader setting change is committed only via the existing unified transaction. Tabs that detect an external-write conflict become read-only, stop stale output, and release leadership until the established reload/recovery flow resolves.

### 7.3 Web Locks primary path

- Use `navigator.locks.request()` with one stable origin-wide exclusive lock name, e.g. `trading-control-center:natural-chime-audible-leader`.
- Use non-stealing acquisition. The lock callback is held only while the tab is audible leader; an abort/release signal resolves it on hidden/pagehide/global pause/context suspend/conflict/unmount.
- A visible/unlocked running candidate that receives no lock is a follower. It waits for a release/status event and may retry while still eligible; it cannot sound while waiting.
- Before every output, verify the local leader callback is still active and the current eligibility predicate is true. `BroadcastChannel` status is advisory; Web Lock ownership is authoritative.
- Web Locks are available in secure contexts; target deployment is HTTPS GitHub Pages and localhost preview. If API access fails, enter the fallback path, not simultaneous dual coordination.

### 7.4 localStorage lease + BroadcastChannel fallback

This path is used only when Web Locks are unavailable or unusable. Both writable same-origin localStorage and BroadcastChannel are required. If either is unavailable or a lease cannot be verified, fail closed: no tab emits output.

Lease record (versioned and JSON validated): `ownerTabId`, `leaseToken`, `runGeneration`, `heartbeatAt`, `expiresAt`. `ownerTabId` is a random per-tab ID; `leaseToken` is freshly generated for each claim. Suggested runtime constants are 2,000 ms heartbeat, 8,000 ms lease TTL, and a 300 ms claim-settlement window; all are isolated constants covered by tests.

Election/renewal contract:

1. A candidate must first satisfy all four eligibility checks in §7.2. It broadcasts a claim with its tab ID and current run generation, waits the settlement window, and gathers active same-generation claims.
2. Among claims observed in that window, the lexicographically smallest `ownerTabId` is the deterministic contender. Other tabs remain followers. A valid, non-expired lease already owned by another tab takes precedence until release/expiry.
3. The contender writes a provisional lease with its unique token, immediately reads back and requires exact ownership/token/generation equality, broadcasts the claim, waits one additional verification interval (at least 250 ms), and verifies storage and visible candidate state again before becoming leader.
4. A leader renews only if the existing lease still exactly matches its token and generation; it writes the renewed expiry and verifies read-back. A follower treats a lease as stale only after TTL expiry plus a re-check, not from a BroadcastChannel message alone.
5. Before every audio/speech/notification/preview output, and after any awaited permission/audio operation, the leader rereads and validates its lease token, expiration, run generation, visibility, and AudioContext state. Any mismatch/uncertainty suppresses output immediately and demotes the tab.
6. On hidden/pagehide/global pause/conflict, the owner clears the lease only if the stored token still matches; it broadcasts release. If storage fails, it ceases output and lets the lease expire; no other tab may trust an unverified release message.
7. If multiple claims, clock changes, storage events, or channel messages make ownership ambiguous, all contenders suppress output, wait for a fresh election window, then elect again. Status must expose `no verified leader`/`waiting for lease`, not claim playback.

The localStorage lease is coordination metadata, not user settings, and is never included in unified backup. The deterministic arbitration, lease expiry, output-time token checks, and fail-closed ambiguity path are mandatory regression tests. The system does not promise continuous delivery during storage failure or browser sleep.

## 8. Browser Output Adapter

- Instantiate/resume Web Audio only from `开始报时`, `试听提示音`, or another explicit audio-unlock gesture. An unresolved/suspended context is not eligible to lead.
- The output adapter owns oscillator/beep lifecycle and returns explicit success/failure; early uses one beep, main three, preview two.
- Voice uses `SpeechSynthesis` only when enabled; try selected `voiceURI`, then `zh-CN`, then any `zh-*`; missing voice is a visible partial degradation and does not block audio.
- Notification is optional/off by default. Request permission only as a consequence of an explicit global-start user action when enabled and permission is `default`. A denied/unavailable permission produces visible status; it never blocks sound and is never repeatedly prompted.
- Only the verified audible leader may invoke any output channel. Notification permissions remain browser-owned and are not imported/exported.
- Test/preview obtains temporary same-origin exclusive output permission when no scheduler leader exists; if another leader exists, no preview output. If same-origin run intent is already running and this tab is eligible, the coordinator may make it scheduler leader without changing run intent, then play the preview under the same token.
- Errors are surfaced to the chime UI/announcer and diagnostics without exposing account or trading state.

## 9. UI, Routing, and Theme Integration

- Home's upper region becomes a two-column composition: existing risk summary on the left is not edited; chime summary on the right. Intraday cards remain below in current order.
- Summary creates only enabled-slot tags, each with fixed equal geometry and an in-tag keyboard button. Five tags use five equal same-row tracks; no empty tag DOM nodes. Tag icon state reads only persisted `slot.paused`; global status separately reports pause, leader, waiting, no leader, audio locked, and errors.
- Button action/`aria-label`/`title` derives from the slot's durable pause state and includes slot/period. `button` native keyboard handling, visible focus, icon shape, and text/status make meaning independent of color.
- `#/chime` is added to route parsing and view selection. Existing `#/home`, `#/risk`, browser back/forward, unknown-route behavior, and scroll preservation remain unchanged.
- All new colors/surfaces use current theme variables for light/dark/system. The scheduler is initialized once before route changes and is not owned by a route view.

## 10. Unified Export, Import, Revision, and Rollback

- Export remains exactly one user-facing JSON file. It contains intraday, risk manager, chime settings including all five `paused` values, and appearance. It excludes global run intent, leader/lease, browser permissions, runtime timers, and pending events.
- Full V2 import validates every section before showing preview; preview explicitly lists chime replacement and source migration/defaulting. Existing confirmation, pre-import snapshot, expected-raw/revision guard, single canonical commit, read-back equality, and rollback behavior remain in order.
- Importing unified V1 upgrades its intraday/risk/preferences without semantic changes and adds deterministic default chime settings; it does not absorb the machine-local legacy key. Importing V2 uses the backup's chime data. Risk-only import replaces only the risk section.
- Before local V1→V2 upgrade, preserve exact raw canonical V1 in a verified pre-upgrade snapshot. If any validation/write/read-back stage fails, roll back exact canonical raw. If rollback cannot be confirmed, freeze writes and offer recovery/export; do not continue with a mixed envelope.
- A successful canonical V2 is the one-time migration marker and is always authoritative. The old `natural-chime-settings` key remains byte-for-byte unchanged and is never reabsorbed after V2 exists.
- Existing canonical raw, risk values/formulas, intraday records, old chime raw, and pre-import snapshot are never conflated. Unknown versions/corrupt bytes fail closed and cannot be normalized to defaults.

## 11. Build, Compatibility, and Non-Dependency Constraints

- Keep the current ESM source modules and regenerate the existing classic production bundle only by the repository's build command after implementation authorization.
- No `package.json` runtime dependency change. Do not load scripts/fonts/audio from a remote CDN. Do not fetch the old project at runtime.
- Static GitHub Pages and localhost remain the supported deployment modes. Same-origin coordination works only inside one scheme/host/port origin; no cross-origin communication is promised.
- macOS Chrome and Safari current stable versions are the required manual browser targets. Feature-detect Web Locks, BroadcastChannel, localStorage, Web Audio, speech, and Notification; unsupported mandatory coordination fails closed for sound.

## 12. Verification Design

### 12.1 Pure unit tests / Ground Truth

- Five-slot defaults; strict validation; immutable `enabled`/`paused` updates; global state never rewrites per-slot state.
- Six preset periods 3/5/15/30/60/240 and custom 1/7/1440 minutes, Beijing midnight anchoring, exact-boundary start, date rollover, local browser timezone differing from Asia/Shanghai, and early offset limits.
- Main/early same-second priority, deterministic deduplication, early target already passed, callback delayed beyond 1500 ms, no replay after resume, and no batch catch-up.
- Verified legacy V1 flat mapping; legacy chime `version: 2` and other unknown/malformed/unrepresentable data fail closed; `paused=false` for migrated slots; unified schema-2 canonical precedence and no repeated absorption.

### 12.2 Persistence and compatibility tests

- Unified top-level V1→V2 migration preserves current intraday/risk/preferences by deep equality and adds one validated chime section. A separately applicable existing nested intraday V3→V4 migration is verified as its own stage.
- Verified legacy chime V1 is absorbed exactly once only during first local canonical V1→V2 migration; original bytes remain unchanged and unified schema-2 canonical never reabsorbs it. Legacy chime version 2 enters fail-closed recovery. Local bootstrap and unified-v1 file import use defaults.
- New unified V2 export includes all five cycle pause flags in one JSON; round-trip restore preserves every chime setting.
- V1 backup import uses defaults and the full preview/confirmation/revision-guard/single-commit/read-back flow without reading local legacy; risk-only import leaves chime unchanged; full V2 import strictly validates and replaces all sections.
- Corrupt/unknown legacy chime, including explicit legacy `version: 2`, during local unified-V1→V2 migration yields the exact read-only recovery state/message in Business Spec §11; explicit ignore uses defaults and preserves raw legacy bytes. No-canonical bootstrap never reads the key. Corrupt canonical, unknown section versions, localStorage/quota failure, revision conflict, failed verification, and rollback failure all stop without partial risk/intraday/chime writes.
- Pre-import and pre-upgrade snapshots are byte-verified; damaged/unknown content remains recoverable.

### 12.3 Coordinator/scheduler tests

- Mocked Web Locks prove mutual exclusion, non-stealing behavior, leader release on hidden/pagehide/pause/context suspension/conflict, immediate visible-follower election, and no output from followers.
- Fallback tests exercise simultaneous claims, deterministic tab-ID tie-break, lease renew/read-back, expiration, stale leader restart, lost BroadcastChannel messages, storage failure, clock jumps, ambiguous ownership, and output-time lease token checks; ambiguity always suppresses all output.
- Only visible + audio-unlocked + run-intent-running + canonical-current tabs can compete. If none qualifies, all tabs report no audible leader; no tab says it is reliably reporting.
- Leader handoff does not alter `enabled`, `paused`, voice, notification, or global run intent; all eligible slots rebase to future boundaries.
- Global pause propagated to all tabs stops all sound without changing per-cycle pause state; global start resumes only enabled/unpaused cycles.
- Non-leader slot edits use canonical persistence/revision. Stale tabs enter existing conflict lock and stop old-settings output.
- Route changes preserve one scheduler and do not reset timers; actual `visibilitychange`, `pagehide`, `pageshow`, and focus behavior is covered.

### 12.4 UI and manual acceptance

- DOM tests cover 0–5 tags, no empty placeholders, fixed equal dimensions, no wrap, five equal columns, right-side 20–22 px icons, symmetric text space, title/aria-label, keyboard activation/focus, and mixed real slot states.
- Light/dark/system visual QA covers home two-column layout, unchanged left risk values/meaning, status variants, full settings route, five tags in one row, and narrow-container no-wrap behavior.
- Manual acceptance on current macOS Chrome and Safari: audio unlock, permission granted/denied, voice available/missing, two or more tabs, hidden-leader handoff, no-visible-candidate status, per-slot pause/resume persistence, global pause/start, route changes, background/sleep missed-event discard, and import/export.
- Regression verification includes the existing `npm test`, `npm run build`, bundle syntax/content checks, `git diff --check`, risk/intraday/GC-CL-ES/appearance/scroll-preservation suites. Report actual test totals from the run; do not hard-code a future count in this spec.

## 13. Scope and Gate

This Architecture Spec and its referenced Business Spec are approved, executable constraints, and the user has explicitly authorized the implementation defined here. That authorization does not permit scope expansion, dependency installation, commit, push, or deployment. Local implementation, tests, build, and preview are in scope; the user will perform local acceptance before any separate release decision.
