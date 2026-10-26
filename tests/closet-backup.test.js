import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createClosetBackup, parseClosetBackup, planClosetRestore, MAX_BACKUP_BYTES } from '../shared/closet-backup.js';
import { filterCloset } from '../shared/closet.js';
import { saveCloset, listCloset, setClosetRemoved, previewClosetRestore, restoreCloset } from '../closet-store.js';
const photo=new Blob([readFileSync(new URL('../icons/icon-192.png',import.meta.url))],{type:'image/png'});
const item=(id,extra={})=>({id,name:`衣物 ${id}`,kind:'knit',thickness:'regular',photo,createdAt:1,...extra});
const reset=()=>{globalThis.indexedDB=new IDBFactory();};

test('backup round trip preserves actual photo bytes and metadata, exporting only active clothes',async()=>{
  const text=await createClosetBackup([item('one'),item('removed',{removedAt:1})],new Date('2026-10-25T12:00Z'));
  const result=parseClosetBackup(text);
  assert.equal(result.items.length,1);assert.equal(result.exportedAt,'2026-10-25T12:00:00.000Z');
  assert.equal(result.items[0].name,'衣物 one');assert.equal(result.items[0].createdAt,1);
  assert.deepEqual(new Uint8Array(await result.items[0].photo.arrayBuffer()),new Uint8Array(await photo.arrayBuffer()));
  assert(!text.includes('blob:'));assert(!text.includes('removed'));
});
test('empty, oversized and invalid backup envelopes fail before restoration',async()=>{
  await assert.rejects(createClosetBackup([]),/没有可备份/);
  assert.throws(()=>parseClosetBackup('{'),/无法读取/);
  assert.throws(()=>parseClosetBackup('x'.repeat(MAX_BACKUP_BYTES+1)),/64 MB/);
  const backup=JSON.parse(await createClosetBackup([item('one')]));
  for(const mutation of [value=>value.version=2,value=>value.format='other',value=>value.items=[],value=>value.items=Array.from({length:101},()=>value.items[0])]){
    const value=structuredClone(backup);mutation(value);assert.throws(()=>parseClosetBackup(JSON.stringify(value)));
  }
});
test('restore rejects remote image URLs, SVG, invalid base64 and bad image signatures',async()=>{
  const backup=JSON.parse(await createClosetBackup([item('one')]));
  for(const bad of [{type:'image/jpeg',url:'https://example.com/photo.jpg'},{type:'image/svg+xml',data:btoa('<svg/>')},{type:'image/png',data:'!!!!'},{type:'image/png',data:btoa('not an image')},{type:'image/jpeg',data:'A'.repeat(Math.ceil(2*1024*1024/3)*4+4)}]){
    const copy=structuredClone(backup);copy.items[0].photo=bad;assert.throws(()=>parseClosetBackup(JSON.stringify(copy)),/照片/);
  }
});
test('photo payloads at the 2 MB boundary can be decoded without recursive validation',async()=>{
  const backup=JSON.parse(await createClosetBackup([item('one')]));
  const bytes=new Uint8Array(2*1024*1024);bytes.set([255,216,255]);
  backup.items[0].photo={type:'image/jpeg',data:Buffer.from(bytes).toString('base64')};
  assert.equal(parseClosetBackup(JSON.stringify(backup)).items[0].photo.size,2*1024*1024);
});
test('duplicate IDs and invalid metadata cannot produce a partial import',async()=>{
  const backup=JSON.parse(await createClosetBackup([item('one')]));
  for(const mutation of [value=>value.items.push(value.items[0]),value=>value.items[0].name=' ',value=>value.items[0].kind='__proto__',value=>value.items[0].id='../other',value=>value.items[0].createdAt=-1,value=>value.items[0].restoreOriginId='../other']){
    const value=structuredClone(backup);mutation(value);assert.throws(()=>parseClosetBackup(JSON.stringify(value)),/无效或重复/);
  }
});
test('unchanged backups skip duplicates while changed records become copies without overwriting',async()=>{
  const existing=[item('one',{name:'本机新名称'})],incoming=[item('one')];
  const plan=await planClosetRestore(existing,incoming,()=> 'restored-copy');
  assert.equal(plan.conflicts,1);assert.equal(plan.additions[0].id,'restored-copy');
  assert.equal(plan.additions[0].restoreOriginId,'one');assert.equal(existing[0].name,'本机新名称');
  const repeat=await planClosetRestore([...existing,...plan.additions],incoming);
  assert.equal(repeat.skipped,1);assert.equal(repeat.additions.length,0);
});
test('photo fingerprints distinguish same-size content and keep separate original IDs',async()=>{
  const bytes=new Uint8Array(await photo.arrayBuffer());bytes[bytes.length-1]^=1;
  const changed=item('one',{photo:new Blob([bytes],{type:'image/png'})});
  const plan=await planClosetRestore([item('one')],[changed],()=> 'copy');assert.equal(plan.conflicts,1);
  const twins=await planClosetRestore([],[item('one'),item('two',{name:'衣物 one'})]);
  assert.equal(twins.additions.length,2);
});
test('restoration is additive, reversible removals are explicitly reactivated, and repeat import is idempotent',async()=>{
  reset();await saveCloset(item('keep'));await saveCloset(item('old'));await setClosetRemoved('old',true);
  const review=await previewClosetRestore([item('old'),item('new')]);
  assert.equal(review.plan.reactivations.length,1);assert.equal(review.plan.additions.length,1);
  assert.equal((await listCloset()).filter(value=>!value.removedAt).length,1);
  const result=await restoreCloset(review);assert.equal(result.added,1);assert.equal(result.restored,1);
  const records=await listCloset();assert.equal(records.length,3);assert(records.find(value=>value.id==='keep'));
  const again=await restoreCloset(await previewClosetRestore([item('old'),item('new')]));assert.equal(again.added,0);assert.equal(again.skipped,2);
});
test('a changed closet invalidates a staged review and concurrent commits cannot duplicate an import',async()=>{
  reset();await saveCloset(item('one'));const review=await previewClosetRestore([item('new')]);
  await saveCloset(item('one',{name:'刚修改'}));await assert.rejects(restoreCloset(review),/刚有更新/);
  assert.equal((await listCloset()).length,1);
  const fresh=await previewClosetRestore([item('new')]);const outcomes=await Promise.allSettled([restoreCloset(fresh),restoreCloset(fresh)]);
  assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);assert.equal((await listCloset()).length,2);
});
test('capacity checks reject the entire restore without writing any prefix of it',async()=>{
  reset();await Promise.all(Array.from({length:100},(_,i)=>saveCloset(item(`item-${i}`))));
  const review=await previewClosetRestore([item('new-a'),item('new-b')]);assert.equal(review.plan.overflow,2);
  await assert.rejects(restoreCloset(review),/超过 100/);assert.equal((await listCloset()).length,100);
});
test('conflict lineage survives edits and subsequent backup export',async()=>{
  reset();await saveCloset(item('one',{name:'当前衣物'}));await restoreCloset(await previewClosetRestore([item('one')]));
  const restored=(await listCloset()).find(value=>value.id!=='one');assert.equal(restored.restoreOriginId,'one');
  await saveCloset({...restored,thickness:'warm'});
  const record=(await listCloset()).find(value=>value.id===restored.id);assert.equal(record.restoreOriginId,'one');
  const backup=parseClosetBackup(await createClosetBackup([record]));assert.equal(backup.items[0].restoreOriginId,'one');
});
test('search, category, thickness and recently removed filters compose without altering source records',()=>{
  const items=[item('one',{name:'蓝色 开衫',kind:'light-jacket',thickness:'light'}),item('two',{name:'蓝色开衫',removedAt:1}),item('three',{kind:'trousers'})];
  assert.deepEqual(filterCloset(items,{query:'蓝色 开衫',group:'outer',thickness:'light'}).map(value=>value.id),['one']);
  assert.deepEqual(filterCloset(items,{removed:true,query:'蓝色'}).map(value=>value.id),['two']);
  assert.equal(filterCloset(items,{group:'bottoms'}).length,1);assert.equal(filterCloset(items,{query:'不存在'}).length,0);
  assert.equal(items.length,3);assert.equal(items[1].removedAt,1);
});
test('an abort after the first queued write rolls back the entire restoration',async t=>{
  reset();await saveCloset(item('keep'));const review=await previewClosetRestore([item('new-a'),item('new-b')]);
  const original=IDBObjectStore.prototype.put;t.after(()=>{IDBObjectStore.prototype.put=original;});
  IDBObjectStore.prototype.put=function(value,...args){
    const request=Reflect.apply(original,this,[value,...args]);
    if(value.id==='new-a')request.onsuccess=()=>this.transaction.abort();
    return request;
  };
  await assert.rejects(restoreCloset(review),/未完成/);
  assert.deepEqual((await listCloset()).map(record=>record.id),['keep']);
});
