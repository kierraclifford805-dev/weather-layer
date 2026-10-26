import { normalizeSizing } from './shared/fit.js?v=20261025-fit4';
import { validClosetMetadata, MAX_CLOSET_ITEMS } from './shared/closet.js?v=20261025-fit4';
import { closetSnapshot, planClosetRestore } from './shared/closet-backup.js?v=20261025-fit4';
const DATABASE='weather-layer-closet-v1',STORE='clothes';
async function database() {
  if(!globalThis.indexedDB)throw new Error('此浏览器无法使用本机衣橱存储，请在普通浏览模式重试。');
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('衣橱存储正在被其他页面使用，请关闭旧页面再试。'));
  });
}
async function transaction(mode,action) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode);let result,error;
    tx.oncomplete=()=>{db.close();resolve(result);};
    tx.onabort=()=>{db.close();reject(error||tx.error||new Error('衣橱保存未完成，请重试。'));};
    tx.onerror=()=>{};
    try {action(tx.objectStore(STORE),value=>{result=value;},reason=>{error=reason;tx.abort();});}
    catch(reason){error=reason;tx.abort();}
  });
}
export function listCloset() {
  return transaction('readonly',(store,done)=>{
    const request=store.getAll();request.onsuccess=()=>done(request.result.filter(item=>validClosetMetadata(item)&&item.photo instanceof Blob));
  });
}
export function saveCloset(item) {
  if(!validClosetMetadata(item)||!(item.photo instanceof Blob)||item.photo.size>2*1024*1024||!['image/jpeg','image/png','image/webp'].includes(item.photo.type))return Promise.reject(new Error('衣物资料或照片无效，请重新选择。'));
  return transaction('readwrite',(store,done,fail)=>{
    const request=store.getAll();request.onsuccess=()=>{
      const existing=request.result.find(value=>value.id===item.id);
      if(!existing&&request.result.filter(value=>!value.removedAt).length>=MAX_CLOSET_ITEMS){fail(new Error(`衣橱最多保存 ${MAX_CLOSET_ITEMS} 件，请先移除一些衣物。`));return;}
      const record={id:item.id,name:item.name.trim(),kind:item.kind,thickness:item.thickness,sizing:normalizeSizing(item.sizing),photo:item.photo,
        createdAt:existing?.createdAt??Date.now(),updatedAt:Date.now(),removedAt:existing?.removedAt??null,
        revision:crypto.randomUUID(),...(existing?.restoreOriginId?{restoreOriginId:existing.restoreOriginId}:{})};
      store.put(record);done(record);
    };
  });
}
export function setClosetRemoved(id,removed) {
  return transaction('readwrite',(store,done,fail)=>{
    const request=store.getAll();request.onsuccess=()=>{
      const records=request.result,item=records.find(record=>record.id===id);
      if(!item){fail(new Error('没有找到这件衣物，请重新打开衣橱。'));return;}
      if(!removed&&item.removedAt&&records.filter(record=>!record.removedAt).length>=MAX_CLOSET_ITEMS){fail(new Error('衣橱已满，请先移除一些衣物再恢复。'));return;}
      const record={...item,removedAt:removed?Date.now():null,updatedAt:Date.now(),revision:crypto.randomUUID()};store.put(record);done(record);
    };
  });
}
export function deleteClosetPermanently(id) {
  return transaction('readwrite',(store,done,fail)=>{
    const request=store.get(id);request.onsuccess=()=>{
      if(!request.result?.removedAt){fail(new Error('请先移除衣物，再从最近移除中永久删除。'));return;}
      store.delete(id);done(true);
    };
  });
}
export async function previewClosetRestore(items) {
  const existing=await listCloset(),plan=await planClosetRestore(existing,items);
  return {items,plan,snapshot:closetSnapshot(existing)};
}
export async function restoreCloset(review) {
  const existing=await listCloset();
  if(closetSnapshot(existing)!==review.snapshot)throw new Error('衣橱刚有更新，请重新检查备份后再恢复。');
  const plan=await planClosetRestore(existing,review.items);
  if(plan.overflow)throw new Error(`恢复后会超过 100 件上限，请先移除至少 ${plan.overflow} 件衣物。`);
  return transaction('readwrite',(store,done,fail)=>{
    const request=store.getAll();request.onsuccess=()=>{
      if(closetSnapshot(request.result)!==review.snapshot){fail(new Error('衣橱刚有更新，请重新检查备份后再恢复。'));return;}
      const now=Date.now();
      for(const item of plan.additions)store.put({...item,removedAt:null,updatedAt:now,revision:crypto.randomUUID()});
      for(const id of plan.reactivations){const item=request.result.find(record=>record.id===id);store.put({...item,removedAt:null,updatedAt:now,revision:crypto.randomUUID()});}
      done({added:plan.additions.length,restored:plan.reactivations.length,skipped:plan.skipped,conflicts:plan.conflicts});
    };
  });
}
