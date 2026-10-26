// Fit comparisons use user-confirmed body ranges, never a height/weight-to-size formula.
export const PROFILE_KEY='weather-layer-body-profile-v1';
export const BODY_FIELDS={
  height:{label:'身高',unit:'cm',min:30,max:280},
  weight:{label:'体重',unit:'kg',min:1,max:500},
  chest:{label:'胸围',unit:'cm',min:20,max:300},
  waist:{label:'腰围',unit:'cm',min:20,max:300},
  hips:{label:'臀围',unit:'cm',min:20,max:300}
};
export const FIT_LABELS={unknown:'尚未确认',regular:'合身舒适',relaxed:'宽松舒适',tight:'偏紧／活动受限'};
export const FIT_PREFERENCES={any:'舒适就好',regular:'偏好合身',relaxed:'偏好宽松'};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
function number(value,key){
  if(value===''||value===null||value===undefined)return null;
  if(typeof value!=='number'||!Number.isFinite(value)||value<BODY_FIELDS[key].min||value>BODY_FIELDS[key].max)throw new Error(`请检查${BODY_FIELDS[key].label}，单位为 ${BODY_FIELDS[key].unit}，支持 ${BODY_FIELDS[key].min}–${BODY_FIELDS[key].max}。`);
  return value;
}
export function normalizeProfile(input){
  if(!plain(input))throw new Error('穿衣档案格式无效。');
  const preference=input.preference??'any';if(!Object.hasOwn(FIT_PREFERENCES,preference))throw new Error('请选择有效的穿着偏好。');
  return {...Object.fromEntries(Object.keys(BODY_FIELDS).map(key=>[key,number(input[key],key)])),preference};
}
export const hasProfile=profile=>!!profile&&(Object.keys(BODY_FIELDS).some(key=>profile[key]!==null&&profile[key]!==undefined)||profile.preference!=='any');
export function readProfile(storage){
  const raw=storage.getItem(PROFILE_KEY);if(raw===null)return null;
  let saved;try{if(raw.length>4000)throw new Error();saved=JSON.parse(raw);}catch{throw new Error('本机穿衣档案无法读取；原记录仍保留。可重新检查或清除后填写。');}
  if(saved?.version!==1||typeof saved.revision!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(saved.revision))throw new Error('本机穿衣档案版本不受支持，原记录仍保留。');
  return {...normalizeProfile(saved),revision:saved.revision};
}
export function writeProfile(storage,input,idFactory=()=>crypto.randomUUID()){
  const profile=normalizeProfile(input),old=readProfile(storage);
  if(!hasProfile(profile)){storage.removeItem(PROFILE_KEY);return null;}
  const same=old&&JSON.stringify(normalizeProfile(old))===JSON.stringify(profile);
  const record={version:1,...profile,revision:same?old.revision:idFactory()};
  storage.setItem(PROFILE_KEY,JSON.stringify(record));return {...profile,revision:record.revision};
}
export function normalizeSizing(input){
  if(input===undefined||input===null)return {label:'',fit:'unknown',ranges:{}};
  if(!plain(input)||typeof (input.label??'')!=='string'||(input.label??'').length>24||!Object.hasOwn(FIT_LABELS,input.fit??'unknown')||input.ranges!==undefined&&!plain(input.ranges))throw new Error('衣物尺码资料无效。');
  const ranges={};
  if(Object.keys(input.ranges??{}).some(key=>!Object.hasOwn(BODY_FIELDS,key)))throw new Error('衣物适用身体范围无效。');
  for(const key of Object.keys(BODY_FIELDS)){
    const range=input.ranges?.[key];if(range===undefined)continue;
    if(!plain(range))throw new Error('衣物适用身体范围无效。');
    const min=number(range.min,key),max=number(range.max,key);
    if(min!==null&&max!==null&&min>max)throw new Error(`${BODY_FIELDS[key].label}范围的下限不能大于上限。`);
    if(min!==null||max!==null)ranges[key]={min,max};
  }
  return {label:(input.label??'').trim(),fit:input.fit??'unknown',ranges};
}
export function validSizing(input){try{normalizeSizing(input);return true;}catch{return false;}}
export const bodyFieldsForKind=kind=>['shorts','trousers'].includes(kind)?['height','weight','waist','hips']:['tshirt','longsleeve','knit','base-layer','light-jacket','jacket','coat','puffer'].includes(kind)?['height','weight','chest']:[];
export function fitAssessment(item,profile){
  let sizing;try{sizing=normalizeSizing(item.sizing);}catch{return {eligible:false,score:0,label:'尺码资料需检查',reason:'衣物尺码资料无效，请编辑确认。',matched:[],missing:[]};}
  const matched=[],missing=[],outside=[];
  const relevant=bodyFieldsForKind(item.kind);
  if(!relevant.length)return {eligible:true,score:0,label:'随身准备',reason:'按全天预报准备，无需身体尺码筛选。',matched:[],missing:[]};
  for(const key of relevant){
    const range=sizing.ranges[key];if(!range)continue;
    const value=profile?.[key];
    if(value===null||value===undefined){missing.push(key);continue;}
    if((range.min!==null&&value<range.min)||(range.max!==null&&value>range.max))outside.push(key);else matched.push(key);
  }
  if(sizing.fit==='tight')return {eligible:false,score:0,label:'暂不自动推荐',reason:'你标记为偏紧或活动受限，自动搭配暂时跳过。',matched,missing};
  if(outside.length)return {eligible:false,score:0,label:'超出已填适用范围',reason:`你的${outside.map(key=>BODY_FIELDS[key].label).join('、')}不在这件衣物填写的身体范围内，自动搭配暂时跳过；可核对品牌尺码表或试穿结果。`,matched,missing};
  const knownFit=['regular','relaxed'].includes(sizing.fit),preferred=profile?.preference!=='any'&&profile?.preference===sizing.fit;
  const score=(preferred?100:knownFit?50:0)+matched.length*5;
  const notes=[];
  if(knownFit)notes.push(`你标记为${FIT_LABELS[sizing.fit]}`);
  if(preferred)notes.push('符合你的穿着偏好');
  if(matched.length)notes.push(`${matched.map(key=>BODY_FIELDS[key].label).join('、')}在已填适用范围内`);
  if(missing.length)notes.push(`${missing.map(key=>BODY_FIELDS[key].label).join('、')}未填写，尚未核对`);
  return {eligible:true,score,label:preferred?'符合穿着偏好':knownFit?FIT_LABELS[sizing.fit]:matched.length?'已对照身体范围':'尺码待确认',reason:notes.length?`${notes.join('；')}。仍以试穿和品牌说明为准。`:'尚无可对照的身体范围或试穿记录，暂按天气匹配，尺码需自行确认。',matched,missing};
}
export function sizingSummary(item){
  const sizing=normalizeSizing(item.sizing);
  return [sizing.label?`尺码 ${sizing.label}`:'',sizing.fit!=='unknown'?FIT_LABELS[sizing.fit]:''].filter(Boolean).join(' · ');
}
