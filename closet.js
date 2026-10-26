import { BODY_FIELDS, normalizeSizing, sizingSummary, fitAssessment, bodyFieldsForKind } from './shared/fit.js?v=20261025-fit4';
import { getBodyProfile } from './body-profile.js?v=20261025-fit4';
import { openDialog } from './dialogs.js?v=20261025-fit4';
import { escapeHTML as esc } from './shared/weather.js';
import { CLOSET_KINDS, CLOSET_GROUPS, THICKNESS, closetKind, filterCloset } from './shared/closet.js?v=20261025-fit4';
import { listCloset, saveCloset, setClosetRemoved, deleteClosetPermanently, previewClosetRestore, restoreCloset } from './closet-store.js?v=20261025-fit4';
import { createClosetBackup, parseClosetBackup, MAX_BACKUP_BYTES } from './shared/closet-backup.js?v=20261025-fit4';

const $=id=>document.getElementById(id);
let records=[],photoURLs=new Map(),available=false,busy=false,queue=[],draft=null,showRemoved=false,importVersion=0;
let restoreReview=null;
export const getCloset=()=>({items:records.filter(item=>!item.removedAt),available});
export const closetPhoto=id=>photoURLs.get(id);
let channel=null;
function message(text,error=false){$('closet-message').textContent=text;$('closet-message').hidden=!text;$('closet-message').dataset.error=String(error);}
function errorMessage(error){return error?.name==='QuotaExceededError'?'浏览器存储空间不足，照片还没有保存。请释放空间后重试。':error?.message||'衣橱操作没有完成，请重试。';}
const filters=()=>({query:$('closet-search').value,group:$('closet-group').value,thickness:$('closet-weight-filter').value,hideUnfit:$('closet-fit-only').checked,profile:getBodyProfile().profile});
function syncBackupActions(){
  const count=filterCloset(records,filters()).length;
  $('closet-export').disabled=busy||!available||!count;
  $('closet-export').textContent=`备份${hasFilters()?'筛选的':'全部'} ${count} 件衣物`;
  $('closet-backup-scope').textContent=`本次备份包含 ${count} 件在用衣物及其照片，不包含最近移除。`;
  $('closet-import-backup').disabled=busy||!available;
  $('closet-restore-confirm').disabled=busy||!restoreReview||restoreReview.plan.overflow>0;
  $('closet-restore-recheck').disabled=busy||!restoreReview;
  $('closet-restore-cancel').disabled=busy;
}
function setBusy(value){
  busy=value;$('closet-form').setAttribute('aria-busy',String(value));$('closet-restore-panel').setAttribute('aria-busy',String(value));
  $('closet-save').disabled=value;$('closet-add').disabled=value||!available;$('closet-cancel').disabled=value;
  ['closet-search','closet-group','closet-weight-filter','closet-filter-active','closet-filter-removed','closet-clear-filters','closet-fit-only'].forEach(id=>{$(id).disabled=value;});
  syncBackupActions();
}
function hasFilters(){const {query,group,thickness,hideUnfit}=filters();return !!query.trim()||group!=='all'||thickness!=='all'||hideUnfit;}
function clearFilters(){$('closet-search').value='';$('closet-group').value='all';$('closet-weight-filter').value='all';$('closet-fit-only').checked=false;}
function broadcast(){document.dispatchEvent(new CustomEvent('closet-updated'));}
async function refresh({throwOnError=false}={}){
  try{
    const next=await listCloset();
    photoURLs.forEach(url=>URL.revokeObjectURL(url));photoURLs=new Map(next.map(item=>[item.id,URL.createObjectURL(item.photo)]));
    records=next;available=true;renderLibrary();broadcast();return true;
  }catch(error){available=false;$('closet-add').disabled=true;syncBackupActions();message(errorMessage(error),true);broadcast();if(throwOnError)throw error;return false;}
}
function renderLibrary(){
  const active=records.filter(item=>!item.removedAt),removed=records.filter(item=>item.removedAt);
  $('closet-count').textContent=`${active.length} 件衣物 · 保存在本机`;
  $('closet-add').disabled=busy||!available;
  $('closet-filter-active').setAttribute('aria-pressed',String(!showRemoved));$('closet-filter-removed').setAttribute('aria-pressed',String(showRemoved));
  $('closet-filter-removed').textContent=`最近移除 (${removed.length})`;
  const visible=filterCloset(records,{...filters(),removed:showRemoved}).sort((a,b)=>b.updatedAt-a.updatedAt);
  $('closet-result-count').textContent=`显示 ${visible.length} / ${showRemoved?removed.length:active.length} 件${showRemoved?'已移除衣物':'在用衣物'}`;
  $('closet-clear-filters').hidden=!hasFilters();syncBackupActions();
  $('closet-grid').innerHTML=visible.length?visible.map(item=>`<article class="closet-item"><img src="${closetPhoto(item.id)}" alt="${esc(item.name)}" width="240" height="260" loading="lazy"><div><h3>${esc(item.name)}</h3><p>${closetKind(item.kind).label} · ${THICKNESS[item.thickness]}</p><p class="closet-sizing-label">${esc(sizingSummary(item)||'尺码待补充')}</p>${bodyFieldsForKind(item.kind).length?`<small class="fit-badge" data-fit="${fitAssessment(item,getBodyProfile().profile).eligible?(fitAssessment(item,getBodyProfile().profile).label==='尺码待确认'?'unknown':'eligible'):'review'}">${esc(fitAssessment(item,getBodyProfile().profile).label)}</small>`:''}<div class="closet-item-actions">${showRemoved?`<button type="button" data-restore-clothes="${item.id}" aria-label="恢复 ${esc(item.name)}">恢复</button><button type="button" data-delete-clothes="${item.id}" aria-label="永久删除 ${esc(item.name)}">永久删除</button>`:`<button type="button" data-edit-clothes="${item.id}" aria-label="编辑 ${esc(item.name)}">尺码／编辑</button><button type="button" data-remove-clothes="${item.id}" aria-label="移除 ${esc(item.name)}">移除</button>`}</div></div></article>`).join(''):`<div class="closet-empty"><img src="./assets/clothes/light-jacket.svg" alt="" width="100" height="95"><h3>${hasFilters()?'没有符合筛选的衣物':showRemoved?'这里没有已移除的衣物':'先从常穿的几件开始'}</h3><p>${hasFilters()?'试试其他名称或分类，也可以清除筛选查看全部。':showRemoved?'移除的衣物会留在这里，可以恢复。':'拍一张或选一张照片，确认类型和厚薄。再回到天气页，让它们组成今天的搭配。'}</p></div>`;
}
export async function preparePhoto(file){
  if(!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type))throw new Error('请选择 JPG、PNG、WebP 或 AVIF 照片；HEIC 请先转为 JPG。');
  if(file.size>12*1024*1024)throw new Error('单张照片请小于 12 MB。');
  const url=URL.createObjectURL(file),image=new Image();
  try{
    image.src=url;await image.decode();
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40_000_000)throw new Error('照片尺寸过大或无法读取，请换一张照片。');
    const scale=Math.min(1,960/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('此浏览器暂时无法处理照片。');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const photo=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));
    if(!photo||photo.size>2*1024*1024)throw new Error('照片处理失败，请换一张较小的照片。');
    return photo;
  }catch(error){
    if(error.name==='EncodingError')throw new Error('无法读取这张照片，请转为 JPG 或换一张照片后重试。');
    throw error;
  }finally{URL.revokeObjectURL(url);}
}
function clearDraft(){
  if(draft?.preview)URL.revokeObjectURL(draft.preview);
  draft=null;restoreReview=null;$('closet-form').hidden=true;$('closet-restore-panel').hidden=true;$('closet-library').hidden=false;
  $('closet-input').value='';$('closet-backup-input').value='';$('closet-dialog').scrollTop=0;
}
async function verifyBackupPhoto(photo){
  const url=URL.createObjectURL(photo),image=new Image();let timeout;
  try{
    image.src=url;
    await Promise.race([image.decode(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('备份照片读取超时，请重新导出后再试。')),12000);})]);
    if(!image.naturalWidth||!image.naturalHeight||Math.max(image.naturalWidth,image.naturalHeight)>960)throw new Error('备份照片尺寸无效，请选择本工具导出的原始备份。');
  }catch(error){if(error.name==='EncodingError')throw new Error('备份中有无法读取的照片，没有恢复任何数据。');throw error;}
  finally{clearTimeout(timeout);URL.revokeObjectURL(url);}
}
async function showRestore(items,fileName,exportedAt,version){
  const review=await previewClosetRestore(items);
  if(version!==importVersion||!$('closet-dialog').open)return;
  clearDraft();restoreReview={...review,fileName,exportedAt};
  $('closet-library').hidden=true;$('closet-restore-panel').hidden=false;
  const {plan}=review;
  $('closet-restore-file').textContent=`${fileName} · ${exportedAt?new Date(exportedAt).toLocaleString('zh-CN'):'导出日期信息暂缺'}`;
  $('closet-restore-counts').textContent=`新增 ${plan.additions.length} 件（含冲突副本 ${plan.conflicts} 件） · 重新启用 ${plan.reactivations.length} 件 · 跳过相同衣物 ${plan.skipped} 件。恢复后共 ${plan.activeAfter} 件在用衣物。`;
  const actions={added:'新增',copy:'保留原件，加入副本',restored:'从最近移除恢复',skipped:'已存在，跳过'};
  $('closet-restore-items').innerHTML=plan.entries.map(item=>`<li><div><strong>${esc(item.name)}</strong><small>${closetKind(item.kind).label}</small></div><span>${actions[item.status]}</span></li>`).join('');
  $('closet-restore-confirm').textContent=plan.additions.length+plan.reactivations.length?'确认合并恢复':'完成（全部已存在）';
  message(plan.overflow?`会超过 100 件上限，请先移除至少 ${plan.overflow} 件，再重新检查备份。`:'检查完成，确认后才会写入衣橱。',!!plan.overflow);
  $('closet-restore-title').focus({preventScroll:true});syncBackupActions();
}
function edit(item,isNew=false){
  clearDraft();draft={...item,isNew,preview:URL.createObjectURL(item.photo)};
  $('closet-editor-photo').src=draft.preview;
  $('closet-editor-title').textContent=isNew?'把这件衣物放进衣橱':'编辑这件衣物';
  $('closet-import-progress').textContent=isNew?`待确认 ${queue.length+1} 件 · 每张照片单独标注`:'修改后，穿搭推荐会同步更新';
  $('closet-name').value=item.name;$('closet-kind').value=item.kind??'';$('closet-thickness').value=item.thickness??'regular';
  const sizing=normalizeSizing(item.sizing);$('closet-size-label').value=sizing.label;$('closet-wear-fit').value=sizing.fit;
  for(const key of Object.keys(BODY_FIELDS))for(const bound of ['min','max'])$(`closet-range-${key}-${bound}`).value=sizing.ranges[key]?.[bound]??'';
  $('closet-sizing-panel').open=false;$('closet-ranges-panel').open=false;syncSizingFields();
  $('closet-save').textContent=isNew&&queue.length?'保存并继续':'保存到衣橱';
  $('closet-library').hidden=true;$('closet-form').hidden=false;$('closet-editor-title').tabIndex=-1;$('closet-editor-title').focus({preventScroll:true});
}
async function nextPhoto(){
  if(!queue.length){clearDraft();$('closet-add').focus();return;}
  const file=queue.shift(),version=importVersion;setBusy(true);message('正在本机整理照片…');
  try{
    const photo=await preparePhoto(file);
    if(version!==importVersion||!$('closet-dialog').open)return;
    edit({id:crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/,'').slice(0,40),photo},true);
    message('请确认衣物类型和厚薄，再保存。照片不会上传服务器。');
  }catch(error){if(version===importVersion){message(`${file.name}：${errorMessage(error)}`,true);queue=[];}}
  finally{if(version===importVersion)setBusy(false);}
}
function syncSizingFields(){
  const relevant=bodyFieldsForKind($('closet-kind').value);
  $('closet-sizing-panel').hidden=!relevant.length;
  document.querySelectorAll('[data-size-range]').forEach(node=>{node.hidden=!relevant.includes(node.dataset.sizeRange);node.querySelectorAll('input').forEach(input=>input.disabled=node.hidden);});
}
function readSizing(){
  const ranges={};
  for(const key of bodyFieldsForKind($('closet-kind').value)){
    const min=$(`closet-range-${key}-min`),max=$(`closet-range-${key}-max`);
    if(min.value!==''||max.value!=='')ranges[key]={min:min.value===''?null:min.valueAsNumber,max:max.value===''?null:max.valueAsNumber};
  }
  return normalizeSizing({label:$('closet-size-label').value,fit:bodyFieldsForKind($('closet-kind').value).length?$('closet-wear-fit').value:'unknown',ranges});
}
export function setupCloset(){
  $('closet-size-ranges').innerHTML=Object.entries(BODY_FIELDS).map(([key,field])=>`<fieldset class="size-range-row" data-size-range="${key}"><legend>${field.label} <small>${field.unit}</small></legend>${['min','max'].map((bound,i)=>`<div><label for="closet-range-${key}-${bound}">${i?'上限':'下限'}</label><input id="closet-range-${key}-${bound}" type="number" inputmode="decimal" step="0.1" min="${field.min}" max="${field.max}" placeholder="可留空"></div>`).join('')}</fieldset>`).join('');
  document.addEventListener('body-profile-updated',renderLibrary);
  $('closet-fit-only').addEventListener('change',renderLibrary);
  if(typeof window.BroadcastChannel==='function')channel=new window.BroadcastChannel('weather-layer-closet-v1');
  $('closet-kind').innerHTML='<option value="">请选择衣物类型</option>'+CLOSET_KINDS.map(kind=>`<option value="${kind.id}">${kind.label}</option>`).join('');
  $('closet-group').innerHTML=Object.entries(CLOSET_GROUPS).map(([id,label])=>`<option value="${id}">${label}</option>`).join('');
  document.querySelectorAll('[data-open-closet]').forEach(button=>button.addEventListener('click',()=>{
    $('closet-filter-panel').open=window.matchMedia('(min-width:601px)').matches||hasFilters();
    openDialog($('closet-dialog'),$('closet-add'));refresh();
  }));
  $('closet-dialog').addEventListener('close',()=>{importVersion++;queue=[];clearDraft();setBusy(false);message('');});
  $('closet-add').addEventListener('click',()=>{if(!busy&&available)$('closet-input').click();});
  $('closet-input').addEventListener('change',()=>{
    const files=[...$('closet-input').files];if(!files.length)return;
    if(files.length>12){message('一次最多导入 12 张照片，请分批添加。',true);$('closet-input').value='';return;}
    importVersion++;queue=files;nextPhoto();
  });
  $('closet-kind').addEventListener('change',()=>{const kind=closetKind($('closet-kind').value);if(kind)$('closet-thickness').value=kind.thickness;syncSizingFields();});
  $('closet-cancel').addEventListener('click',()=>{importVersion++;queue=[];clearDraft();message('本次未保存的照片已取消；已保存的衣物仍在衣橱里。');$('closet-add').focus();});
  $('closet-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!draft)return;const version=importVersion;setBusy(true);message('正在保存到本机…');
    try{
      const isNew=draft.isNew,savedItem=await saveCloset({...draft,name:$('closet-name').value.trim(),kind:$('closet-kind').value,thickness:$('closet-thickness').value,sizing:readSizing()});
      await refresh({throwOnError:true});channel?.postMessage('changed');if(version!==importVersion)return;
      clearDraft();if(isNew){showRemoved=false;clearFilters();renderLibrary();}
      message(!isNew&&!filterCloset([savedItem],filters()).length?'已保存；这件衣物不符合当前筛选，可清除筛选查看。':'已保存到本机，天气页的搭配已更新。');
      if(queue.length){setBusy(false);await nextPhoto();return;}
      setBusy(false);$('closet-add').focus({preventScroll:true});
    }catch(error){if(version===importVersion)message(errorMessage(error),true);}
    finally{if(version===importVersion)setBusy(false);}
  });
  $('closet-grid').addEventListener('click',async event=>{
    if(busy)return;
    const deleteButton=event.target.closest('[data-delete-clothes]');
    if(deleteButton){
      const item=records.find(item=>item.id===deleteButton.dataset.deleteClothes);
      if(!item||!window.confirm(`永久删除「${item.name}」及其本机照片？此操作无法恢复。`))return;
      setBusy(true);
      try{await deleteClosetPermanently(item.id);await refresh({throwOnError:true});channel?.postMessage('changed');message('已永久删除这件衣物及其本机照片。');$('closet-filter-removed').focus();}
      catch(error){message(errorMessage(error),true);}finally{setBusy(false);}
      return;
    }
    const editButton=event.target.closest('[data-edit-clothes]');
    if(editButton){const item=records.find(item=>item.id===editButton.dataset.editClothes);if(item){edit(item);if(bodyFieldsForKind(item.kind).length){$('closet-sizing-panel').open=true;$('closet-sizing-panel').querySelector('summary').focus();}}return;}
    const button=event.target.closest('[data-remove-clothes],[data-restore-clothes]');if(!button)return;
    setBusy(true);
    try{await setClosetRemoved(button.dataset.removeClothes??button.dataset.restoreClothes,!!button.dataset.removeClothes);await refresh({throwOnError:true});channel?.postMessage('changed');message(button.dataset.removeClothes?'已移到最近移除，可随时恢复。':'衣物已恢复，已重新加入搭配。');$('closet-filter-removed').focus();}
    catch(error){message(errorMessage(error),true);}finally{setBusy(false);}
  });
  $('closet-filter-active').addEventListener('click',()=>{showRemoved=false;renderLibrary();});
  $('closet-filter-removed').addEventListener('click',()=>{showRemoved=true;renderLibrary();});
  $('closet-search').addEventListener('input',renderLibrary);
  ['closet-group','closet-weight-filter'].forEach(id=>$(id).addEventListener('change',renderLibrary));
  $('closet-clear-filters').addEventListener('click',()=>{clearFilters();renderLibrary();$('closet-filter-panel').open=true;$('closet-search').focus();});
  $('closet-export').addEventListener('click',async()=>{
    if(busy||!available)return;const version=importVersion,items=filterCloset(records,filters());setBusy(true);message('正在本机打包衣物照片与分类…');
    try{
      const text=await createClosetBackup(items);if(version!==importVersion)return;
      const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');
      link.href=url;link.download=`添一件-衣橱-${new Date().toLocaleDateString('sv-SE')}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      message(`已发起 ${items.length} 件衣物的备份下载，请在浏览器下载中确认保存。`);
    }catch(error){if(version===importVersion)message(errorMessage(error),true);}
    finally{if(version===importVersion)setBusy(false);}
  });
  $('closet-import-backup').addEventListener('click',()=>{if(!busy&&available)$('closet-backup-input').click();});
  $('closet-backup-input').addEventListener('change',async()=>{
    const file=$('closet-backup-input').files[0];if(!file||busy)return;
    const version=++importVersion;setBusy(true);message('正在本机检查备份…');
    try{
      if(file.size>MAX_BACKUP_BYTES)throw new Error('备份文件不能超过 64 MB，请选择分批导出的文件。');
      const {items,exportedAt}=parseClosetBackup(await file.text());
      for(let i=0;i<items.length;i++){
        if(version!==importVersion)return;
        message(`正在检查照片 ${i+1} / ${items.length}…`);await verifyBackupPhoto(items[i].photo);
      }
      await showRestore(items,file.name,exportedAt,version);
    }catch(error){if(version===importVersion)message(errorMessage(error),true);}
    finally{if(version===importVersion){$('closet-backup-input').value='';setBusy(false);}}
  });
  $('closet-restore-cancel').addEventListener('click',()=>{if(busy)return;importVersion++;clearDraft();message('已取消恢复，衣橱没有变化。');$('closet-import-backup').focus({preventScroll:true});});
  $('closet-restore-recheck').addEventListener('click',async()=>{
    if(busy||!restoreReview)return;const {items,fileName,exportedAt}=restoreReview,version=importVersion;setBusy(true);
    try{await showRestore(items,fileName,exportedAt,version);}catch(error){if(version===importVersion)message(errorMessage(error),true);}finally{if(version===importVersion)setBusy(false);}
  });
  $('closet-restore-confirm').addEventListener('click',async()=>{
    if(busy||!restoreReview||restoreReview.plan.overflow)return;const review=restoreReview,version=importVersion;setBusy(true);message('正在合并恢复到本机衣橱…');
    try{
      const result=await restoreCloset(review);await refresh({throwOnError:true});channel?.postMessage('changed');if(version!==importVersion)return;
      clearDraft();showRemoved=false;clearFilters();renderLibrary();message(`恢复完成：新增 ${result.added} 件，重新启用 ${result.restored} 件，跳过 ${result.skipped} 件相同衣物。已有衣物已保留。`);
      setBusy(false);$('closet-add').focus({preventScroll:true});
    }catch(error){if(version===importVersion)message(errorMessage(error),true);}
    finally{if(version===importVersion)setBusy(false);}
  });
  channel?.addEventListener('message',()=>refresh());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  refresh();
}
