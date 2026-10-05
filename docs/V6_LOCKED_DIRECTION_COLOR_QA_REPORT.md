# V6 locked direction: cascade verification

Candidate base: `264a6ba28f702b4d3c0bbd4d6ba0934a05333fab`.
The user confirmed the failed screenshot came from GitHub Pages production.

## Cause and release boundary

Read-only remote inspection found production main still at
`f76131ed370797beb385860eb3977cecb8d925fd`. The remote hotfix branch was at
`5a472604a5afc9d11e2ed59b55e3e47c53ecb297`; the candidate cache commit was local only.
The public production index still referenced `appearance.css?v=v6-setup-hotfix-20261005`.

Downloaded production CSS contains this winning rule:

```css
.capture-card .direction-field .readonly[data-tone] {
  background: var(--bg-surface);
  border-color: var(--border-secondary);
  color: var(--text-tertiary);
}
```

Its specificity (0,4,0) exceeds the earlier semantic readonly rules (0,3,0).
This explains gray long/short in both opportunity and holding contexts.
The candidate already replaces it with semantic color/tint and tone-specific variables.
No additional production CSS, renderer, data, or business change was necessary.
The retained candidate resource version is `v6-locked-direction-hotfix-20261005`.

CSS SHA-256:

- Downloaded production: `be6d8f536e48941dcb81df933c74aa8396219cc57afa72160146bb6a3fb71c89`.
- Candidate: `2ade23cec3440b353e8fc02d17d7d4897894148037c13214bd1209e102e0a2de`.

## Actual browser gates

`scripts/qa-v6-locked-direction.mjs` creates synthetic pages from the current renderer
and all seven stylesheets in index order, preserving their resource query versions.
It does not load the production app, browser storage, or real user records.
Its in-page tests use actual `getComputedStyle` after the browser applies the full cascade.

Generate local pages with:

```bash
node scripts/qa-v6-locked-direction.mjs /private/tmp/v6-locked-direction-cascade-qa
```

Serve on loopback and open `light.html` / `dark.html` in an isolated browser tab.
Each page must display `COMPUTED STYLE PASS: 4/4`.
The generated baseline pages using downloaded old production CSS failed with
`DIRECTION_SEMANTIC_COLOR_LOST` in both themes, reproducing the reported symptom.
The candidate passed all eight theme/direction/context cases:

| Theme | Direction | Opportunity locked | Following holdings | Final text / border |
| --- | --- | --- | --- | --- |
| light | long | PASS | PASS | `rgb(24, 122, 65)` / `#187a41` |
| light | short | PASS | PASS | `rgb(197, 52, 69)` / `#c53445` |
| dark | long | PASS | PASS | `rgb(108, 239, 166)` / `#6cefa6` |
| dark | short | PASS | PASS | `rgb(255, 104, 121)` / `#ff6879` |

Each case checks exact direction-token text and border colors, rejects neutral text,
requires a tinted background, verifies opacity=1 and filter=none through all ancestors,
and verifies no editable direction buttons. Readonly/locked behavior is preserved.
Baseline final colors were light `rgb(134,134,139)` and dark `rgb(107,122,148)`.

Four cropped screenshots and full computed-style evidence are saved outside the repo:
`/Users/hongchujun/Documents/日内交易/V6-Locked-Direction-Cascade-QA/`.
Files: `light-locked-long.jpg`, `light-locked-short.jpg`, `dark-locked-long.jpg`,
`dark-locked-short.jpg`, `computed-style-evidence.json`.

## Automated regression and scope

Four new Node contract tests exercise the same validator used by the browser pages;
they explicitly reject neutral color, neutral border, missing tint, ancestor opacity,
filter dimming, and editable locked direction. These contract tests are distinct from
the eight actual browser computed-style checks above.

- `npm test`: 828/828 PASS, 0 skipped.
- `npm run build`: PASS.
- `node --check dist/app.bundle.js`: PASS.
- `git diff --check`: PASS.
- Candidate production source, CSS, index, and bundle remain byte-identical to `264a6ba…`.
- Bundle SHA-256 remains `f37c488944b144fad5f5e3415a0f5986b9bc181a956108ad385cb39f914a012e`.

Only QA script, contract tests, and this report are added in this verification commit.
No bias/structure colors, schema, records, persistence, migration, or business logic changed.
No push, merge, deployment, production browser storage access, or real-data migration performed.
Candidate verified locally; production remains on the old CSS pending release authorization.
