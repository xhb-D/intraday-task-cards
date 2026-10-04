import { EXECUTION_MODEL_VERSION } from './policy-schema.js';
function policy(setupClass, variant) {
  const thresholds = setupClass === 'PB' ? [0, 2, 6, 8, 10] : [0, 2, 4, 6, 8];
  const names = setupClass === 'PB' ? ['INITIAL', 'RUNNER', 'PROTECT', 'EXTREME', 'SOFT_CEILING'] : ['INITIAL', 'RUNNER', 'TARGET_REVIEW', 'EXTREME', 'SOFT_CEILING'];
  const givebacks = variant === 'TIGHT_GIVEBACK' ? [null, null, .25, .20, .15] : [null, null, .30, .25, .20];
  if (variant === 'HARD_CEILING') names[4] = 'HARD_CEILING';
  const stages = thresholds.map((activateAtMfeR, i) => Object.freeze({ name: names[i], activateAtMfeR, givebackPct: givebacks[i], minimumLockR: null,
    forceExit: i === 4 && variant === 'HARD_CEILING', ceilingMode: i === 4 ? (variant === 'HARD_CEILING' ? 'HARD' : 'SOFT') : 'NONE' }));
  return Object.freeze({ policyId: `${setupClass}_${variant}_V1`, policyVersion: 1, setupClass, pairedPolicyId: `${setupClass === 'PB' ? 'BOF' : 'PB'}_${variant}_V1`,
    classification: 'EXPERIMENTAL_BASELINE', stages: Object.freeze(stages), allowProtectionLoosening: false,
    activationTiming: 'NEXT_BAR_AFTER_CONFIRMATION', executionModelVersion: EXECUTION_MODEL_VERSION });
}
export const POLICIES_V1 = Object.freeze(Object.fromEntries(['BASELINE', 'TIGHT_GIVEBACK', 'HARD_CEILING'].flatMap(variant => ['PB', 'BOF'].map(setup => {
  const p = policy(setup, variant); return [p.policyId, p];
}))));
