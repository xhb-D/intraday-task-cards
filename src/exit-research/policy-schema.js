export const EXECUTION_MODEL_VERSION = 'OHLC_STOP_NEXT_BAR_V1';
export const SETUP_STATE_SOURCES = Object.freeze(['MANUAL_ACTUAL', 'FIXED_INITIAL_SETUP', 'RESEARCH_TRANSITION_RULE']);
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && keys.length === Object.keys(v).length && keys.every(k => Object.hasOwn(v, k));
const text = v => typeof v === 'string' && v.trim().length > 0;
export function validateExitPolicy(policy) {
  const reasons = [];
  if (!exact(policy, ['policyId', 'policyVersion', 'setupClass', 'pairedPolicyId', 'classification', 'stages', 'allowProtectionLoosening', 'activationTiming', 'executionModelVersion']) ||
      !text(policy.policyId) || policy.policyVersion !== 1 || !['PB', 'BOF'].includes(policy.setupClass) || !text(policy.pairedPolicyId) ||
      policy.classification !== 'EXPERIMENTAL_BASELINE' || policy.allowProtectionLoosening !== false ||
      policy.activationTiming !== 'NEXT_BAR_AFTER_CONFIRMATION' || policy.executionModelVersion !== EXECUTION_MODEL_VERSION || !Array.isArray(policy.stages) || !policy.stages.length) {
    return { valid: false, qualityReasons: ['POLICY_SCHEMA_INVALID'] };
  }
  const names = new Set();
  policy.stages.forEach((s, i) => {
    if (!exact(s, ['name', 'activateAtMfeR', 'givebackPct', 'minimumLockR', 'forceExit', 'ceilingMode']) || !text(s.name) || names.has(s.name) ||
        !Number.isFinite(s.activateAtMfeR) || s.activateAtMfeR < 0 || (i === 0 ? s.activateAtMfeR !== 0 : s.activateAtMfeR <= policy.stages[i - 1]?.activateAtMfeR) ||
        (s.givebackPct !== null && (!Number.isFinite(s.givebackPct) || s.givebackPct <= 0 || s.givebackPct >= 1)) ||
        (s.minimumLockR !== null && (!Number.isFinite(s.minimumLockR) || s.minimumLockR < 0 || s.minimumLockR > s.activateAtMfeR)) ||
        typeof s.forceExit !== 'boolean' || !['NONE', 'SOFT', 'HARD'].includes(s.ceilingMode) || s.forceExit !== (s.ceilingMode === 'HARD') ||
        (s.ceilingMode !== 'NONE' && i !== policy.stages.length - 1) || (i === 0 && (s.givebackPct !== null || s.minimumLockR !== null || s.forceExit))) reasons.push('POLICY_STAGE_INVALID');
    names.add(s?.name);
  });
  return { valid: !reasons.length, qualityReasons: [...new Set(reasons)] };
}
export function stageAtMfe(policy, mfeR) {
  return policy.stages.filter(s => s.activateAtMfeR <= mfeR).at(-1);
}
