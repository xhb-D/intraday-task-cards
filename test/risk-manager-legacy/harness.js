export function createSuite(title) {
  const results = [];
  return { title, results,
    test(name, fn) { try { fn(); results.push({ suite: title, name, pass: true }); } catch (err) { results.push({ suite: title, name, pass: false, error: String(err?.message || err) }); } },
    assert(condition, message) { if (!condition) throw new Error(message || 'assertion failed'); },
    assertEq(actual, expected, message, tolerance = 1e-6) { if (typeof actual === 'number' && typeof expected === 'number') { if (Math.abs(actual - expected) > tolerance) throw new Error(`${message || 'eq'}: expected ${expected}, got ${actual}`); } else if (actual !== expected) throw new Error(`${message || 'eq'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
  };
}
