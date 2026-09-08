// Trading Risk Manager V1 — tiny shared helpers (ids, money formatting/parsing).

/** Generate a stable unique id for accounts/sessions/events. */
export function uid(prefix) {
  const rnd =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix || 'id'}_${rnd}`;
}

/** Format a dollar amount with thousands separators, e.g. 51400 -> "$51,400". */
export function fmtUSD(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Format a signed delta, e.g. 220 -> "+$220.00". */
export function fmtDelta(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '-';
  return `${sign}${fmtUSD(Math.abs(n))}`;
}

/**
 * Parse a user-entered money string into a positive finite number.
 * Accepts "51,400", "51400.5", "$51,400", "51 400".
 * Returns null when the input is not a valid positive amount.
 */
export function parseMoney(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Current UTC+8 reference line for the header (informational only). */
export function futuresDayReference() {
  return '期货交易日参考：UTC+8 04:30 结束 / 05:00 开始';
}

/**
 * Front-end re-entry guard for one-shot actions (e.g. global rollover commit).
 * Prevents double clicks / rapid repeat clicks from triggering the action
 * twice. No backend locking — this is a single-page local app.
 */
export function createReentryGuard() {
  let locked = false;
  return {
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
    get locked() {
      return locked;
    },
  };
}

/** Display-layer label for a drawdown type. Internal enum values never change. */
export function drawdownTypeLabel(type) {
  const map = {
    EOD_TRAILING: 'EOD 日终跟踪回撤',
    INTRADAY_TRAILING: '盘中实时跟踪回撤',
    STATIC: '静态回撤',
    NONE: '无外部回撤限制',
  };
  return map[type] || type;
}
