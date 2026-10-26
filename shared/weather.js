import { addDays } from './dates.js';

export const CITIES = [
  ['北京','北京市',39.9042,116.4074],['上海','上海市',31.2304,121.4737],
  ['杭州','浙江省',30.2741,120.1551],['成都','四川省',30.5728,104.0668],
  ['广州','广东省',23.1291,113.2644],['深圳','广东省',22.5431,114.0579],
  ['南京','江苏省',32.0603,118.7969],['武汉','湖北省',30.5928,114.3055],
  ['重庆','重庆市',29.563,106.5516],['西安','陕西省',34.3416,108.9398],
  ['长沙','湖南省',28.2282,112.9388],['郑州','河南省',34.7466,113.6254],
  ['天津','天津市',39.0842,117.2009],['苏州','江苏省',31.2989,120.5853],
  ['合肥','安徽省',31.8206,117.2272],['福州','福建省',26.0745,119.2965],
  ['济南','山东省',36.6512,117.1201],['青岛','山东省',36.0671,120.3826],
  ['昆明','云南省',25.0389,102.7183],['南宁','广西',22.817,108.3669],
  ['哈尔滨','黑龙江省',45.8038,126.535],['沈阳','辽宁省',41.8057,123.4315],
].map(([name,admin1,latitude,longitude])=>({name,admin1,latitude,longitude,country:'中国'}));
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const temp = value => finite(value) ? `${Math.round(value)}°` : '—';
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validCity(city){return city && typeof city.name==='string' && city.name.trim().length>0 && city.name.length<=120 && finite(city.latitude) && finite(city.longitude) && Math.abs(city.latitude)<=90 && Math.abs(city.longitude)<=180;}
export function describeWeather(code){
  if(code===0)return ['晴','☀️']; if([1,2].includes(code))return ['晴间多云','🌤️']; if(code===3)return ['阴','☁️'];
  if([45,48].includes(code))return ['有雾','🌫️']; if([51,53,55,56,57].includes(code))return ['毛毛雨','🌦️'];
  if([61,63,65,66,67,80,81,82].includes(code))return ['有雨','🌧️']; if([71,73,75,77,85,86].includes(code))return ['有雪','🌨️'];
  if([95,96,99].includes(code))return ['雷雨','⛈️']; return ['天气信息暂缺','◌'];
}
export function outfit(feels,sensitivity='normal'){
  if(!finite(feels))return {title:'体感数据暂缺',label:'暂不判断',description:'暂时无法给出可靠的添衣建议，稍后更新天气再看看。',items:['—','—','—']};
  const adjusted=feels-({cold:2,normal:0,warm:-2}[sensitivity]??0);
  if(adjusted<5)return {title:'出门，认真穿暖一点。',label:'厚衣保暖',description:'出门加上厚外套，内搭保暖层；长时间待在户外时，记得护好脖颈和双手。',items:['保暖内搭','羽绒服 / 厚外套','厚长裤']};
  if(adjusted<12)return {title:'外套，选厚一点的。',label:'记得添衣',description:'早晚体感偏冷，针织衫外再搭一件厚外套。进到暖和的室内，可以按需脱下一层。',items:['针织衫 / 卫衣','厚外套','长裤']};
  if(adjusted<18)return {title:'出门，多带一件外套。',label:'记得添衣',description:'出门时有些凉意，长袖搭配外套更舒服。到了暖和的时候，脱下一层就好。',items:['长袖上衣','常规外套','长裤']};
  if(adjusted<24)return {title:'带件薄外套，刚刚好。',label:'轻薄叠穿',description:'轻薄内搭配一件随时能脱下的外套，兼顾早晚和白天。怕冷的话，出门就穿上。',items:['T 恤 / 薄长袖','薄衬衫 / 薄外套','轻薄长裤']};
  if(adjusted<28)return {title:'轻装出门，就很舒服。',label:'无需特意添衣',description:'户外穿轻薄、透气的衣服就好。经常待在空调房的话，可以额外带一件薄衬衫。',items:['透气短袖','备用薄衫','轻薄下装']};
  return {title:'出门，穿轻一点。',label:'清凉出门',description:'体感偏热，选择宽松透气的衣物。尽量避开长时间暴晒，出门记得补水。',items:['宽松短袖','遮阳帽 / 防晒衣','透气下装']};
}
export function dayHours(data,date){
  const h=data.hourly??{};
  return (h.time??[]).flatMap((time,i)=>typeof time==='string'&&time.startsWith(`${date}T`)?[{time,hour:Number(time.slice(11,13)),temperature:h.temperature_2m?.[i],feels:h.apparent_temperature?.[i]}]:[]);
}
export function minimum(values){const usable=values.filter(finite);return usable.length?Math.min(...usable):null;}
export function summarize(data,date,sensitivity='normal'){
  const index=data.daily?.time?.indexOf(date)??-1;
  if(index<0)throw new Error('天气数据中没有指定日期的预报，请重新查询。');
  const daily=data.daily;const hours=dayHours(data,date);
  const daytime=hours.filter(h=>h.hour>=7&&h.hour<=21);
  const basis=minimum(daytime.map(h=>h.feels));
  const low=daily.temperature_2m_min?.[index],high=daily.temperature_2m_max?.[index];
  const previous=daily.temperature_2m_min?.[daily.time.indexOf(addDays(date,-1))];
  return {index,date,low,high,basis,hours,advice:outfit(basis,sensitivity),morning:minimum(hours.filter(h=>h.hour>=7&&h.hour<=9).map(h=>h.feels)),evening:minimum(hours.filter(h=>h.hour>=18&&h.hour<=21).map(h=>h.feels)),change:finite(previous)?low-previous:null,rain:daily.precipitation_probability_max?.[index],wind:daily.wind_speed_10m_max?.[index]};
}
export function forecastURL(city, zone='auto'){
  const p=new URLSearchParams({latitude:city.latitude,longitude:city.longitude,timezone:zone,forecast_days:'7',past_days:'1',temperature_unit:'celsius',wind_speed_unit:'kmh',current:'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',hourly:'temperature_2m,apparent_temperature',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,uv_index_max'});
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}
