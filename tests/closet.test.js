import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { matchCloset, validClosetMetadata, MAX_CLOSET_ITEMS } from '../shared/closet.js';
import { listCloset, saveCloset, setClosetRemoved, deleteClosetPermanently } from '../closet-store.js';
import { wardrobe } from '../visuals.js';
import { outfit } from '../shared/weather.js';
import { sunAdvice } from '../shared/briefing.js';
import { preparePhoto } from '../closet.js';
const item=(id,kind,thickness='regular')=>({id,name:`我的 ${id}`,kind,thickness,photo:new Blob(['photo'],{type:'image/jpeg'})});
const garments=feels=>wardrobe({advice:outfit(feels),rain:0,high:25},sunAdvice(2));

test('weather-compatible owned clothes are chosen and absent pieces remain explicit suggestions',()=>{
  const result=matchCloset(garments(8),[item('knit-1','knit'),item('coat-1','coat','warm')],{date:'2026-10-23'});
  assert.deepEqual(result.wear.map(value=>value.owned?.id??null),['knit-1','coat-1',null]);
  assert.equal(result.ownedCount,2);assert.equal(result.missingCount,1);
  assert(result.wear.every(value=>value.label));
});
test('a complete warm closet never replaces a required light layer or lightweight trousers',()=>{
  const result=matchCloset(garments(20),[item('thick','coat','warm'),item('pants','trousers','warm'),item('shirt','tshirt','warm')]);
  assert.equal(result.ownedCount,0);
  const cold=matchCloset(garments(0),[item('pants','trousers','light'),item('thick','coat','warm')]);
  assert.equal(cold.wear[1].owned.id,'thick');assert.equal(cold.wear[2].owned,null);
});
test('the existing alternatives permit thin long sleeves and light long trousers',()=>{
  const result=matchCloset(garments(20),[item('long','longsleeve','light')]);
  assert.equal(result.wear[0].owned.id,'long');
  const hot=matchCloset(garments(27),[item('pants','trousers','light')]);
  assert.equal(hot.wear[1].owned.id,'pants');
});
test('daily selections are stable; swap chooses an available alternative and never a removed item',()=>{
  const clothes=[item('a','knit'),item('b','knit'),{...item('c','knit'),removedAt:1}];
  const a=matchCloset(garments(8),clothes,{date:'2026-10-23'}),b=matchCloset(garments(8),clothes,{date:'2026-10-23',variation:1});
  assert(a.alternatives);assert.notEqual(a.wear[0].owned.id,b.wear[0].owned.id);
  assert.deepEqual(matchCloset(garments(8),clothes,{date:'2026-10-23'}),a);
  assert.notEqual(a.wear[0].owned.id,'c');assert.notEqual(b.wear[0].owned.id,'c');
});
test('invalid metadata is ignored, and missing clothing still allows daily sun accessories',()=>{
  assert(!validClosetMetadata(item('../unsafe','coat')));
  assert(!validClosetMetadata({...item('x','coat'),name:' '}));
  const empty=wardrobe({advice:outfit(null),rain:60},sunAdvice(5));
  const result=matchCloset(empty,[item('hat','hat','light'),item('umbrella','umbrella')]);
  assert.equal(result.wear.length,0);assert.equal(result.carry.filter(value=>value.owned).length,2);
});
test('IndexedDB preserves photo Blobs and edits, with reversible removal and restore',async()=>{
  globalThis.indexedDB=new IDBFactory();
  await saveCloset(item('one','knit'));
  await saveCloset({...item('one','knit'),name:'米色针织开衫'});
  let records=await listCloset();assert.equal(records.length,1);assert.equal(records[0].name,'米色针织开衫');
  assert.equal(await records[0].photo.text(),'photo');
  await setClosetRemoved('one',true);records=await listCloset();assert(records[0].removedAt);
  assert.equal(matchCloset(garments(8),records).ownedCount,0);
  await setClosetRemoved('one',false);assert.equal((await listCloset())[0].removedAt,null);
});
test('storage errors never report successful saves and invalid image payloads are rejected',async()=>{
  globalThis.indexedDB=undefined;
  await assert.rejects(listCloset(),/无法使用/);
  await assert.rejects(saveCloset({...item('one','knit'),photo:new Blob(['<svg/>'],{type:'image/svg+xml'})}),/照片无效/);
  globalThis.indexedDB=new IDBFactory();
  await assert.rejects(setClosetRemoved('nonexistent',true),/没有找到/);
  assert.equal((await listCloset()).length,0);
});
test('concurrent imports respect the active-item limit; removal creates room and restore checks capacity',async()=>{
  globalThis.indexedDB=new IDBFactory();
  await Promise.all(Array.from({length:MAX_CLOSET_ITEMS},(_,i)=>saveCloset(item(`item-${i}`,'knit'))));
  await assert.rejects(saveCloset(item('overflow','knit')),/最多保存/);
  await setClosetRemoved('item-0',true);await saveCloset(item('new','knit'));
  await assert.rejects(setClosetRemoved('item-0',false),/衣橱已满/);
  assert.equal((await listCloset()).filter(value=>!value.removedAt).length,MAX_CLOSET_ITEMS);
});
test('permanent deletion requires prior removal and removes the stored photo record',async()=>{
  globalThis.indexedDB=new IDBFactory();await saveCloset(item('one','knit'));
  await assert.rejects(deleteClosetPermanently('one'),/先移除/);
  await setClosetRemoved('one',true);await deleteClosetPermanently('one');
  assert.equal((await listCloset()).length,0);
});
test('photo import rejects unsupported formats and large files before decoding or storage',async()=>{
  await assert.rejects(preparePhoto({type:'image/svg+xml',size:200}),/请选择 JPG/);
  await assert.rejects(preparePhoto({type:'image/jpeg',size:13*1024*1024}),/12 MB/);
});
