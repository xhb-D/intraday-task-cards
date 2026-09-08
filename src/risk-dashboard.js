import { mountRiskManager } from './risk-manager-view.js';

// The homepage is a compact mount of the exact same controller used by #/risk.
export function initRiskDashboard(host, controller = {}) {
  return mountRiskManager(host, controller, { compact: true });
}
