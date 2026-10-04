import { researchSetupClass, derivedManagementState } from './model.js';

// UI research reference only; never persisted on an opportunity or record.
export const HOLDING_REFERENCE_V1 = Object.freeze({
  version: 1,
  PB: Object.freeze({ minR: 6, maxR: 10 }),
  BOF: Object.freeze({ minR: 3, maxR: 6 })
});

export function managementReferenceFor(opportunity, status) {
  if (!opportunity || !['wait', 'signal', 'position'].includes(status)) return null;
  const management = status === 'position' ? derivedManagementState(opportunity) : researchSetupClass(opportunity.type);
  if (!management) return null;
  const range = ({ minR, maxR }) => `${minR}–${maxR}R`;
  return {
    label: status === 'position' ? '当前管理' : '计划管理',
    management,
    pbRange: range(HOLDING_REFERENCE_V1.PB),
    bofRange: range(HOLDING_REFERENCE_V1.BOF)
  };
}

export function renderHoldingReference(opportunity, status) {
  const reference = managementReferenceFor(opportunity, status);
  if (!reference) return '';
  return `<section class="holding-reference" aria-label="持仓参考"><div class="holding-reference-heading"><span>持仓参考</span><span>${reference.label}：<strong>${reference.management}</strong></span></div><div>PB 重点区间：<strong>${reference.pbRange}</strong></div><div>BOF 参考区间：<strong>${reference.bofRange}</strong></div></section>`;
}
