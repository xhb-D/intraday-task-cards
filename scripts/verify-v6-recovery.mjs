// Read-only verification; never writes a browser store or modifies a supplied backup.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseBackupRaw, validateUnified } from '../src/capture-unified.js';
import { parseWorkbenchStore } from '../src/exit-research/ui/store.js';
const [unifiedPath,researchPath]=process.argv.slice(2);
if(!unifiedPath||!researchPath)throw new Error('Usage: node scripts/verify-v6-recovery.mjs Unified.json Exit_Research_Store_V1.json');
const [unifiedRaw,researchRaw]=await Promise.all([readFile(unifiedPath,'utf8'),readFile(researchPath,'utf8')]);
const unified=parseBackupRaw(unifiedRaw);validateUnified(unified);const research=parseWorkbenchStore(researchRaw);
console.log(JSON.stringify({status:'PASS',readOnly:true,unified:{sha256:createHash('sha256').update(unifiedRaw).digest('hex'),schemaVersion:unified.schemaVersion,intradaySchemaVersion:unified.sections.intraday.state.schemaVersion,records:unified.sections.intraday.state.records.length,ended:unified.sections.intraday.state.records.filter(r=>r.endedAt!==null).length,manualEvents:unified.sections.intraday.state.records.reduce((n,r)=>n+r.researchCapture.manualEvents.length,0)},research:{sha256:createHash('sha256').update(researchRaw).digest('hex'),manualDecisions:research.manualDecisions.length,tradeOverrides:Object.keys(research.settings.tradeOverrides).length,setupFilter:research.preferences.setup}},null,2));
