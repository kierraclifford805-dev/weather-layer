import { setupBodyProfile } from './body-profile.js?v=20261027-closet1';
import { CITIES, validCity, forecastURL } from './shared/weather.js';
import { localDate, validZone } from './shared/dates.js';
import { dayView, renderWeather, setupHourly } from './weather-view.js?v=20261027-closet1';
import { openDialog } from './dialogs.js?v=20261027-closet1';
import { setupOutfit } from './outfit-view.js?v=20261027-closet1';
import { setupCloset } from './closet.js?v=20261027-closet1';
const $=id=>document.getElementById(id), storageKey='weather-layer-v1';
let city=null,sensitivity='normal',weather=null,report=null,fetchedCity=null,fetchedAt=null,weatherDate=null;
let requestId=0,searchId=0,controller=null,lastAttempt=0,selectedDay=0;
try{const saved=JSON.parse(localStorage.getItem(storageKey));if(validCity(saved?.city))city=saved.city;if(['warm','normal','cold'].includes(saved?.sensitivity))sensitivity=saved.sensitivity;}catch{}
function save(){try{localStorage.setItem(storageKey,JSON.stringify({city,sensitivity}));}catch{}}
function status(message){$('status').textContent=message;$('status').hidden=!message;}
function syncPreference(){document.querySelectorAll('[data-sensitivity]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.sensitivity===sensitivity)));}
function setSensitivity(value){if(!['warm','normal','cold'].includes(value))throw new Error('请选择怕热、刚刚好或怕冷。');sensitivity=value;save();syncPreference();if(weather)render();return {sensitivity,advice:report?.advice.title??null};}
async function getJSON(url,signal){const response=await fetch(url,{signal});if(!response.ok)throw new Error('天气服务暂时繁忙，请稍后再试。');const data=await response.json();if(data.error)throw new Error('天气服务暂时无法返回这座城市的数据。');return data;}
async function loadWeather(){
  if(!city)return false;
  controller?.abort();controller=new AbortController();const activeController=controller,id=++requestId;
  const retain=weather&&fetchedCity?.latitude===city.latitude&&fetchedCity?.longitude===city.longitude;
  if(!retain){weather=null;report=null;$('dashboard').hidden=true;}
  lastAttempt=Date.now();$('welcome').hidden=true;$('loading-shell').hidden=!!retain;
  $('refresh').hidden=false;$('refresh').disabled=true;$('retry-weather').hidden=true;
  $('dashboard').setAttribute('aria-busy','true');$('city-label').textContent=city.name;
  status(retain?'正在更新天气，先为你保留上次的建议…':`正在整理${city.name}的出门天气…`);
  const timeout=setTimeout(()=>activeController.abort(),18000);
  try{
    const result=await getJSON(forecastURL(city),activeController.signal);if(id!==requestId)return false;
    if(!validZone(result.timezone))throw new Error('天气数据缺少有效当地时区。');
    if(!result.current&&!result.daily?.time?.length)throw new Error('暂时没有可用的天气数据。');
    weather=result;fetchedCity={...city};fetchedAt=new Date();weatherDate=localDate(weather.timezone);
    render();status('');$('dashboard').hidden=false;return true;
  }catch(error){
    if(id!==requestId)return false;
    const reason=(error.name==='AbortError'?'天气查询超时':error.message||'暂时无法连接天气服务').replace(/[。.!！]+$/u,'');
    status(retain?`${reason}。正在显示上次查询的结果，请稍后更新。`:`${reason}。可以重试，或换一座城市。`);
    $('retry-weather').hidden=false;
    if(!retain)$('welcome').hidden=false;
    return false;
  }finally{clearTimeout(timeout);if(id===requestId){$('refresh').disabled=false;$('loading-shell').hidden=true;$('dashboard').setAttribute('aria-busy','false');}}
}
async function selectCity(value){if(!validCity(value))throw new Error('城市信息不完整。');city={name:value.name,latitude:value.latitude,longitude:value.longitude,admin1:value.admin1??'',country:value.country??''};save();++searchId;$('city-dialog').close();$('city-label').textContent=city.name;return loadWeather();}
function render(){
  if(!weather)return;
  const view=dayView(weather,selectedDay,sensitivity);report=view.report;
  renderWeather(weather,fetchedCity,view,fetchedAt,sensitivity);
}
function showCityResults(cities){$('search-results').replaceChildren(...cities.map(value=>{const button=document.createElement('button');button.type='button';button.className='search-result';const name=document.createElement('strong');name.textContent=value.name;const region=document.createElement('span');region.textContent=[value.admin1,value.country].filter(Boolean).join(' · ');button.append(name,region);button.addEventListener('click',()=>selectCity(value));return button;}));}
function openCityDialog(){++searchId;$('city-search').value='';$('search-status').textContent='常用城市，也可以搜索区县。';showCityResults(CITIES.slice(0,12));openDialog($('city-dialog'),$('city-search'));}
$('city-button').addEventListener('click',openCityDialog);$('choose-city').addEventListener('click',openCityDialog);$('close-dialog').addEventListener('click',()=>{++searchId;});$('city-dialog').addEventListener('cancel',()=>{++searchId;});
$('refresh').addEventListener('click',()=>loadWeather());
document.querySelectorAll('[data-sensitivity]').forEach(button=>button.addEventListener('click',()=>setSensitivity(button.dataset.sensitivity)));
$('quick-cities').replaceChildren(...CITIES.slice(0,6).map(value=>{const button=document.createElement('button');button.textContent=value.name;button.addEventListener('click',()=>selectCity(value));return button;}));
$('city-search').addEventListener('input',()=>{++searchId;const query=$('city-search').value.trim();const matches=CITIES.filter(c=>c.name.includes(query)||query===`${c.name}市`);showCityResults(matches.slice(0,12));$('search-status').textContent=matches.length?'选择下方城市，或点搜索查找更多地区。':'点“搜索”查询更多城市；中文查不到时可试拼音。';});
$('search-form').addEventListener('submit',async event=>{
  event.preventDefault();const query=$('city-search').value.trim();if(query.length<2){$('search-status').textContent='请输入至少两个字或字母。';return;}
  const id=++searchId;$('search-status').textContent='正在查找城市…';const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),12000);
  try{
    const p=new URLSearchParams({name:query,count:'15',language:'zh',format:'json'});const response=await getJSON(`https://geocoding-api.open-meteo.com/v1/search?${p}`,abort.signal);if(id!==searchId)return;
    const local=CITIES.filter(c=>c.name===query||`${c.name}市`===query);const all=[...local,...(response.results??[]).filter(validCity)];
    const unique=all.filter((c,i)=>all.findIndex(other=>other.name===c.name&&Math.abs(other.latitude-c.latitude)<.15&&Math.abs(other.longitude-c.longitude)<.15)===i);
    showCityResults(unique);$('search-status').textContent=unique.length?'请选择对应的地区，避免选到同名城市。':'没有找到城市，试试附近城市或拼音，例如 Hangzhou。';
  }catch{if(id===searchId)$('search-status').textContent='城市搜索暂时不可用。可以选择常用城市，或稍后重试。';}finally{clearTimeout(timeout);}
});

$('retry-weather').addEventListener('click',()=>loadWeather());
document.querySelectorAll('[data-day]').forEach(button=>button.addEventListener('click',()=>{
  selectedDay=Number(button.dataset.day);
  document.querySelectorAll('[data-day]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  render();
}));
function refreshIfNeeded(){
  if(new URLSearchParams(location.search).has('brief'))return;
  if(!city||document.hidden||$('refresh').disabled)return;
  const dateChanged=weather&&localDate(weather.timezone)!==weatherDate;
  if(dateChanged||Date.now()-lastAttempt>=30*60*1000)loadWeather();
}
document.addEventListener('visibilitychange',refreshIfNeeded);window.addEventListener('focus',refreshIfNeeded);setInterval(refreshIfNeeded,60000);
setupHourly();setupOutfit();setupBodyProfile();setupCloset();syncPreference();if(city&&!new URLSearchParams(location.search).has('brief'))loadWeather();
// Optional WebMCP support uses exactly the same actions as the visible page.
if(document.modelContext?.registerTool){
  const lifecycle=new AbortController();const register=tool=>{try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:'set_weather_city',title:'选择天气城市',description:'选择城市并获取天气；城市偏好会保存在当前浏览器。',inputSchema:{type:'object',properties:{name:{type:'string'},latitude:{type:'number'},longitude:{type:'number'}},required:['name','latitude','longitude'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input=>{if(!validCity(input))throw new Error('请输入有效的城市名和经纬度。');const ok=await selectCity(input);return {ok,city:city.name,advice:report?.advice.title??null,error:ok?null:$('status').textContent};}});
  register({name:'set_cold_sensitivity',title:'设置怕冷程度',description:'设置个人体感，重新计算页面上的穿衣建议。',inputSchema:{type:'object',properties:{sensitivity:{type:'string',enum:['warm','normal','cold']}},required:['sensitivity'],additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>setSensitivity(input?.sensitivity)});
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
