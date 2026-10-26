import { fitAssessment, validSizing } from './fit.js?v=20261025-fit4';
// User-confirmed categories. Weather decisions still come from shared/weather.js.
export const CLOSET_KINDS = [
  {id:'tshirt',label:'短袖 / T 恤',thickness:'light'},
  {id:'longsleeve',label:'长袖上衣',thickness:'regular'},
  {id:'knit',label:'针织衫 / 卫衣',thickness:'regular'},
  {id:'base-layer',label:'保暖内搭',thickness:'warm'},
  {id:'light-jacket',label:'薄衬衫 / 薄外套',thickness:'light'},
  {id:'jacket',label:'常规外套',thickness:'regular'},
  {id:'coat',label:'厚外套',thickness:'warm'},
  {id:'puffer',label:'羽绒服',thickness:'warm'},
  {id:'trousers',label:'长裤',thickness:'regular'},
  {id:'shorts',label:'短裤 / 轻薄下装',thickness:'light'},
  {id:'hat',label:'遮阳帽',thickness:'light'},
  {id:'umbrella',label:'雨伞',thickness:'regular'},
  {id:'sunscreen',label:'防晒霜',thickness:'light'},
  {id:'water',label:'水杯',thickness:'regular'}
];
export const THICKNESS = {light:'轻薄',regular:'常规',warm:'保暖'};
export const MAX_CLOSET_ITEMS = 100;
export const CLOSET_GROUPS = {all:'全部衣物',tops:'上衣',outer:'外套',bottoms:'下装',carry:'随身物品'};
const kindGroups={tops:['tshirt','longsleeve','knit','base-layer'],outer:['light-jacket','jacket','coat','puffer'],bottoms:['trousers','shorts'],carry:['hat','umbrella','sunscreen','water']};
export function validClosetMetadata(item) {
  return item && typeof item.id==='string' && /^[a-zA-Z0-9-]{1,80}$/.test(item.id) &&
    typeof item.name==='string' && item.name.trim().length>0 && item.name.length<=40 &&
    CLOSET_KINDS.some(kind=>kind.id===item.kind) && Object.hasOwn(THICKNESS,item.thickness) && validSizing(item.sizing);
}
export function closetKind(id) {return CLOSET_KINDS.find(kind=>kind.id===id);}
export function filterCloset(items,{query='',group='all',thickness='all',removed=false,hideUnfit=false,profile=null}={}) {
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item=>validClosetMetadata(item)&&!!item.removedAt===removed&&
    (group==='all'||kindGroups[group]?.includes(item.kind))&&
    (thickness==='all'||item.thickness===thickness)&&(!hideUnfit||fitAssessment(item,profile).eligible)&&
    terms.every(term=>`${item.name} ${closetKind(item.kind).label} ${THICKNESS[item.thickness]}`.toLocaleLowerCase().includes(term)));
}
export function clothingMatchReason(garment) {
  if(!garment.owned)return `衣橱中暂时没有类型和厚薄都合适的「${garment.label}」，保留通用单品建议。`;
  return `你标注为「${closetKind(garment.owned.kind).label} · ${THICKNESS[garment.owned.thickness]}」，对应这个时段的「${garment.label}」建议。`;
}

function compatible(garment,item) {
  if (garment.label==='羽绒服 / 厚外套') return ['puffer','coat'].includes(item.kind)&&item.thickness==='warm';
  if (garment.label==='T 恤 / 薄长袖') return ['tshirt','longsleeve'].includes(item.kind)&&item.thickness!=='warm';
  if (['轻薄下装','透气下装'].includes(garment.label)) return ['shorts','trousers'].includes(item.kind)&&item.thickness==='light';
  if (garment.asset!==item.kind) return false;
  if (['厚长裤','厚外套','保暖内搭'].includes(garment.label)) return item.thickness==='warm';
  if (['轻薄长裤','薄衬衫 / 薄外套','备用薄衫'].includes(garment.label)) return item.thickness==='light';
  if (['tshirt','shorts'].includes(item.kind)) return item.thickness!=='warm';
  return true;
}
function hash(value) {let n=2166136261;for(const char of value)n=Math.imul(n^char.charCodeAt(0),16777619);return n>>>0;}

export const garmentSlot = (section,garment) => `${section}:${garment.asset}`;
export function closetCandidates(garment,items,{date,period='all',exclude=[],profile=null}={}) {
  return items.filter(item=>!item.removedAt&&validClosetMetadata(item)&&!exclude.includes(item.id)&&compatible(garment,item)&&fitAssessment(item,profile).eligible)
    .sort((a,b)=>fitAssessment(b,profile).score-fitAssessment(a,profile).score||hash(`${date}:${period}:${a.id}`)-hash(`${date}:${period}:${b.id}`)||a.id.localeCompare(b.id));
}

export function matchCloset(garments,items,{date,period='all',variation=0,choices={},profile=null}={}) {
  const used=new Set();
  let alternatives=false;
  const select=(garment,section)=>{
    const slot=garmentSlot(section,garment);
    const candidates=closetCandidates(garment,items,{date,period,exclude:[...used],profile});
    if(candidates.length>1)alternatives=true;
    const owned=candidates.find(item=>item.id===choices[slot])??(candidates.length?candidates[Math.max(0,variation)%candidates.length]:null);
    if(owned)used.add(owned.id);
    return {...garment,slot,candidates,owned,fit:owned?fitAssessment(owned,profile):null};
  };
  const wear=garments.wear.map(item=>select(item,'wear')),carry=garments.carry.map(item=>select(item,'carry'));
  return {wear,carry,alternatives,ownedCount:wear.filter(item=>item.owned).length,
    missingCount:wear.filter(item=>!item.owned).length};
}
