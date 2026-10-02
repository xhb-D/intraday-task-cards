# Natural Chime — Business Spec

- Status: APPROVED BUSINESS SPEC; IMPLEMENTATION AUTHORIZED
- Version: 1.0
- Date: 2026-10-02
- Decision Gate: REUSE_COMPONENTS
- Product: natural-cycle chime integrated into the existing intraday trading card application
- Scope: this document defines the chime domain and its UI and is synchronized with the unified-envelope-v2 amendments. It does not amend intraday V4 or risk-manager business rules.

## 1. Authority and Existing-System Boundary

This specification is subordinate to and must be read with:

- `UNIFIED_BUSINESS_SPEC.md`
- `UNIFIED_ARCHITECTURE_SPEC.md`
- `UNIFIED_COMPATIBILITY_VERIFICATION_SPEC.md`

Those documents, at their synchronized schema-v2 baseline, remain authoritative for the existing intraday cards, GC/CL/ES isolation, risk manager, appearance settings, canonical storage safety, unified backup/import confirmation, external-write conflict protection, and scroll-preserving interactions. This specification adds a chime domain; it does not redefine or weaken those rules.

The selected path is `REUSE_COMPONENTS`: reuse the existing Vanilla JavaScript host, unified persistence, router, theme, conflict protections, and test/build foundation; under the user-confirmed rights, adapt the five-slot configuration, natural-boundary calculations, sound, voice, and settings behavior from [natural-time-chime](https://github.com/xhb-D/natural-time-chime); use browser-native APIs only. Do not introduce Tone.js or any other runtime dependency.

## 2. Product Goal and Non-Goals

### 2.1 Goal

Provide a local, user-controlled natural-time chime in the existing app. It reminds the user at configured wall-clock boundaries and can announce an upcoming boundary. It remains independent of trade bias, market structure, opportunities, positions, account data, and risk decisions.

### 2.2 Non-goals and prohibited behavior

- No market data, chart integration, price/volume reading, signal generation, order entry, broker API, or automatic change to intraday state.
- No cloud account, server persistence, cross-device sync, macOS native app, system task, or Screen Wake Lock.
- No new runtime dependency, third-party state machine, or rule engine.
- No guarantee of delivery while the browser or operating system suspends or throttles a page.
- Do not delete, archive, rewrite, or otherwise clean up the old natural-time-chime repository in this scope.
- Never let chime settings or runtime failures mutate the intraday or risk-manager business data.

## 3. User and Scenarios

The user is the local browser user of the existing manual GC/CL/ES state card.

1. On `#/home`, view the unchanged risk summary beside current time, chime status, and zero to five configured-cycle tags.
2. Configure up to five independent cycles and advance reminders at `#/chime`; set voice, selected voice, and optional browser notifications on `#/home`.
3. Explicitly click the home-page global `开始报时` control to unlock audio and run eligible cycles in that page.
4. Pause or resume an individual configured cycle directly from its home-summary tag without changing other cycles.
5. Use the home-page global `暂停` or `试听提示音` controls; global pause stops actual scheduling/output while preserving each cycle's individual state.
6. Switch between `#/home`, `#/risk`, and `#/chime` without unmounting or restarting the app-shell scheduler.
7. If a browser suspension causes a missed event, resume at the next future boundary; never replay missed events.
8. Export/import intraday, risk-manager, chime, and appearance data through the existing single unified JSON backup flow.

## 4. Inputs and Outputs

### 4.1 Inputs

- Five ordered schedule slots, each with `enabled`, `paused`, `preset`, `minutes`, and `earlySeconds` values.
- Global voice preference, selected voice URI, and optional notification preference.
- The current instant and the fixed `Asia/Shanghai` timezone.
- Explicit user actions: `开始报时`, global `暂停`, per-cycle `暂停`/`恢复`, and `试听提示音`.
- Browser capabilities and state: Web Audio, available speech voices, Notification permission, page visibility, same-origin leader lock, and local storage.

### 4.2 Outputs

- Home summary: current Beijing wall-clock time, global scheduler state, `已设置报时 N/5`, one compact tag per enabled slot with its individual pause/resume control, voice enable/selection, browser notification preference, global start/pause, preview, and settings link.
- Full settings view: only the five independent cycle configurations, including enable, period/custom minutes, advance notice, and individual pause/resume; it does not repeat voice/notification preferences or global runtime controls/status.
- At a main boundary: the main sound, optional enabled speech, and optional permitted browser notification.
- At an enabled early boundary: the distinct early sound, optional enabled speech, and optional permitted browser notification.
- Visible status/error text when audio cannot be unlocked, the tab is not leader, a notification is denied, a setting is invalid, or storage is in recovery/conflict mode.

## 5. Five-Slot Business State

Exactly five ordered slots exist. A slot is counted and shown in the home summary when `enabled === true`; a disabled slot is not shown and is not a placeholder. Disabling a slot does not erase its configured interval. Its `paused` value is retained; re-enabling it restores that independent pause state.

Each slot has:

| Field | Meaning |
| --- | --- |
| `enabled` | The slot is configured for use and appears in the summary. |
| `paused` | The user's independent pause state for this slot. `true` means it must not run on the next global start. |
| `preset` | One of `3`, `5`, `15`, `30`, `60`, `240`, or `custom`. |
| `minutes` | Integer custom period in the inclusive range 1–1440; used only for `custom`. |
| `earlySeconds` | Advance-notice offset in seconds. Zero disables the early event. |

The six preset values are interpreted in minutes: 3, 5, 15, 30, 60, and 240. `custom` uses `minutes`. The maximum early offset is `min(600, periodMinutes * 60 - 1)` seconds. The default offset is `min(30, maximumEarlySeconds)`.

Initial settings, including a migration with no legacy chime key, follow the existing natural-time-chime defaults: slot 1 is enabled, unpaused, and set to 5 minutes with a 30-second early notice; slots 2–5 are disabled, unpaused, and have the same editable defaults. Voice is enabled; selected voice URI is empty (use the voice fallback rule); browser notifications are disabled. A same-origin session with no run-intent record starts globally paused. A tab opened or reloaded into an active same-origin session observes its run intent but cannot emit until it independently satisfies visibility, audio-unlock, and leader requirements.

The same-origin global run intent, per-tab audio-unlocked/visibility state, and leader ownership are runtime coordination state, not chime settings. They are never included in unified backup. The shared run intent remains unchanged by reload, hidden-page handoff, or leader loss; only an explicit global `暂停` changes it to paused. A tab may observe a live same-origin run intent but cannot emit until its own AudioContext is unlocked by a user gesture and it holds the leader. A same-origin session with no run-intent record defaults to paused; page load never starts audio automatically. Per-slot `enabled`/`paused` and all user configuration are durable and included in unified backup. Browser notification permission and AudioContext state are not part of the backup.

## 6. Frozen UI

### 6.1 Home view

- The upper risk-dashboard area is a two-column layout. The left risk summary and all of its current meaning, values, calculations, and behavior remain unchanged. The right column is the chime summary.
- The chime summary contains current `Asia/Shanghai` time, global runtime/leader status, `已设置报时 N/5`, configured-cycle tags with individual pause/resume controls, voice enable/selection and optional browser-notification preference, the controls `开始报时`, `暂停`, and `试听提示音`, plus a link to `#/chime`.
- The home summary preserves the existing status priority: explicit operation/error feedback, coordinator error, global paused, no enabled/all cycles individually paused, this page is leader, another page is leader, no visible page, audio locked, then waiting for a visible page to take over. Status must not be moved to or duplicated on the settings route.
- All open pages display the canonical unified chime settings they have loaded and an accurate same-origin run/leader state. Suggested concise states are `当前页面负责报时`, `由其他页面负责报时`, `等待可见页面接管`, and `当前没有可用报时页面`; final wording may follow existing app copy style without changing these meanings.
- `N` is the number of enabled slots, whether individually paused or not. Display exactly N tags; do not render empty tag placeholders. With N=0, show no cycle tag and show an ordinary empty-state sentence (not a fake tag).
- A tag identifies its configured period (including a custom period). It contains its own small circular pause/resume button inside the tag at the right. No extra row is added for these controls.
- All visible tags have equal width and height, stay on one row, and use at most five equal-width tracks. At N=5 there are exactly five equal columns. For N<5 unused tracks have no DOM placeholder. Narrow containers may scroll horizontally; tags must not wrap, shrink unequally, or hide their time text.
- Reserve symmetric text space around the right-side icon so five tags remain legible. The icon itself is approximately 20–22 px; the button has a visible keyboard focus ring and a usable hit area.
- Per-cycle icon semantics depend only on that cycle's durable `paused` flag, not global runtime: unpaused shows a pause icon; paused shows a green play icon. The play/pause shape and accessible name must communicate state without relying on color. The panel's global status separately explains when the entire scheduler is paused.
- Each control is a real keyboard-operable button. Its dynamic `aria-label` and `title` identify both the action and cycle, e.g. `暂停第 2 个周期（每 5 分钟）` or `恢复第 2 个周期（每 5 分钟）`. Enter and Space activate it.
- When five tags are shown, the pattern is still determined by the five real slot states. Any mixed-state picture in design material is illustrative only.
- Light, dark, and system-following appearances must match existing app components.

### 6.2 Full settings route

- Provide the `#/chime` route without changing the semantics of `#/home` or `#/risk`.
- Expose five independently editable slots with enable, cycle preset/custom minutes, early-seconds setting, and an individual pause/resume action.
- Show the `自定义分钟` row only when that slot's cycle is `自定义`; under a preset, hide the whole row. Switching back to a preset must retain the saved custom minutes so selecting `自定义` again restores the prior value.
- Per-cycle actions use only the terms `暂停` and `恢复`. The term `开始报时` is reserved for starting the whole scheduler.
- Voice enable/selection, notification preference, global runtime status, global `开始报时`/`暂停`, and `试听提示音` are home-only controls and must not appear on this route.
- Settings changes persist through the unified coordinator. Invalid edits remain visible with an error and do not silently mutate saved state.

## 7. Lifecycle and State Transitions

Let `eligible(slot) = slot.enabled && !slot.paused`. Let `tabCanLead = documentVisible && audioContextUnlocked`. Let `effective(slot) = sameOriginRunIntent && tabCanLead && localTabIsLeader && eligible(slot)`.

### 7.1 Global start and pause

- `开始报时` is a direct user gesture. It must first unlock/resume this tab's AudioContext; on success it sets the same-origin runtime run intent to running and makes this visible, unlocked tab eligible to compete for the audible leader. All app tabs show the shared run intent and current leader status.
- If no slot is eligible, the run intent may remain running but no schedule or sound is produced; status explains that no unpaused configured cycle is available. The global control does not clear any per-slot setting.
- If another tab holds the leader lock, this tab does not play. It shows that another page is leader. If it remains visible, unlocked, and globally running, it can automatically compete when the current leader relinquishes; it never plays before acquiring the lock.
- Global `暂停` sets the same-origin run intent to paused, cancels all actual timers and pending events in every open app tab, stops output, and releases any leader lock. It does not change any slot's `enabled` or `paused` field.
- A subsequent global `开始报时` resumes only slots whose `enabled` is true and `paused` is false. Individually paused cycles remain paused.
- Global run intent is origin-wide runtime coordination and is never exported. A newly opened tab observes the current intent but is not eligible to lead until its own audio context is unlocked and it is visible. When there is no run-intent record, the default is paused. Durable per-slot pause state is restored from unified canonical data.

### 7.2 Per-cycle pause and resume

- Clicking a running/eligible slot's pause icon writes only that slot's `paused = true`; it cancels that slot's early/main timers and pending events, without changing other slots.
- Clicking a paused slot's green play icon writes only that slot's `paused = false`. If the same-origin run intent is active and an eligible tab is leader, that slot schedules its next future boundary immediately. Otherwise it becomes eligible for the next global start or leader election.
- The action is idempotent when the slot already has the requested state. A failed unified write leaves the displayed durable state unchanged and follows existing storage/conflict protection.
- A leader or follower reads and writes cycle state only through the canonical unified persistence/revision path. An external write makes stale tabs read-only and stops their stale scheduler output; BroadcastChannel is not a substitute for saving or revision validation.
- Per-slot state persists across refresh, route change, unified envelope schema 1→2 migration, chime section migration, export, and import.

### 7.3 Configuration change and route lifecycle

- While globally paused, a valid settings edit persists without starting any sound.
- While the same-origin run intent is active and this tab is leader, changing a slot re-evaluates only that slot from the next future boundary; other slots keep their current scheduled boundary.
- Disabling a slot removes its summary tag and cancels its events, but retains its interval and individual pause flag.
- Route changes never destroy/recreate the scheduler. Becoming hidden or receiving `pagehide` immediately relinquishes audible leadership without changing the global run intent or any cycle setting. An eligible visible/unlocked tab may take over and schedules only its next future boundaries. If no such tab exists, all open pages show that the run intent is active but there is no audible leader; no page may claim that chimes are currently being delivered reliably. A user gesture that starts reporting or unlocks audio makes a visible tab eligible to compete.
- Closing a tab releases its leader claim. A remaining tab may lead only if it is visible, audio-unlocked, and the same-origin run intent remains running.
- An external unified-storage conflict makes the stale tab stop output and relinquish leadership. It remains read-only until the existing conflict/reload flow resolves the canonical state.

### 7.4 Preview/test

- `试听提示音` is an explicit user gesture and plays a short two-beep preview; if voice is enabled and available, it may speak `提示音试听。`.
- Preview does not change any slot, global scheduler state, or persisted setting; it does not issue browser notifications.
- Preview sound is also subject to the same-origin single-audio-leader rule. If another tab owns the lock, the preview is not played and a visible message explains why.

## 8. Natural Boundary, Early Event, and Missed Event Rules

- The only schedule timezone is IANA `Asia/Shanghai`; browser timezone settings must not change the result. User-visible clock labels are Beijing local time.
- For period P minutes, anchor boundaries to midnight at the current date in `Asia/Shanghai`. The next boundary is strictly later than `now`: `dayStart + (floor((now - dayStart) / (P * 60,000)) + 1) * (P * 60,000)`. Thus an exact-boundary start schedules the following boundary, not an immediate duplicate.
- Preset and custom periods use the same rule. A 1440-minute custom period aligns to the next Beijing midnight. For a custom period that does not divide a day, each day's sequence is re-anchored to that day's Beijing midnight.
- An early event is scheduled at `targetBoundary - earlySeconds`. It is omitted when offset is zero or its target is not still in the future when scheduling begins. It never fires immediately to compensate for a past early target.
- At one-second resolution, coincident main events take priority over early events. Identical events are deduplicated; separate non-coincident early events remain separate.
- Browser timer delivery is best-effort. A tab must relinquish audible leadership on `visibilitychange` to hidden and on `pagehide`. If a boundary or early event is missed during a hidden/background/suspended/sleep interval, it is discarded. On `visibilitychange` to visible, window focus, or `pageshow`, a tab with a running same-origin intent and unlocked audio may compete; after acquiring leadership it clears stale timers/pending events and computes only the next strictly future boundary for each eligible slot. Never replay or batch missed events.
- When no eligible visible/unlocked tab exists, there is no audible leader. Every open page reports the shared run intent and absence of a leader accurately. The next visible user action that starts reporting or successfully unlocks audio may enter election; hidden pages never compete.
- Leader handoff changes no schedule, `paused` flag, voice/notification preference, or global run intent. Only global `暂停` changes the global run intent.

## 9. Audio, Voice, and Notification Failure Semantics

- Every global start and preview begins from a user gesture. AudioContext must be resumed/unlocked before a start action may set the same-origin run intent to running. If unlock fails, do not change the run intent, do not grant this tab leadership, show a visible actionable error, and do not claim that this page is reporting. A previously active same-origin run intent is not silently changed by one tab's unlock failure.
- Audio is the required main cue. Speech and notifications are optional independent channels. Speech failure/unavailable voice does not stop the beep. If a selected voice URI is unavailable, try `zh-CN`, then another `zh-*` voice; if none exists, omit speech and show a non-blocking status.
- Notification preference is off by default. If enabled and permission is `default`, request permission only from the explicit global-start gesture. If denied or unavailable, keep the setting, omit notifications, show a visible status, and continue with audio/voice. Do not repeatedly prompt after denial.
- The main event uses the existing three-beep pattern; the early event uses the one-beep pattern. Optional speech announces the target boundary; optional notification mirrors the event. All actual outputs are emitted only by the current leader.
- Muted hardware/OS output cannot be inferred from a successful AudioContext state; status may claim the browser audio channel is unlocked, not that sound physically reached the user.

## 10. Invariants and Forbidden Transitions

1. Exactly five ordered schedule slots exist in persisted chime state.
2. A disabled slot is absent from home tags; an enabled but individually paused slot remains visible and retains its setting count.
3. `paused` is independent of global scheduler runtime. Global pause never rewrites per-slot state.
4. Only `sameOriginRunIntent && documentVisible && audioContextUnlocked && leader && enabled && !paused` may schedule or emit an event.
5. One same-origin lock owner maximum; no verified lock/lease means no actual sound, speech, notification, or preview output.
6. Per-slot pause/resume changes only that slot's `paused` field and the unified revision; it cannot alter other cycles, intraday state, risk data, or preferences.
7. A missed event is never replayed; after resume all scheduled events are in the future.
8. `#/home`, `#/risk`, and `#/chime` share one app-shell scheduler and one canonical unified store.
9. No automatic audio on page load. If no same-origin run-intent record exists, runtime defaults to paused; a tab joining an active same-origin session observes its run intent but must independently unlock audio and acquire leadership before output.
10. Do not delete or mutate the legacy `natural-chime-settings` key during or after migration.
11. Never overwrite or mutate damaged/unknown canonical or legacy raw data. A corrupt/unknown legacy chime value triggers the recovery path only when it is read during the first upgrade of an existing unified-v1 canonical; a no-canonical bootstrap ignores the legacy key and writes frozen defaults without changing it.
12. Do not change existing intraday, risk-manager, or appearance behavior to accommodate the chime.

## 11. Unified Data Migration and Recovery

- The canonical localStorage key remains `trading-control-center:v1`; its JSON envelope advances from schema 1 to schema 2. A local schema-1 canonical is upgraded automatically and deterministically after every section validates.
- The schema upgrade adds and validates `sections.chime`. `sections.intraday`, `sections.riskManager`, and `preferences` are value-equal before and after this envelope-only upgrade. No account balance, session, event, trade record, card state, or existing preference may be rewritten by the envelope upgrade.
- Only the verified flat V1 `natural-chime-settings` value may be absorbed, and only while upgrading an existing local unified schema-1 canonical for the first time. Its `version` is absent or numeric `1`; allowed keys are `version`, `preset`, `minutes`, `early`, `voice`, and `notify`. `preset` is one of the old select values and defaults to `5`; present `minutes`/`early` values are decimal integer strings as written by the old HTML inputs, with `minutes` in [1, 1440] and `early` in [0, 60] and within the current slot's representable bound. Optional `voice`/`notify` are booleans and default to on/off respectively. No clamping or coercion is allowed. Legacy `version: 2` or any other unknown/malformed/unrepresentable value uses the read-only recovery path below; its bytes remain unchanged. This legacy chime version is distinct from unified envelope schema 2. A missing key supplies frozen chime defaults. Once schema-2 canonical data exists, it always wins and the legacy key is never reabsorbed. The legacy key is not deleted or cleaned up.
- A local bootstrap with no unified-v1 canonical completely ignores `natural-chime-settings`—it does not read, inspect, validate, or absorb the key—and uses frozen defaults.
- Importing a unified schema-1 file is a portable restore: it adds the frozen chime defaults rather than reading this browser's legacy chime key. It must go through impact preview, explicit confirmation, pre-import snapshot, revision/raw guard, one canonical commit, and exact write-after-read verification. Schema-2 import validates all sections strictly before preview and uses the same confirmed single-commit flow.
- Corrupt/unknown legacy chime data, including `version: 2`, encountered while upgrading an existing local unified-v1 canonical does not get repaired, defaulted, overwritten, or deleted automatically. Startup preserves canonical/legacy raw strings, displays validated intraday/risk data read-only, disables chime output/settings, and locks all writes until recovery is chosen. The single required message is: `旧版报时设置无法识别，报时已停用；原始存档与旧键均未修改。请恢复有效统一备份，或明确选择“忽略旧报时设置并使用默认值继续”。`
- Recovery offers the existing restore/export path and one explicit choice: `忽略旧报时设置并使用默认值继续`. After confirmation, the guarded V1→V2 migration uses frozen chime defaults; corrupt/unknown legacy bytes remain unchanged and are not imported. A portable unified-v1 file import uses its documented defaults and does not inspect the browser-local chime key. Any unrelated invalid unified/risk/intraday source remains under its existing fail-closed recovery rules.

## 12. Ground Truth and Acceptance Conditions

The implementation is acceptable only when tests and manual verification demonstrate all of the following:

- 0–5 enabled slots produce exactly 0–5 tags, no empty tag nodes, equal tag dimensions, no wrapping, and five equal columns when N=5.
- Each tag button has correct per-cycle state, dynamic title/aria-label, keyboard operation, visible focus, and contrast in light/dark/system appearances.
- Mixed enabled/unpaused/paused slot patterns match persisted flags, not a canned illustration.
- Global pause stops all actual outputs without rewriting slot flags; global restart resumes only enabled/unpaused slots.
- Individual pause/resume changes only that slot, persists immediately, survives reload/route/migration, and does not catch up.
- Two same-origin tabs never emit duplicate main, early, or preview output; hiding/pagehide releases the leader, an eligible visible/unlocked page may take over, and no-eligible-leader status is accurate. Leader and follower show the same canonical chime settings; follower setting writes use existing revision/conflict protection.
- Presets, custom periods, early offsets, event priority/deduplication, Asia/Shanghai boundaries, and exact-boundary behavior match deterministic Ground Truth vectors.
- Background/sleep missed events are skipped; restored page displays current Beijing time and schedules only the next future boundary.
- Audio unlock failure, unavailable speech, denied notification permission, unavailable Web Locks, malformed data, and storage/revision failure all produce visible safe states.
- Canonical unified schema 1→2 migration preserves intraday/risk/preferences by deep equality and adds one valid chime section; verified legacy chime V1 is absorbed only on that first local canonical migration and remains byte-for-byte unchanged. Legacy chime version 2 fails closed and requires the explicit recovery choice.
- Corrupt/unknown legacy chime produces the exact read-only recovery message and behavior; explicit ignore uses defaults without changing the old key. Unified-v1 file import uses defaults and the confirmed single-commit import flow; unified-v2 import strictly validates all sections.
- Unknown top-level/section versions, corrupt sources, full JSON import/export, and rollback preserve original data and fail closed.
- Existing risk data and outputs, intraday GC/CL/ES isolation, appearance, `#/home`/`#/risk` navigation, and click-scroll preservation do not regress.
- Current macOS Chrome and Safari manual acceptance passes; no claim is made for unsupported browsers or background delivery guarantees.

## 13. Implementation Gate

The user has explicitly authorized implementation within this Business Spec and its synchronized Architecture and Compatibility Specs. This does not authorize scope expansion, new runtime dependencies, commit, push, or deployment. Any conflict with the unified-v2 rules, any migration that cannot preserve the original data, or any need to change the business rules above returns to Chat/Human Decision Gate before proceeding.
