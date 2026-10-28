import { normalizeSizing } from './fit.js?v=20261028-studio1';
import { validClosetMetadata, MAX_CLOSET_ITEMS } from './closet.js?v=20261028-studio1';

export const BACKUP_FORMAT='weather-layer-closet';
export const MAX_BACKUP_BYTES=64*1024*1024;
const MAX_PHOTO_BYTES=2*1024*1024;
const allowedTypes=['image/jpeg','image/png','image/webp'];
const validTime=value=>Number.isSafeInteger(value)&&value>=0;
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(value);
export function validStoredPhoto(photo) {
  return photo instanceof Blob&&photo.size>0&&photo.size<=MAX_PHOTO_BYTES&&allowedTypes.includes(photo.type);
}
function imageSignature(bytes,type) {
  if(type==='image/jpeg')return bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(type==='image/png')return bytes.length>=8&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n);
  return bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
}
function encode(bytes) {
  let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  return btoa(binary);
}
function decode(photo) {
  if(!photo||!allowedTypes.includes(photo.type)||typeof photo.data!=='string'||photo.data.length>Math.ceil(MAX_PHOTO_BYTES/3)*4||!photo.data.length||photo.data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(photo.data))throw new Error('备份照片格式无效，不支持外部图片地址。');
  const bytes=Uint8Array.from(atob(photo.data),char=>char.charCodeAt(0));
  if(bytes.length>MAX_PHOTO_BYTES||!imageSignature(bytes,photo.type))throw new Error('备份中的照片内容无效，请重新导出备份。');
  return new Blob([bytes],{type:photo.type});
}
export async function createClosetBackup(items,now=new Date()) {
  const active=items.filter(item=>!item.removedAt);
  if(!active.length)throw new Error('当前没有可备份的在用衣物。');
  if(active.length>MAX_CLOSET_ITEMS||new Set(active.map(item=>item.id)).size!==active.length)throw new Error('备份衣物数量或编号无效。');
  if(active.reduce((size,item)=>size+Math.ceil((item.photo?.size??0)/3)*4+1024,0)>MAX_BACKUP_BYTES)throw new Error('备份超过 64 MB，请按分类或搜索结果分批备份。');
  const records=[];
  for(const item of active){
    if(!validClosetMetadata(item)||!validStoredPhoto(item.photo))throw new Error('部分衣物资料或照片无效，无法完整备份。');
    const bytes=new Uint8Array(await item.photo.arrayBuffer());
    if(!imageSignature(bytes,item.photo.type))throw new Error('部分照片无法读取，请重新导入这些照片后再备份。');
    records.push({id:item.id,name:item.name,kind:item.kind,thickness:item.thickness,sizing:normalizeSizing(item.sizing),
      ...(validId(item.restoreOriginId)?{restoreOriginId:item.restoreOriginId}:{}),
      createdAt:validTime(item.createdAt)?item.createdAt:now.getTime(),
      photo:{type:item.photo.type,data:encode(bytes)}});
  }
  const text=JSON.stringify({format:BACKUP_FORMAT,version:1,exportedAt:now.toISOString(),items:records});
  if(new Blob([text]).size>MAX_BACKUP_BYTES)throw new Error('备份超过 64 MB，请按分类分批备份。');
  return text;
}
export function parseClosetBackup(text) {
  if(typeof text!=='string'||text.length>MAX_BACKUP_BYTES)throw new Error('备份文件不能超过 64 MB。');
  let backup;try{backup=JSON.parse(text);}catch{throw new Error('无法读取备份，请选择「添一件」导出的 JSON 文件。');}
  if(backup?.format!==BACKUP_FORMAT||backup.version!==1)throw new Error('这不是当前支持的「添一件」衣橱备份。');
  if(!Array.isArray(backup.items)||backup.items.length<1||backup.items.length>MAX_CLOSET_ITEMS)throw new Error('每份备份需要包含 1–100 件衣物。');
  const ids=new Set();
  const items=backup.items.map(item=>{
    if(!validClosetMetadata(item)||ids.has(item.id)||(item.restoreOriginId!==undefined&&!validId(item.restoreOriginId))||!validTime(item.createdAt))throw new Error('备份包含无效或重复的衣物资料，没有恢复任何数据。');
    ids.add(item.id);
    return {id:item.id,name:item.name.trim(),kind:item.kind,thickness:item.thickness,sizing:normalizeSizing(item.sizing),
      ...(item.restoreOriginId?{restoreOriginId:item.restoreOriginId}:{}),createdAt:item.createdAt,photo:decode(item.photo)};
  });
  return {items,exportedAt:typeof backup.exportedAt==='string'&&Number.isFinite(Date.parse(backup.exportedAt))?backup.exportedAt:null};
}
export async function closetFingerprint(item) {
  if(!validClosetMetadata(item)||!validStoredPhoto(item.photo))throw new Error('衣物资料或照片无效，请重新检查备份。');
  const bytes=await item.photo.arrayBuffer();
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return JSON.stringify([item.name.trim(),item.kind,item.thickness,normalizeSizing(item.sizing),item.photo.type,Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('')]);
}
export function closetSnapshot(items) {
  return JSON.stringify(items.map(item=>[item.id,item.revision??'',item.name,item.kind,item.thickness,normalizeSizing(item.sizing),item.removedAt??null,item.updatedAt??null,item.photo?.size,item.photo?.type,item.restoreOriginId??'']).sort((a,b)=>a[0].localeCompare(b[0])));
}
export async function planClosetRestore(existing,incoming,idFactory=()=>crypto.randomUUID()) {
  if(!Array.isArray(incoming)||!incoming.length||incoming.length>MAX_CLOSET_ITEMS||new Set(incoming.map(item=>item.id)).size!==incoming.length)throw new Error('恢复衣物数量或编号无效。');
  const oldHashes=new Map();for(const item of existing)oldHashes.set(item.id,await closetFingerprint(item));
  const taken=new Set([...existing.map(item=>item.id),...incoming.map(item=>item.id)]),additions=[],reactivations=[],entries=[];
  let skipped=0,conflicts=0;
  for(const item of incoming){
    const fingerprint=await closetFingerprint(item),origin=item.restoreOriginId??item.id;
    const related=existing.filter(old=>old.id===item.id||old.restoreOriginId===origin||old.id===origin);
    const matches=related.filter(old=>oldHashes.get(old.id)===fingerprint);
    const same=matches.find(old=>old.id===item.id)??matches.find(old=>!old.removedAt)??matches[0];
    if(same){
      const restored=!!same.removedAt&&!reactivations.includes(same.id);
      if(restored)reactivations.push(same.id);else skipped++;
      entries.push({name:item.name,kind:item.kind,status:restored?'restored':'skipped'});continue;
    }
    let id=item.id;
    if(existing.some(old=>old.id===id)){
      conflicts++;let attempts=0;do{id=idFactory();if(++attempts>20||!validId(id))throw new Error('无法为恢复的衣物创建编号，请重试。');}while(taken.has(id));
    }
    taken.add(id);additions.push({...item,id,...(id!==item.id||item.restoreOriginId?{restoreOriginId:origin}:{})});
    entries.push({name:item.name,kind:item.kind,status:id===item.id?'added':'copy'});
  }
  const active=existing.filter(item=>!item.removedAt).length;
  return {additions,reactivations,entries,skipped,conflicts,total:incoming.length,activeAfter:active+additions.length+reactivations.length,
    overflow:Math.max(0,active+additions.length+reactivations.length-MAX_CLOSET_ITEMS)};
}
