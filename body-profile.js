import { openDialog } from './dialogs.js?v=20261027-closet1';
import { BODY_FIELDS, PROFILE_KEY, normalizeProfile, readProfile, writeProfile } from './shared/fit.js?v=20261027-closet1';
const $=id=>document.getElementById(id);
let profile=null,error='',undoRaw=null,formRevision=null;
export const getBodyProfile=()=>({profile,error});
function message(text,bad=false){$('profile-message').textContent=text;$('profile-message').hidden=!text;$('profile-message').dataset.error=String(bad);}
function refresh(){
  try{profile=readProfile(localStorage);error='';}catch{profile=null;error='本机穿衣档案暂时无法读取，尚未应用身体范围筛选。原记录仍保留。';}
  const count=profile?Object.keys(BODY_FIELDS).filter(key=>profile[key]!==null).length:0;
  document.querySelectorAll('[data-profile-summary]').forEach(node=>node.textContent=error?'资料需检查，天气推荐仍可用':profile?`${count?`已填写 ${count} 项身体数据`:'已设置穿着偏好'} · 仅存本机`:'加入身高、体重，让衣物更合适');
  document.querySelectorAll('[data-open-profile]').forEach(button=>{button.dataset.ready=String(!!profile);if(button.closest('.profile-entry'))button.textContent=error?'检查档案 ↗':profile?'编辑档案 ↗':'去完善 ↗';});
  document.dispatchEvent(new CustomEvent('body-profile-updated'));
}
function fill(){
  formRevision=profile?.revision??null;
  for(const key of Object.keys(BODY_FIELDS))$(`profile-${key}`).value=profile?.[key]??'';
  $('profile-preference').value=profile?.preference??'any';
  $('profile-clear').disabled=!profile&&!error;
  $('profile-draft-note').textContent='所有项目都可留空；保存后才会应用。';
}
function formValue(){return {...Object.fromEntries(Object.keys(BODY_FIELDS).map(key=>[key,$(`profile-${key}`).value===''?null:$(`profile-${key}`).valueAsNumber])),preference:$('profile-preference').value};}
export function setupBodyProfile(){
  document.querySelectorAll('[data-open-profile]').forEach(button=>button.addEventListener('click',()=>{
    refresh();fill();message(error,!!error);$('profile-undo').hidden=undoRaw===null;
    $('profile-dialog').querySelector('.profile-privacy').open=false;
    openDialog($('profile-dialog'),$('profile-title'));$('profile-dialog').scrollTop=0;
  }));
  $('profile-form').addEventListener('input',()=>{$('profile-draft-note').textContent='有修改尚未保存，当前搭配仍使用原档案。';});
  $('profile-form').addEventListener('submit',event=>{
    event.preventDefault();if(!$('profile-form').reportValidity())return;
    try{
      if((readProfile(localStorage)?.revision??null)!==formRevision){message('档案已在另一页面更新。请先撤销未保存的修改，再重新编辑，避免覆盖新资料。',true);return;}
      const value=normalizeProfile(formValue());
      writeProfile(localStorage,value);undoRaw=null;$('profile-undo').hidden=true;refresh();fill();message('已保存到本机，并更新每日穿搭的合身筛选。');$('profile-dialog').close();
    }catch(reason){message(reason?.message?.includes('范围')||reason?.message?.includes('版本')?reason.message:'保存失败，尚未应用修改。请检查浏览器存储权限或空间后重试。',true);}
  });
  $('profile-reset').addEventListener('click',()=>{refresh();fill();message(error||'已撤销未保存的修改。',!!error);});
  $('profile-clear').addEventListener('click',()=>{
    try{
      const raw=localStorage.getItem(PROFILE_KEY);localStorage.removeItem(PROFILE_KEY);undoRaw=raw;
      refresh();fill();$('profile-undo').hidden=undoRaw===null;message('已清除本机身体资料和穿着偏好。衣物照片保留；本页可撤销清除；再次保存或关闭页面后，撤销入口会消失。');
    }catch{message('清除失败，原档案仍保留，请重试。',true);}
  });
  $('profile-undo').addEventListener('click',()=>{
    if(undoRaw===null)return;
    try{
      if(localStorage.getItem(PROFILE_KEY)!==null)throw new Error();
      localStorage.setItem(PROFILE_KEY,undoRaw);undoRaw=null;$('profile-undo').hidden=true;refresh();fill();message(error||'已恢复刚才清除的本机档案。',!!error);
    }catch{message('无法撤销：档案可能已有更新或浏览器存储不可用，未覆盖当前资料。',true);}
  });
  window.addEventListener('storage',event=>{
    if(event.key!==PROFILE_KEY&&event.key!==null)return;
    refresh();if($('profile-dialog').open)message('另一页面更新了档案。当前输入尚未保存；点击“撤销未保存的修改”读取最新资料。');
  });
  refresh();
}
