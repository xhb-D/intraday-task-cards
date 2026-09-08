const declaration = /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)\b/;

// Source files deliberately use one bundle scope. Inspect only declarations
// that start at column zero: nested declarations are indented in this codebase
// and are not bundle-level names.
export function collectTopLevelSymbols(source, file = '<source>') {
  return String(source).split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(declaration);
    return match ? [{ name: match[1], file, line: index + 1 }] : [];
  });
}

export function assertNoDuplicateTopLevelSymbols(sources) {
  const seen = new Map();
  for (const { file, source } of sources) {
    for (const symbol of collectTopLevelSymbols(source, file)) {
      const prior = seen.get(symbol.name);
      if (prior) throw new Error(`重复顶层符号 ${symbol.name}: ${prior.file}:${prior.line} 与 ${symbol.file}:${symbol.line}`);
      seen.set(symbol.name, symbol);
    }
  }
  return seen;
}
