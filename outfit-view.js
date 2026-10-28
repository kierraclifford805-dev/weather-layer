import { getBodyProfile } from './body-profile.js?v=20261028-studio1';
import { sizingSummary, fitAssessment } from './shared/fit.js?v=20261028-studio1';
import { finite, temp, escapeHTML as esc } from './shared/weather.js';
import { outfitPeriods } from './shared/outfit-periods.js';
import { clothes, wardrobe } from './visuals.js?v=20261028-studio1';
import { getCloset, closetPhoto } from './closet.js?v=20261028-studio1';
import { matchCloset, clothingMatchReason, closetKind, THICKNESS } from './shared/closet.js?v=20261028-studio1';

import { openDialog } from './dialogs.js?v=20261028-studio1';
import { OUTFIT_STORAGE_KEY, selectionKey, outfitSignature, chosenItems, sameChoices, validateSavedSelection, readSavedOutfits, saveOutfit, forgetOutfit } from './shared/outfit-selection.js?v=20261028-studio1';

const $ = id => document.getElementById(id);
let context = null, selected = 'all', selection = null, current = null, pickerSlot = null, pickerScope = null;
// Volatile drafts are scoped just like confirmations; photos/body values never enter them.
const drafts=new Map();
function changeChoices(choices){
  if(sameChoices(choices,chosenItems(current.garments)))return;
  selection.undo.push({choices:chosenItems(current.garments),dirty:selection.dirty});
  if(selection.undo.length>10)selection.undo.shift();
  selection.choices=choices;selection.dirty=true;
}
const garmentLabel = label => label.split(' / ').map(part=>`<span class="garment-name-part">${esc(part)}</span>`).join(' / ');
const periodDescriptions = {
  '厚衣保暖':'保暖内搭配厚外套，长时间在户外时也照顾好脖颈和双手。',
  '记得添衣':'内搭配一件外套，到了暖和的室内，方便脱下一层。',
  '轻薄叠穿':'轻薄内搭，加一件方便穿脱的外层；怕冷的话，出门就穿上。',
  '无需特意添衣':'穿轻薄透气的衣物；经常待在空调房，可以备用一件薄衫。',
  '清凉出门':'衣物选宽松透气的，出门做好遮阳，也记得补水。'
};

export function renderOutfit(report, sun, day, date, sensitivity, cityKey, cityName='当前城市') {
  const key = `${cityKey}:${date}`;
  if (context?.key !== key) {selected = 'all';}
  context = { key, cityKey, cityName, report, sun, day, date, sensitivity, periods:outfitPeriods(report, sensitivity) };
  if (!context.periods.find(period=>period.id===selected)?.available) selected='all';
  $('wardrobe-title').textContent=day?'明日穿搭推荐':'今日穿搭推荐';
  $('wardrobe-date').textContent=`${day?'明天':'今天'} · ${date.slice(5).replace('-','/')}`;
  // Keep these buttons stable during selection so keyboard focus is retained.
  document.querySelectorAll('[data-outfit-period]').forEach(button=>{
    const period=context.periods.find(period=>period.id===button.dataset.outfitPeriod);
    button.disabled=period.id!=='all'&&!period.available;
    button.querySelector('small').textContent=period.available?`${temp(period.basis)} 体感`:'信息暂缺';
    button.setAttribute('aria-label',`${period.label}，${period.time}，${period.available?`可用预报最低体感 ${temp(period.basis)}`:'体感信息暂缺'}`);
  });
  updateOutfit();
}

function updateOutfit(message='') {
  const { report, sun, periods, date } = context;
  const period=periods.find(item=>item.id===selected);
  document.querySelectorAll('[data-outfit-period]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.outfitPeriod===selected)));
  $('outfit-basis').textContent=period.available?`${date} · ${period.time} · 可用预报最低体感 ${temp(period.basis)}`:`${date} · 体感信息暂缺，暂不判断穿搭`;
  $('outfit-period-note').textContent=selected==='all'?'按 07–21 时最低体感选衣，也可切换出门时段。':`仅按${period.label}的可用预报选衣；全天温差与随身准备仍参考整天预报。`;
  $('advice-description').textContent=selected==='all'||!period.available?period.advice.description:periodDescriptions[period.advice.label];
  const closet=getCloset(),personal=closet.items.length>0,{profile,error:profileError}=getBodyProfile();
  const scope={cityKey:context.cityKey,date,period:selected},key=selectionKey(scope);
  const requirements=wardrobe({...report,advice:period.advice},sun),signature=outfitSignature(requirements,context.sensitivity,profile?.revision);
  const existing=drafts.get(key);
  if(existing&&existing.signature!==signature&&existing.dirty)message='天气或体感建议已变化，未保存的调整已重新匹配，请确认当前搭配。';
  selection=existing?.signature===signature?existing:{key,signature,choices:{},dirty:false,undo:[]};
  drafts.delete(key);drafts.set(key,selection);
  while(drafts.size>12)drafts.delete(drafts.keys().next().value);
  let saved=null,storageError='';
  try{saved=readSavedOutfits(localStorage).find(item=>selectionKey(item)===key)??null;}
  catch{storageError='暂时无法读取本机搭配记录，尚未保存。天气与衣橱仍可使用。';}
  const validation=validateSavedSelection(saved,requirements,closet.items,signature,profile);
  if(!selection.dirty)selection.choices=closet.available&&validation.ok?saved.choices:{};
  const garments=matchCloset(requirements,closet.items,{date,period:selected,choices:selection.choices,profile});
  if(selection.dirty&&!sameChoices(selection.choices,chosenItems(garments))){
    message='衣橱中的单品已变化，已按当前可用衣物重新匹配，请确认后再记住。';
    selection.choices=chosenItems(garments);selection.undo=[];
  }
  current={scope,signature,garments,period,saved,validation,storageError};
  renderSelectionStatus(message);
  if(pickerSlot&&pickerScope!==`${key}|${signature}`){pickerSlot=null;$('outfit-picker').close();}
  else if(pickerSlot)renderPicker();
  $('outfit-explanation').hidden=!period.available;
  $('outfit-explanation-basis').textContent=`${date} · ${period.time} · 可用预报最低体感 ${temp(period.basis)}。你的体感偏好：${({cold:'怕冷',normal:'刚刚好',warm:'怕热'})[context.sensitivity]??'刚刚好'}。沿用原有穿衣规则选择单品，随身物品仍参考全天预报。`;
  $('outfit-match-reasons').innerHTML=garments.wear.map(item=>`<li><strong>${esc(item.owned?.name??item.label)}</strong>${esc(closet.items.length?clothingMatchReason(item):item.reason)}${item.owned?`<span>${esc(item.fit.reason)}</span>`:''}</li>`).join('');
  $('closet-summary').textContent=personal?(period.available?(garments.ownedCount?`这一身，选了你的 ${garments.ownedCount} 件衣物。`:'这个时段，先参考这些单品。'):'天气信息暂缺，先把衣橱整理好。'):'用自己的衣服，搭一身。';
  $('closet-explainer').textContent=personal?(period.available?(garments.missingCount?`另有 ${garments.missingCount} 件为建议单品，暂时没有同时符合天气与合身条件的自有衣物。`:'按天气、衣物类型和合身资料搭配，未知尺码仍需确认。'):'天气恢复后，再从衣橱挑选合适的搭配。'):'导入照片、确认分类，按天气从你的衣橱挑选。';
  if(personal&&period.available&&!garments.alternatives)$('closet-explainer').textContent+=' 添加合适的同类衣物后可换一套。';
  $('closet-open-label').textContent=personal?`衣橱 · ${closet.items.length}`:'我的衣橱';
  $('closet-variation').hidden=!personal||!period.available;
  $('closet-variation').disabled=!garments.alternatives;
  $('closet-variation').title=garments.alternatives?'从合适的同类衣物里换一组':'再添加合适的同类衣物，就能换一套';
  $('outfit-coverage').hidden=!personal||!period.available;
  $('outfit-coverage').innerHTML=`<div><strong>${garments.ownedCount}<span> / ${garments.wear.length}</span></strong><p>件来自我的衣橱</p></div><ul>${garments.wear.map(item=>`<li data-matched="${!!item.owned}"><i aria-hidden="true">${item.owned?'✓':'＋'}</i><span>${esc(item.role)}<small>${item.owned?'已匹配':'建议参考'}</small></span></li>`).join('')}</ul>`;
  $('outfit-items').innerHTML=garments.wear.length?garments.wear.map((item,i)=>`<article class="outfit-item" data-personal="${!!item.owned}"><div class="garment-stage" data-garment="${item.asset}" data-owned="${!!item.owned}"><span class="garment-role"><small>${String(i+1).padStart(2,'0')}</small> ${item.role}</span><img src="${item.owned?closetPhoto(item.owned.id):clothes[item.asset]}" alt="${esc(item.owned?.name??`${item.label}插画`)}" width="200" height="190"></div><strong>${item.owned?esc(item.owned.name):garmentLabel(item.label)}</strong><span class="garment-reason">${item.owned?esc(item.label):item.reason}</span>${personal?`<small class="closet-source" data-owned="${!!item.owned}">${item.owned?'我的衣橱':'建议单品 · 衣橱暂缺'}</small>`:''}${item.owned?`<small class="fit-badge" data-fit="${item.fit.label==='尺码待确认'?'unknown':'eligible'}">${esc(item.fit.label)}</small>`:''}${pickButton(item,period.available)}</article>`).join(''):'<p class="empty-note">体感数据暂缺，暂不推荐衣物。可以更新天气，或稍后再试。</p>';
  const ownedWear=garments.wear.filter(item=>item.owned),compared=ownedWear.filter(item=>item.fit.matched.length).length;
  $('outfit-fit-note').textContent=profileError||(!period.available?'':profile?(compared?`已有 ${compared} 件对照你的身体范围；其余依据试穿标记或天气推荐。`:'档案已应用；当前单品暂无可对照的身体范围，可在衣橱编辑中补充。'):'补充穿衣档案与衣物尺码，推荐会更贴近你的实际穿着。');
  $('outfit-fit-note').hidden=!$('outfit-fit-note').textContent;
  $('carry-items').innerHTML=garments.carry.length?garments.carry.map(item=>`<div class="carry-item"><img src="${item.owned?closetPhoto(item.owned.id):clothes[item.asset]}" alt="" width="200" height="190"><div><strong>${esc(item.owned?.name??item.label)}</strong><small>${item.owned?'我的衣橱 · ':''}${esc(item.reason)}</small>${personal&&!item.owned?'<small>建议携带 · 衣橱暂缺</small>':''}${pickButton(item,period.available)}</div></div>`).join(''):`<p class="empty-note">${!finite(report.rain)&&sun.status!=='available'?'随身物品所需的天气信息暂缺。':'根据目前可用预报，没有额外的随身物品建议。'}</p>`;
}

export function setupOutfit() {
  const controls=$('outfit-periods');
  controls.addEventListener('click',event=>{
    const button=event.target.closest('[data-outfit-period]');
    if(!context||!button||button.disabled)return;
    selected=button.dataset.outfitPeriod;updateOutfit();
  });
  controls.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const buttons=[...controls.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(event.target);
    if(index<0)return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
    buttons[next].focus();buttons[next].click();
  });
  $('closet-variation').addEventListener('click',()=>{
    if(!current||!current.garments.alternatives)return;
    changeChoices(Object.fromEntries([...current.garments.wear,...current.garments.carry].map(item=>{
      const index=item.candidates.findIndex(candidate=>candidate.id===item.owned?.id);
      return [item.slot,item.candidates.length?item.candidates[(index+1)%item.candidates.length].id:null];
    })));updateOutfit();
  });
  for(const id of ['outfit-items','carry-items'])$(id).addEventListener('click',event=>{
    const button=event.target.closest('[data-pick-slot]');if(!button||!current)return;
    pickerSlot=button.dataset.pickSlot;pickerScope=`${selection.key}|${selection.signature}`;
    renderPicker();openDialog($('outfit-picker'),$('outfit-picker-title'));
  });
  $('outfit-picker-items').addEventListener('click',event=>{
    const button=event.target.closest('[data-pick-id]');if(!button||!current||!pickerSlot)return;
    const item=[...current.garments.wear,...current.garments.carry].find(item=>item.slot===pickerSlot);
    if(!item?.candidates.some(candidate=>candidate.id===button.dataset.pickId))return;
    changeChoices({...chosenItems(current.garments),[pickerSlot]:button.dataset.pickId});
    $('outfit-picker').close();
  });
  $('outfit-picker').addEventListener('close',()=>{
    const slot=pickerSlot;pickerSlot=null;if(!context)return;
    updateOutfit();
    const returnTo=slot?document.querySelector(`[data-pick-slot="${slot}"]`):null;
    (returnTo??document.querySelector('[data-outfit-period][aria-pressed="true"]'))?.focus({preventScroll:true});
  });
  $('outfit-save').addEventListener('click',()=>{
    if(!current||$('outfit-save').disabled)return;
    try{
      saveOutfit(localStorage,{...current.scope,signature:current.signature,choices:chosenItems(current.garments),savedAt:Date.now()});
      selection.dirty=false;selection.undo=[];updateOutfit();
    }catch{updateOutfit('保存失败，这套还没有记住。请检查浏览器存储空间或权限后重试。');}
  });
  $('outfit-undo').addEventListener('click',()=>{
    if(!current||!selection.undo.length)return;
    const previous=selection.undo.pop();selection.choices=previous.choices;selection.dirty=previous.dirty;
    // A non-dirty snapshot normally reloads saved/automatic choices in updateOutfit.
    updateOutfit('已撤销上一次换搭。');
    if($('outfit-undo').hidden)$('closet-variation').focus({preventScroll:true});
  });
  $('outfit-revert').addEventListener('click',()=>{selection.dirty=false;selection.choices={};selection.undo=[];updateOutfit();});
  $('outfit-forget').addEventListener('click',()=>{
    if(!current?.saved)return;
    try{forgetOutfit(localStorage,current.scope);selection.dirty=false;selection.choices={};selection.undo=[];updateOutfit('已取消记住；回到天气自动推荐，衣橱里的照片保持不变。');}
    catch{updateOutfit('取消记住失败，原记录仍保留，请重试。');}
  });
  window.addEventListener('storage',event=>{if(context&&(event.key===OUTFIT_STORAGE_KEY||event.key===null))updateOutfit('另一页面更新了搭配记录，已重新核对本页。');});
  document.addEventListener('body-profile-updated',()=>{if(context)updateOutfit();});
  document.addEventListener('closet-updated',()=>{if(context)updateOutfit();});
}

function pickButton(item,available) {
  return available&&item.candidates.length>1?`<button type="button" class="garment-pick" data-pick-slot="${item.slot}" aria-haspopup="dialog" aria-label="替换${esc(item.role??item.label)}：${esc(item.owned?.name??item.label)}">换这件 <span aria-hidden="true">↗</span></button>`:'';
}
function renderPicker() {
  const item=[...current.garments.wear,...current.garments.carry].find(item=>item.slot===pickerSlot);
  if(!item||!item.candidates.length){pickerSlot=null;$('outfit-picker').close();return;}
  const focused=document.activeElement?.dataset.pickId;
  $('outfit-picker-title').textContent=`挑一件${item.role??item.label}`;
  $('outfit-picker-context').textContent=`${context.cityName} · ${context.date} · ${current.period.label} ${current.period.time}`;
  $('outfit-picker-rule').textContent=`这时需要「${item.label}」。下面 ${item.candidates.length} 件都符合你标注的类型与厚薄；仅展示符合天气、未被标记为不合适的单品。只替换这一件。`;
  $('outfit-picker-items').innerHTML=item.candidates.map(candidate=>`<button type="button" class="outfit-option" data-pick-id="${candidate.id}" aria-pressed="${candidate.id===item.owned?.id}"><img src="${closetPhoto(candidate.id)}" alt="" width="200" height="190"><strong>${esc(candidate.name)}</strong><small>${closetKind(candidate.kind).label} · ${THICKNESS[candidate.thickness]}${sizingSummary(candidate)?` · ${esc(sizingSummary(candidate))}`:''}</small><small class="option-fit">${esc(fitAssessment(candidate,getBodyProfile().profile).reason)}</small><span>${candidate.id===item.owned?.id?'✓ 正在搭配':'选这件'}</span></button>`).join('');
  if(focused)$('outfit-picker-items').querySelector(`[data-pick-id="${focused}"]`)?.focus({preventScroll:true});
}
function renderSelectionStatus(message) {
  const {saved,validation,storageError,period,garments}=current,closet=getCloset();
  const matches=saved&&validation.ok&&sameChoices(saved.choices,chosenItems(garments));
  const ownCount=[...garments.wear,...garments.carry].filter(item=>item.owned).length;
  $('outfit-save-panel').hidden=!closet.items.length&&!saved;
  $('outfit-save').dataset.saved=String(!!matches);
  $('outfit-save').textContent=matches?'✓ 已记住这套':saved?'更新记住的搭配':'就穿这套 · 记住';
  $('outfit-save').disabled=!!matches||!period.available||!closet.available||!ownCount||!!storageError;
  $('outfit-revert').hidden=!selection.dirty;
  $('outfit-undo').hidden=!selection.undo.length||!period.available;
  $('outfit-revert').textContent=saved&&validation.ok?'回到记住的搭配':'恢复自动推荐';
  $('outfit-forget').hidden=!saved;
  $('outfit-save-status').dataset.attention=String(!!storageError||!!(saved&&!validation.ok)||message.includes('失败'));
  $('outfit-save-status').textContent=storageError||message||(!period.available?'体感信息暂缺，暂不能确认这套搭配。':!closet.available?'正在读取本机衣橱，暂不能确认搭配。':saved&&!validation.ok?validation.reason:matches?`已为 ${context.cityName} · ${context.date} · ${period.label}记住这套，下次打开会重新核对天气和衣物。`:selection.dirty?'已调整，尚未记住。切换日期或时段再回来，临时选择仍在；刷新前请点“记住”。':!ownCount?'当前没有匹配的自有衣物，先参考通用建议。':'挑好之后，记住这一身。换一件不会改变其他单品。');
}
