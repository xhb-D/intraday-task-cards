import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';

// Small, scoped ES-module linker; frozen M1 re-exports are resolved, never flattened.
export async function bundleV6() {
  const registry = [], seen = new Set();
  const imports = () => /^(?:import|export)\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"];\s*\n/gm;
  const names = source => [...source.matchAll(/^export\s+(?:const|function|class)\s+(\w+)/gm)].map(m => m[1]);
  async function visit(file) {
    if (seen.has(file) || file === 'src/model.js') return;
    if (!file.startsWith('src/intraday-v6/')) throw new Error('V6 dependency outside scope: ' + file);
    seen.add(file);
    const source = await readFile(file, 'utf8'), exported = names(source);
    for (const m of source.matchAll(imports())) {
      await visit(posix.normalize(posix.join(posix.dirname(file), m[2])));
      if (m[0].startsWith('export')) exported.push(...m[1].split(',').map(n => n.trim().split(/\s+as\s+/).at(-1)));
    }
    const bound = new Set();
    const body = source.replace(imports(), (statement, bindings, path) => {
      const selected = bindings.split(',').map(n => n.trim()).filter(n => {
        const local = n.split(/\s+as\s+/).at(-1);
        if (statement.startsWith('export') && bound.has(local)) return false;
        bound.add(local); return true;
      });
      return selected.length ? `const { ${selected.map(n => n.replace(/\s+as\s+/, ': ')).join(', ')} } = v6Modules[${JSON.stringify(posix.normalize(posix.join(posix.dirname(file), path)))}];\n` : '';
    }).replace(/^export\s+/gm, '');
    registry.push(`v6Modules[${JSON.stringify(file)}] = (() => {\n${body}\nreturn {${exported.join(',')}};\n})();`);
  }
  await visit('src/intraday-v6/index.js');
  const legacy = await readFile('src/model.js', 'utf8');
  return `const intradayV6 = (() => {\nconst v6Modules = {'src/model.js': {${names(legacy).join(',')}}};\n${registry.join('\n')}\nreturn v6Modules['src/intraday-v6/index.js'].intradayV6;\n})();\n`;
}
