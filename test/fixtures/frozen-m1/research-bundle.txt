import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
const exportedNames = source => [...source.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
const namedImports = () => /^import\s+\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"];\s*\n/gm;
// Preserve actual ES module scopes: frozen engine helpers intentionally share names.
// Existing production modules retain their original classic-bundle scope and guard.
export async function bundleResearchUi(entry = 'src/exit-research/ui/controller.js') {
  const ordered = [], seen = new Set(), visiting = new Set();
  async function visit(file) {
    if(file==='src/model.js'||seen.has(file))return;
    if(!file.startsWith('src/exit-research/'))throw new Error('RESEARCH_BUNDLE_DEPENDENCY_OUT_OF_SCOPE: '+file);
    if(visiting.has(file))throw new Error('RESEARCH_BUNDLE_CYCLE: '+file);
    visiting.add(file);const source=await readFile(file,'utf8');
    for(const m of source.matchAll(namedImports()))await visit(posix.normalize(posix.join(posix.dirname(file),m[2])));
    visiting.delete(file);seen.add(file);ordered.push({file,source});
  }
  await visit(entry);
  const model=await readFile('src/model.js','utf8');
  const modules=ordered.map(({file,source})=>{
    const body=source.replace(namedImports(),(_,names,path)=>{
      const key=posix.normalize(posix.join(posix.dirname(file),path));
      const bindings=names.split(',').map(n=>n.trim().replace(/\s+as\s+/,': ')).filter(Boolean).join(', ');
      return `const { ${bindings} } = erModuleRegistry[${JSON.stringify(key)}];\n`;
    }).replace(/^export\s+/gm,'');
    if(/^import\s/m.test(body))throw new Error('RESEARCH_BUNDLE_IMPORT_UNSUPPORTED: '+file);
    return `erModuleRegistry[${JSON.stringify(file)}] = (() => {\n${body}\nreturn {${exportedNames(source).join(', ')}};\n})();`;
  });
  return `const __exitResearchModules = (() => {\nconst erModuleRegistry = {'src/model.js': {${exportedNames(model).join(', ')}}};\n${modules.join('\n')}\nreturn erModuleRegistry;\n})();\nconst { initExitResearchWorkbench } = __exitResearchModules[${JSON.stringify(entry)}];\n`;
}
