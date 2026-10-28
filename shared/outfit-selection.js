// A saved outfit records garment IDs, never photos or a frozen weather forecast.
import { closetCandidates, garmentSlot } from './closet.js?v=20261028-studio1';
import { validDate } from './dates.js';

export const OUTFIT_STORAGE_KEY='weather-layer-outfits-v1';
export const MAX_SAVED_OUTFITS=30;
export const selectionKey=scope=>JSON.stringify([scope.cityKey,scope.date,scope.period]);
export function outfitSignature(garments,sensitivity,profileRevision=null) {
  return JSON.stringify([sensitivity,...['wear','carry'].map(section=>garments[section].map(item=>[garmentSlot(section,item),item.label])),...(profileRevision?[{profileRevision}]:[])]);
}
export const chosenItems=garments=>Object.fromEntries([...garments.wear,...garments.carry].map(item=>[item.slot,item.owned?.id??null]));
export function sameChoices(a,b) {
  return Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([slot,id])=>b[slot]===id);
}
export function validateSavedSelection(entry,garments,items,signature,profile=null) {
  if(!entry)return {ok:false,reason:''};
  if(entry.signature!==signature)return {ok:false,reason:'天气、体感或穿衣档案已变化，原先记住的搭配需要重新确认。'};
  const slots=['wear','carry'].flatMap(section=>garments[section].map(item=>({...item,slot:garmentSlot(section,item)})));
  if(slots.length!==Object.keys(entry.choices).length)return {ok:false,reason:'建议单品已变化，请重新确认搭配。'};
  const used=[];
  for(const garment of slots){
    const id=entry.choices[garment.slot],candidates=closetCandidates(garment,items,{exclude:used,profile});
    if(id===null&&!candidates.length)continue;
    if(!id||!candidates.some(item=>item.id===id))return {ok:false,reason:'衣橱已变化：有单品被移除、分类改变或新增了可用衣物，请重新确认搭配。'};
    used.push(id);
  }
  return {ok:true,reason:''};
}
function validEntry(entry) {
  return entry&&typeof entry.cityKey==='string'&&entry.cityKey.length>0&&entry.cityKey.length<=200&&validDate(entry.date)&&
    ['all','morning','daytime','evening'].includes(entry.period)&&typeof entry.signature==='string'&&entry.signature.length<=3000&&
    Number.isFinite(entry.savedAt)&&entry.savedAt>0&&entry.choices&&typeof entry.choices==='object'&&!Array.isArray(entry.choices)&&
    Object.keys(entry.choices).length>0&&Object.keys(entry.choices).length<=16&&
    Object.entries(entry.choices).every(([key,id])=>/^(wear|carry):[a-z-]{1,30}$/.test(key)&&(id===null||typeof id==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(id)));
}
export function readSavedOutfits(storage) {
  const text=storage.getItem(OUTFIT_STORAGE_KEY);
  if(text===null)return [];
  let data;
  try{if(text.length>150000)throw new Error();data=JSON.parse(text);}catch{throw new Error('本机搭配记录无法读取，原记录未改动。天气与衣橱仍可使用。');}
  if(data?.version!==1||!Array.isArray(data.entries)||data.entries.length>MAX_SAVED_OUTFITS||!data.entries.every(validEntry)||new Set(data.entries.map(selectionKey)).size!==data.entries.length)throw new Error('本机搭配记录格式不受支持，原记录未改动。');
  return data.entries;
}
export function saveOutfit(storage,entry) {
  if(!validEntry(entry))throw new Error('搭配信息不完整，没有保存。');
  const entries=readSavedOutfits(storage).filter(item=>selectionKey(item)!==selectionKey(entry));
  entries.unshift(entry);
  // Preserve only explicitly listed fields; photos and other preferences never enter this key.
  storage.setItem(OUTFIT_STORAGE_KEY,JSON.stringify({version:1,entries:entries.slice(0,MAX_SAVED_OUTFITS).map(({cityKey,date,period,signature,choices,savedAt})=>({cityKey,date,period,signature,choices,savedAt}))}));
}
export function forgetOutfit(storage,scope) {
  const entries=readSavedOutfits(storage).filter(item=>selectionKey(item)!==selectionKey(scope));
  storage.setItem(OUTFIT_STORAGE_KEY,JSON.stringify({version:1,entries}));
}
