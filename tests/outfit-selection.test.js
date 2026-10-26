import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCloset,closetCandidates} from '../shared/closet.js';
import {selectionKey,outfitSignature,chosenItems,validateSavedSelection,readSavedOutfits,saveOutfit,forgetOutfit,OUTFIT_STORAGE_KEY,MAX_SAVED_OUTFITS} from '../shared/outfit-selection.js';
import {wardrobe} from '../visuals.js';
import {outfit} from '../shared/weather.js';
import {sunAdvice} from '../shared/briefing.js';
const clothes=[{id:'shirt-a',name:'第一件',kind:'tshirt',thickness:'light'},{id:'shirt-b',name:'第二件',kind:'longsleeve',thickness:'light'},{id:'outer',name:'薄外套',kind:'light-jacket',thickness:'light'},{id:'pants',name:'轻薄裤子',kind:'trousers',thickness:'light'}];
const garments=wardrobe({advice:outfit(20),rain:60,high:25},sunAdvice(3));
const scope={cityKey:'30.27,120.15@Asia/Shanghai',date:'2026-10-25',period:'all'};
const signature=outfitSignature(garments,'normal');
const entry=()=>({...scope,signature,choices:chosenItems(matchCloset(garments,clothes,{date:scope.date})),savedAt:123});
function storage(){const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};}

test('one garment can change without changing other clothing or daily accessories',()=>{
  const initial=matchCloset(garments,clothes,{date:scope.date}),choices=chosenItems(initial);
  const nextId=initial.wear[0].candidates.find(item=>item.id!==initial.wear[0].owned.id).id;
  const next=matchCloset(garments,clothes,{date:scope.date,choices:{...choices,'wear:tshirt':nextId}});
  assert.equal(next.wear[0].owned.id,nextId);
  assert.deepEqual(next.wear.slice(1),initial.wear.slice(1));assert.deepEqual(next.carry,initial.carry);
});
test('manual IDs cannot bypass original thickness rules, removed items, or duplicate an item',()=>{
  const wrong={id:'wrong',name:'厚外套',kind:'coat',thickness:'warm'},removed={...clothes[0],removedAt:1};
  assert(!closetCandidates(garments.wear[1],[wrong]).length);
  assert(!closetCandidates(garments.wear[0],[removed]).length);
  const result=matchCloset(garments,[...clothes,wrong],{choices:{'wear:light-jacket':'wrong','wear:trousers':'shirt-a'}});
  assert.equal(result.wear[1].owned.id,'outer');assert.equal(result.wear[2].owned.id,'pants');
  const double=matchCloset({wear:[garments.wear[0]],carry:[garments.wear[0]]},[clothes[0]],{choices:{'wear:tshirt':'shirt-a','carry:tshirt':'shirt-a'}});
  assert.equal(double.carry[0].owned,null);
});
test('selection scopes separate cities, IANA zones, dates including new year, and periods',()=>{
  const values=[scope,{...scope,cityKey:'39,116@Asia/Shanghai'},{...scope,cityKey:'30.27,120.15@UTC'},{...scope,date:'2027-01-01'},{...scope,period:'morning'}];
  assert.equal(new Set(values.map(selectionKey)).size,values.length);
  const s=storage();values.forEach(value=>saveOutfit(s,{...entry(),...value}));assert.equal(readSavedOutfits(s).length,5);
});
test('saved outfits remain valid across temperature updates within the same original rule, not across rule or sensitivity changes',()=>{
  const saved=entry();assert(validateSavedSelection(saved,garments,clothes,signature).ok);
  const similar=wardrobe({advice:outfit(21),rain:80,high:25},sunAdvice(5));
  assert.equal(outfitSignature(similar,'normal'),signature);
  const different=wardrobe({advice:outfit(10),rain:0,high:20},sunAdvice(2));
  assert(!validateSavedSelection(saved,different,clothes,outfitSignature(different,'normal')).ok);
  assert(!validateSavedSelection(saved,garments,clothes,outfitSignature(garments,'cold')).ok);
});
test('removed, reclassified or newly available saved placeholders require confirmation; rename does not',()=>{
  const saved=entry();
  assert(!validateSavedSelection(saved,garments,clothes.map(item=>item.id==='outer'?{...item,removedAt:1}:item),signature).ok);
  assert(!validateSavedSelection(saved,garments,clothes.map(item=>item.id==='outer'?{...item,thickness:'warm'}:item),signature).ok);
  assert(!validateSavedSelection(saved,garments,[...clothes,{id:'hat',name:'新帽子',kind:'hat',thickness:'light'}],signature).ok);
  assert(validateSavedSelection(saved,garments,clothes.map(item=>({...item,name:'重新命名'})),signature).ok);
  assert(!validateSavedSelection({...saved,choices:{...saved.choices,'wear:madeup':'pants'}},garments,clothes,signature).ok);
});
test('local saving replaces only the current scope and retains a bounded set of 30 recent confirmations',()=>{
  const s=storage();s.setItem('weather-layer-v1','existing preference');
  for(let i=0;i<MAX_SAVED_OUTFITS+1;i++)saveOutfit(s,{...entry(),cityKey:`city-${i}`,savedAt:i+1});
  assert.equal(readSavedOutfits(s).length,MAX_SAVED_OUTFITS);assert(!readSavedOutfits(s).some(item=>item.cityKey==='city-0'));
  saveOutfit(s,{...entry(),cityKey:'city-1',savedAt:200});assert.equal(readSavedOutfits(s)[0].savedAt,200);
  assert.equal(readSavedOutfits(s).length,MAX_SAVED_OUTFITS);assert.equal(s.getItem('weather-layer-v1'),'existing preference');
});
test('stored schema omits photos and unrelated data; forgetting one scope preserves others and preferences',()=>{
  const s=storage();saveOutfit(s,{...entry(),photo:'secret photo bytes',token:'not needed'});saveOutfit(s,{...entry(),period:'morning'});
  assert(!s.getItem(OUTFIT_STORAGE_KEY).includes('photo'));assert(!s.getItem(OUTFIT_STORAGE_KEY).includes('token'));
  forgetOutfit(s,scope);assert.equal(readSavedOutfits(s).length,1);assert.equal(readSavedOutfits(s)[0].period,'morning');
});
test('corrupt, duplicate, unsupported or oversized local records are not silently overwritten',()=>{
  for(const raw of ['bad json',JSON.stringify({version:2,entries:[]}),JSON.stringify({version:1,entries:[entry(),entry()]}),'x'.repeat(150001),JSON.stringify({version:1,entries:[{...entry(),date:'2026-02-30'}]})]){
    const s=storage();s.setItem(OUTFIT_STORAGE_KEY,raw);assert.throws(()=>readSavedOutfits(s));assert.throws(()=>saveOutfit(s,entry()));assert.equal(s.getItem(OUTFIT_STORAGE_KEY),raw);
  }
});
test('write denial propagates without pretending that a confirmation was saved',()=>{
  const s=storage();saveOutfit(s,entry());const before=s.getItem(OUTFIT_STORAGE_KEY);s.setItem=()=>{throw new DOMException('quota','QuotaExceededError');};
  assert.throws(()=>saveOutfit(s,{...entry(),period:'morning'}));assert.throws(()=>forgetOutfit(s,scope));assert.equal(s.getItem(OUTFIT_STORAGE_KEY),before);
});
