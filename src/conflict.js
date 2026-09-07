export const EXTERNAL_CONFLICT_MESSAGE = '其他页面修改了存档；当前页面已锁定为只读。请先导出 JSON 或 Markdown 备份，再刷新读取最新状态。';

// A fresh document is the only way out of this mode. Keeping the policy pure makes
// the persistence and UI guards testable without conflating it with storage failures.
export function externalConflictPolicy(locked) {
  return Object.freeze({
    locked: Boolean(locked),
    allowMutation: !locked,
    allowPersist: !locked,
    cardsInert: Boolean(locked),
    historyInert: Boolean(locked),
    disableDangerousDataActions: Boolean(locked),
    hideRetry: Boolean(locked),
    exportsAvailable: true,
    message: locked ? EXTERNAL_CONFLICT_MESSAGE : ''
  });
}
