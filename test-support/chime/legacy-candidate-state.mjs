// Offline staging transactions only. Service must be unregistered/stopped before invoking.
import { lstat, readFile, writeFile, mkdir, cp, rename, rm, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function verifyCandidate(app, manifest) {
  const appStat=await lstat(app);if(!appStat.isDirectory()||appStat.isSymbolicLink())throw Error('App directory symlink refused');
  const m=JSON.parse(await readFile(manifest,'utf8'));
  if(m.protocolVersion!==2||m.bundleIdentifier!=='com.xhbd.ChimeHelper'||!m.appFilesSHA256)throw Error('Incompatible manifest; preserve snapshot and require reapply');
  const paths=Object.keys(m.appFilesSHA256);if(paths.length===0)throw Error('Empty candidate manifest');
  for(const rel of paths)if(rel.split('/').some(p=>p==='..'||p==='.'||p==='')||rel.startsWith('/')||!/^[a-f0-9]{64}$/.test(m.appFilesSHA256[rel]))throw Error('Invalid manifest path/hash');
  const expected=new Set(paths);
  async function walk(dir,prefix=''){for(const e of await readdir(dir,{withFileTypes:true})){const rel=prefix+e.name;if(e.isSymbolicLink())throw Error('Candidate symlink refused');if(e.isDirectory())await walk(join(dir,e.name),rel+'/');else if(!expected.delete(rel))throw Error('Unmanifested candidate file: '+rel)}}
  await walk(app);if(expected.size)throw Error('Missing candidate file');
  for(const [rel,h]of Object.entries(m.appFilesSHA256)){if(rel.split('/').includes('..')||rel.startsWith('/'))throw Error('Invalid manifest path');if(sha(await readFile(join(app,rel)))!==h)throw Error('Candidate hash mismatch: '+rel)}
  return m;
}
async function safeRoot(root){root=resolve(root);const stat=await lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Staging directory required');const marker=await lstat(join(root,'.chime-phase4-staging'));if(marker.isSymbolicLink())throw Error('Symlink staging marker refused');
  try{const state=await lstat(join(root,'phase4-staging-state'));if(state.isSymbolicLink())throw Error('Symlink state refused')}catch(e){if(e.code!=='ENOENT')throw e}
  if((await readFile(join(root,'.chime-phase4-staging'),'utf8')).trim()!=='com.xhbd.ChimeHelper')throw Error('Staging marker required');return root}
export async function replaceCandidate({root,incoming,manifest,assertStopped=async()=>{throw Error('Service stop verification required')}}){root=await safeRoot(root);await assertStopped();await verifyCandidate(incoming,manifest);const app=join(root,'ChimeHelper.app'),previous=join(root,'ChimeHelper.previous.app'),temp=join(root,'.ChimeHelper.next.app');try{await lstat(previous);throw Error('Previous rollback candidate exists; retain it')}catch(e){if(e.code!=='ENOENT')throw e}await cp(incoming,temp,{recursive:true,errorOnExist:true,force:false});await verifyCandidate(temp,manifest);await rename(app,previous);try{await rename(temp,app)}catch(e){await rename(previous,app);throw e}return 'REPLACED_SNAPSHOT_RETAINED';}
export async function rollbackCandidate({root,manifest,assertStopped=async()=>{throw Error('Service stop verification required')}}){root=await safeRoot(root);await assertStopped();const app=join(root,'ChimeHelper.app'),prev=join(root,'ChimeHelper.previous.app'),failed=join(root,'ChimeHelper.failed.app');await verifyCandidate(prev,manifest);try{await lstat(failed);throw Error('Failed candidate already retained')}catch(e){if(e.code!=='ENOENT')throw e}await rename(app,failed);try{await rename(prev,app)}catch(e){await rename(failed,app);throw e}return 'ROLLED_BACK_SNAPSHOT_RETAINED';}
export async function uninstallCandidate({root,retainSnapshot=true,assertStopped=async()=>{throw Error('Service stop verification required')}}){root=await safeRoot(root);await assertStopped();const state=join(root,'phase4-staging-state');for(const p of ['ChimeHelper.app','ChimeHelper.previous.app','ChimeHelper.failed.app'])await rm(join(root,p),{recursive:true,force:true});await rm(join(state,'logs'),{recursive:true,force:true});if(!retainSnapshot)await rm(state,{recursive:true,force:true});return retainSnapshot?'UNINSTALLED_SNAPSHOT_RETAINED':'UNINSTALLED_STATE_REMOVED';}
// No CLI destructive entry point. Tests and supervised host flows supply positive service-stop evidence.
