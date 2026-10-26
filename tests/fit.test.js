import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {normalizeProfile,readProfile,writeProfile,PROFILE_KEY,normalizeSizing,fitAssessment} from '../shared/fit.js';
import {matchCloset,filterCloset} from '../shared/closet.js';
import {outfitSignature,validateSavedSelection,chosenItems} from '../shared/outfit-selection.js';
import {createClosetBackup,parseClosetBackup,closetFingerprint,closetSnapshot,planClosetRestore} from '../shared/closet-backup.js';
import {saveCloset,listCloset} from '../closet-store.js';
import {readFileSync} from 'node:fs';
const storage=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};};
const profile=normalizeProfile({height:170,weight:65,chest:94,waist:78,hips:96,preference:'relaxed'});
const photo=new Blob([readFileSync(new URL('../icons/icon-192.png',import.meta.url))],{type:'image/png'});
const item=(id,sizing)=>({id,name:`衣物 ${id}`,kind:'coat',thickness:'warm',photo,sizing});
const garments={wear:[{asset:'coat',label:'厚外套',role:'外层'}],carry:[]};
const range={height:{min:160,max:180},weight:{min:55,max:75},chest:{min:90,max:100}};

test('optional body data stays optional, canonical, and never infers missing measurements from height or weight',()=>{
  const result=normalizeProfile({height:170,weight:65,gender:'not needed',bmi:'not needed'});
  assert.equal(result.chest,null);assert.equal(result.waist,null);assert.equal(result.hips,null);assert(!Object.hasOwn(result,'gender'));assert(!Object.hasOwn(result,'bmi'));
  assert.equal(normalizeProfile({}).height,null);
  for(const input of [{height:0},{weight:-1},{chest:NaN},{weight:Infinity},{height:'170'},{preference:'slim-down'}])assert.throws(()=>normalizeProfile(input));
});
test('profile read/write has an isolated versioned key; unchanged saves keep revision and changes invalidate it',()=>{
  const s=storage();s.setItem('weather-layer-v1','weather');writeProfile(s,profile,()=> 'rev-1');
  assert.equal(readProfile(s).revision,'rev-1');writeProfile(s,profile,()=> 'should-not-change');assert.equal(readProfile(s).revision,'rev-1');
  writeProfile(s,{...profile,weight:66},()=> 'rev-2');assert.equal(readProfile(s).revision,'rev-2');assert.equal(s.getItem('weather-layer-v1'),'weather');
  writeProfile(s,{});assert.equal(readProfile(s),null);
});
test('invalid records and denied writes are visible and do not overwrite an existing profile',()=>{
  const s=storage();for(const raw of ['bad',JSON.stringify({version:2}),JSON.stringify({version:1,revision:'bad id'}),'x'.repeat(4001)]){
    s.setItem(PROFILE_KEY,raw);assert.throws(()=>readProfile(s));assert.throws(()=>writeProfile(s,profile));assert.equal(s.getItem(PROFILE_KEY),raw);
  }
  s.removeItem(PROFILE_KEY);writeProfile(s,profile,()=> 'rev-1');const before=s.getItem(PROFILE_KEY);s.setItem=()=>{throw new Error('denied');};assert.throws(()=>writeProfile(s,{...profile,weight:66}));assert.equal(s.getItem(PROFILE_KEY),before);
});
test('clothing ranges validate both units and ordering, remain optional, and canonicalize key order',()=>{
  assert.equal(normalizeSizing().fit,'unknown');assert.deepEqual(normalizeSizing({ranges:{weight:range.weight,height:range.height}}).ranges,{height:range.height,weight:range.weight});
  for(const sizing of [{fit:'fake'},{label:'x'.repeat(25)},{ranges:{height:{min:180,max:160}}},{ranges:{weight:{min:'55'}}},{ranges:{bmi:{min:20,max:30}}},{ranges:[]},{ranges:{chest:{max:Infinity}}}])assert.throws(()=>normalizeSizing(sizing));
});
test('height and weight compare only against the actual garment body range; boundaries are inclusive',()=>{
  const coat=item('a',{ranges:range});
  assert(fitAssessment(coat,{...profile,height:160,weight:55}).eligible);assert(fitAssessment(coat,{...profile,height:180,weight:75}).eligible);
  assert(!fitAssessment(coat,{...profile,height:180.1}).eligible);assert(!fitAssessment(coat,{...profile,weight:54.9}).eligible);
  assert.deepEqual(fitAssessment(coat,profile).matched,['height','weight','chest']);
});
test('one-sided ranges work and missing body values never become zero or a fabricated match',()=>{
  const coat=item('a',{ranges:{height:{min:170},weight:{max:65},chest:{min:90,max:100}}});
  const result=fitAssessment(coat,normalizeProfile({height:170,weight:65}));assert(result.eligible);assert.deepEqual(result.missing,['chest']);assert(!result.matched.includes('chest'));assert.match(result.reason,/尚未核对/);
  const unknown=fitAssessment(item('old'),profile);assert(unknown.eligible);assert.equal(unknown.label,'尺码待确认');
});
test('body ranges apply to the right garment type and do not filter sun or rain supplies',()=>{
  const pants={...item('p',{ranges:{chest:{min:120},waist:{min:75,max:80},hips:{min:95,max:100}}}),kind:'trousers'};
  assert(fitAssessment(pants,profile).eligible);assert.deepEqual(fitAssessment(pants,profile).matched,['waist','hips']);
  assert(fitAssessment({...pants,kind:'umbrella',sizing:{fit:'tight',ranges:{height:{max:160}}}},profile).eligible);
});
test('manual comfort and preference improve ranking; tight or out-of-range clothes cannot be auto selected',()=>{
  const values=[item('unknown'),item('comfortable',{fit:'regular'}),item('preferred',{fit:'relaxed',ranges:range}),item('tight',{fit:'tight'}),item('small',{ranges:{height:{max:160}}})];
  const matched=matchCloset(garments,values,{date:'2026-10-25',profile});assert.equal(matched.wear[0].owned.id,'preferred');
  assert.equal(matched.wear[0].candidates.length,3);assert(!matched.wear[0].candidates.some(x=>['tight','small'].includes(x.id)));
  assert.equal(matchCloset(garments,values,{profile,choices:{'wear:coat':'tight'}}).wear[0].owned.id,'preferred');
  assert.equal(filterCloset(values,{hideUnfit:true,profile}).length,3);assert.equal(filterCloset(values).length,5);
});
test('fit preference never overrides existing clothing temperature requirements',()=>{
  const thin={...item('thin',{fit:'relaxed',ranges:range}),kind:'light-jacket',thickness:'light'};
  const result=matchCloset(garments,[thin,item('cold',{fit:'regular',ranges:range})],{profile});assert.equal(result.wear[0].owned.id,'cold');
  assert.equal(matchCloset(garments,[thin],{profile}).wear[0].owned,null);
});
test('profile revision, not raw body data, participates in saved outfit validation',()=>{
  const old=outfitSignature(garments,'normal'),signed=outfitSignature(garments,'normal','revision-a');assert.notEqual(signed,old);assert(!signed.includes('170'));assert(!signed.includes('65'));
  const values=[item('a',{ranges:range})],choices=chosenItems(matchCloset(garments,values,{profile})),entry={signature:signed,choices};
  assert(validateSavedSelection(entry,garments,values,signed,profile).ok);assert(!validateSavedSelection(entry,garments,values,outfitSignature(garments,'normal','revision-b'),profile).ok);
  assert(!validateSavedSelection(entry,garments,values,signed,{...profile,height:190}).ok);
});
test('IndexedDB updates retain photo bytes, sizing, and existing clothes; invalid sizing fails before writing',async()=>{
  globalThis.indexedDB=new IDBFactory();await saveCloset(item('old'));await saveCloset(item('measured',{label:'M',fit:'relaxed',ranges:range}));
  const records=await listCloset();assert.equal(records.length,2);assert.equal(records[1].sizing.label,'');
  const measured=records.find(x=>x.id==='measured');assert.deepEqual(measured.sizing.ranges,range);assert.equal(measured.photo.size,photo.size);
  await assert.rejects(saveCloset(item('bad',{ranges:{height:{min:190,max:160}}})));assert.equal((await listCloset()).length,2);
});
test('backup round trip preserves garment fit details, accepts old version-one files and never includes personal body data',async()=>{
  const source=item('measured',{label:'M',fit:'relaxed',ranges:range}),raw=await createClosetBackup([source]),parsed=parseClosetBackup(raw);
  assert.deepEqual(parsed.items[0].sizing,source.sizing);assert(!raw.includes('profile'));assert(!raw.includes('revision'));
  const old=JSON.parse(raw);delete old.items[0].sizing;assert.equal(parseClosetBackup(JSON.stringify(old)).items[0].sizing.fit,'unknown');
  old.items[0].sizing={ranges:{height:{min:190,max:160}}};assert.throws(()=>parseClosetBackup(JSON.stringify(old)));
});
test('backup fingerprint, stale preview detection and conflict merging include fit metadata',async()=>{
  const a=item('a',{label:'M',ranges:range}),b={...a,sizing:{...a.sizing,fit:'tight'}};
  assert.notEqual(await closetFingerprint(a),await closetFingerprint(b));assert.notEqual(closetSnapshot([a]),closetSnapshot([b]));
  const result=await planClosetRestore([a],[b],()=> 'copy');assert.equal(result.conflicts,1);assert.equal(result.additions[0].sizing.fit,'tight');
  assert.equal(await closetFingerprint(item('empty')),await closetFingerprint(item('empty',{label:'',fit:'unknown',ranges:{}})));
});
