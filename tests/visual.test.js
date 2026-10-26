import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {dayView,forecastRows} from '../weather-view.js';
import {weatherScene,wardrobe,clothes} from '../visuals.js';
import {outfit} from '../shared/weather.js';
import {sunAdvice} from '../shared/briefing.js';
import {localDate,addDays} from '../shared/dates.js';
import { IDBFactory } from 'fake-indexeddb';
import { PROFILE_KEY } from '../shared/fit.js';
import { OUTFIT_STORAGE_KEY } from '../shared/outfit-selection.js';
import { createClosetBackup } from '../shared/closet-backup.js';
const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(){
  const today=localDate('Asia/Shanghai'),dates=Array.from({length:8},(_,i)=>addDays(today,i-1));
  return {timezone:'Asia/Shanghai',current:{time:`${today}T12:00`,temperature_2m:24,apparent_temperature:25,is_day:1,weather_code:0},daily:{time:dates,temperature_2m_min:[10,19,11,12,13,14,15,16],temperature_2m_max:[20,27,23,24,25,26,27,28],weather_code:dates.map(()=>0),uv_index_max:[0,2,8,3,4,5,6,7],precipitation_probability_max:dates.map(()=>60),wind_speed_10m_max:dates.map(()=>12)},hourly:{time:dates.flatMap(d=>[7,10,13,16,19,21].map(h=>`${d}T${h.toString().padStart(2,'0')}:00`)),apparent_temperature:dates.flatMap((d,i)=>[i===2?10:20,21,24,22,19,18]),temperature_2m:dates.flatMap(()=>[18,20,23,22,20,18])}};
}
test('date selection changes clothing, daily UV, temperatures and weather scene together',()=>{
  const data=fixture(),today=dayView(data,0,'normal'),tomorrow=dayView(data,1,'normal');
  assert.equal(today.isCurrent,true);assert.equal(today.temperature,24);assert.equal(today.sun.value,2);
  assert.equal(tomorrow.isCurrent,false);assert.equal(tomorrow.temperature,23);assert.equal(tomorrow.sun.value,8);
  assert.equal(tomorrow.report.basis,10);assert.equal(tomorrow.report.advice.items[1],'厚外套');
  assert.equal(tomorrow.date,addDays(today.date,1));
});
test('missing or old current readings never masquerade as selected-day live observations',()=>{
  const data=fixture();data.current.time=`${addDays(localDate('Asia/Shanghai'),-1)}T23:00`;
  assert.equal(dayView(data,0,'normal').isCurrent,false);
  delete data.current;assert.equal(dayView(data,1,'normal').report.basis,10);
});
test('seven-day range bars share a single scale and keep starting at today',()=>{
  const data=fixture(),rows=forecastRows(data,localDate('Asia/Shanghai'));
  assert.equal(rows.length,7);assert.equal(rows[0].date,localDate('Asia/Shanghai'));
  assert.equal(rows[1].start,0);assert.equal(rows.at(-1).start+rows.at(-1).range,100);
  assert.equal(rows[1].range,12/17*100);
  data.daily.temperature_2m_min[2]=null;assert.equal(forecastRows(data,rows[0].date)[1].start,null);
});
test('all original clothing rules map to local assets without changing thresholds',()=>{
  for(const feels of [-2,5,12,18,24,28]){
    const rule=outfit(feels),items=wardrobe({advice:rule,rain:0,high:20},sunAdvice(null));
    assert.equal(items.wear.length+items.carry.length,3);
    for(const item of [...items.wear,...items.carry])assert(existsSync(fileURLToPath(clothes[item.asset])));
  }
});
test('sun accessories use confirmed UV thresholds; missing UV is not interpreted as zero',()=>{
  const report={advice:outfit(20),rain:0,high:24};
  assert.equal(wardrobe(report,sunAdvice(null)).carry.length,0);
  assert.equal(wardrobe(report,sunAdvice(0)).carry.length,0);
  assert.deepEqual(wardrobe(report,sunAdvice(3)).carry.map(x=>x.asset),['hat','sunscreen']);
});
test('weather scenarios use weather code and live day/night, independently of visual theme',()=>{
  assert.equal(weatherScene(63),'rain');assert.equal(weatherScene(3),'cloudy');assert.equal(weatherScene(0),'clear');
  assert.equal(weatherScene(0,true),'night');assert.equal(weatherScene(undefined,true),'unknown');
});
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r));};
async function page(t,{fetchWeather=()=>Response.json(fixture()),stored=true,closetDB,savedOutfits,bodyProfile,photoDecoder=()=>Promise.resolve()}={}){
  const code=(await build({entryPoints:[`${root}app.js`],bundle:true,write:false,format:'iife',define:{'import.meta.url':JSON.stringify('https://example.com/weather-layer/app.js')}})).outputFiles[0].text;
  const dom=new JSDOM(readFileSync(`${root}index.html`,'utf8'),{url:'https://example.com/weather-layer/',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window;w.AbortController=AbortController;w.matchMedia=()=>({matches:false});
  if(closetDB){w.indexedDB=closetDB;w.Blob=Blob;w.URL.createObjectURL=URL.createObjectURL;w.URL.revokeObjectURL=URL.revokeObjectURL;Object.defineProperty(w,'crypto',{value:globalThis.crypto});w.Image=class{naturalWidth=1;naturalHeight=1;decode(){return photoDecoder();}};}
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  if(stored)w.localStorage.setItem('weather-layer-v1',JSON.stringify({city:{name:'杭州',latitude:30.27,longitude:120.15},sensitivity:'normal'}));
  if(savedOutfits!==undefined)w.localStorage.setItem(OUTFIT_STORAGE_KEY,savedOutfits);
  if(bodyProfile!==undefined)w.localStorage.setItem(PROFILE_KEY,bodyProfile);
  w.fetch=fetchWeather;w.eval(code);await flush();
  return {w,$:id=>w.document.getElementById(id)};
}
test('tomorrow UI explicitly labels forecasts and keeps seven days, no current required',async t=>{
  const data=fixture();delete data.current;
  const {w,$}=await page(t,{fetchWeather:()=>Response.json(data)});
  w.document.querySelector('[data-day="1"]').click();
  assert.match($('advice-title').textContent,/明天/);assert.match($('reading-type').textContent,/预报/);
  assert.match($('sun-date').textContent,new RegExp(addDays(localDate('Asia/Shanghai'),1)));assert.equal($('uv-value').textContent,'8');
  assert.equal($('forecast').children.length,7);assert.match($('method-note').textContent,/最低体感 10°/);
});
test('refresh keeps existing cards while pending and after a failure',async t=>{
  let calls=0,reject;
  const { $ }=await page(t,{fetchWeather:()=>++calls===1?Response.json(fixture()):new Promise((r,j)=>{reject=j;})});
  const headline=$('advice-title').textContent;$('refresh').click();await flush();
  assert.equal($('dashboard').hidden,false);assert.equal($('loading-shell').hidden,true);assert.equal($('advice-title').textContent,headline);
  reject(new TypeError('offline'));await flush();assert.equal($('dashboard').hidden,false);assert.match($('status').textContent,/上次查询/);assert.equal($('retry-weather').hidden,false);
});
test('first-load failure exposes retry and city selection instead of a blank page',async t=>{
  const {$}=await page(t,{fetchWeather:()=>Promise.reject(new TypeError('offline'))});
  assert.equal($('dashboard').hidden,true);assert.equal($('welcome').hidden,false);assert.equal($('retry-weather').hidden,false);assert.equal($('loading-shell').hidden,true);
});
test('missing UV and clothing data retain all independently available information',async t=>{
  const data=fixture();data.daily.uv_index_max=[];data.hourly.apparent_temperature=[];
  const {$}=await page(t,{fetchWeather:()=>Response.json(data)});
  assert.equal($('uv-value').textContent,'信息暂缺');assert.equal($('uv-marker').hidden,true);
  assert.match($('outfit-items').textContent,/暂缺/);assert.equal($('current-temp').textContent,'24');assert.equal($('forecast').children.length,7);
  assert.equal($('outfit-explanation').hidden,true);
});
test('hour details work with click, arrows, Home and End',async t=>{
  const {w,$}=await page(t);const buttons=[...$('hourly-chart').querySelectorAll('button')];
  buttons[2].click();assert.match($('hour-detail').textContent,/13:00/);
  buttons[2].dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.match($('hour-detail').textContent,/16:00/);
  buttons[3].dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.match($('hour-detail').textContent,/21:00/);
  buttons[5].dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert.match($('hour-detail').textContent,/07:00/);
});
test('theme changes do not change weather date or overwrite the existing preference key',async t=>{
  const {w,$}=await page(t);w.eval(readFileSync(`${root}theme.js`,'utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  w.document.querySelector('[data-day="1"]').click();const headline=$('advice-title').textContent,stored=w.localStorage.getItem('weather-layer-v1');
  w.document.querySelector('button[data-theme="dark"]').click();assert.equal(w.document.documentElement.dataset.theme,'dark');
  assert.equal($('advice-title').textContent,headline);assert.equal(w.localStorage.getItem('weather-layer-v1'),stored);
  assert.equal(w.localStorage.getItem('weather-layer-theme-v1'),'dark');
});
test('prominent range reminder follows selected dates, coexists with cooling, and keeps clothing rules',async t=>{
  const data=fixture();
  // Tomorrow is 12 degrees across the day and 8 degrees colder than today.
  const {w,$}=await page(t,{fetchWeather:()=>Response.json(data)});
  assert.equal($('temperature-alert').hidden,true);
  w.document.querySelector('[data-day="1"]').click();
  assert.equal($('temperature-alert').hidden,false);
  assert.match($('temperature-alert-title').textContent,/12°C/);
  assert.match($('tips').textContent,/比前一天低 8/);
  assert.match($('outfit-items').textContent,/厚外套/);
  w.document.querySelector('[data-day="0"]').click();
  assert.equal($('temperature-alert').hidden,true);
  assert.equal($('temperature-alert-title').textContent,'');
});
test('changing cities removes a previous city range reminder when data is missing',async t=>{
  let calls=0;
  const {w,$}=await page(t,{fetchWeather:()=>{
    const data=fixture();
    data.daily.temperature_2m_max[1]=++calls===1?31:null;
    return Response.json(data);
  }});
  assert.equal($('temperature-alert').hidden,false);
  $('city-button').click();
  [...$('search-results').querySelectorAll('button')].find(b=>b.textContent.startsWith('北京')).click();
  await flush();
  assert.equal($('city-label').textContent,'北京');
  assert.equal($('temperature-alert').hidden,true);
});
test('production HTML has no fixture script and all asset paths retain the Pages prefix',()=>{
  const html=readFileSync(`${root}index.html`,'utf8');assert(!html.includes('visual-fixtures'));
  for(const match of html.matchAll(/(?:src|href)="(\.[^"]+)"/g))assert(new URL(match[1],'https://example.com/weather-layer/').pathname.startsWith('/weather-layer/'));
});
test('period selection changes only the explicitly labelled outfit and supports keyboard navigation',async t=>{
  const {w,$}=await page(t);
  const hero=$('advice-title').textContent,forecast=$('forecast').innerHTML,stored=w.localStorage.getItem('weather-layer-v1');
  const periods=[...$('outfit-periods').querySelectorAll('button')];
  periods[2].click();
  assert.match($('outfit-basis').textContent,/11–16 时.*22°/);
  assert.equal(periods[2].getAttribute('aria-pressed'),'true');
  assert.match($('outfit-period-note').textContent,/仅按白天/);
  assert.equal($('advice-title').textContent,hero);assert.equal($('forecast').innerHTML,forecast);
  assert.equal(w.localStorage.getItem('weather-layer-v1'),stored);
  periods[2].dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true}));
  assert.match($('outfit-basis').textContent,/18–21 时.*18°/);
  assert.equal(w.document.activeElement,periods[3]);
  periods[3].dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true}));
  assert.match($('outfit-basis').textContent,/07–21 时.*18°/);
});
test('period selection keeps sensitivity, resets on a new date or city and reflects the target date',async t=>{
  const {w,$}=await page(t);
  w.document.querySelector('[data-outfit-period="daytime"]').click();
  w.document.querySelector('[data-sensitivity="warm"]').click();
  assert.equal(w.document.querySelector('[data-outfit-period="daytime"]').getAttribute('aria-pressed'),'true');
  assert.match($('outfit-items').textContent,/透气短袖/);
  w.document.querySelector('[data-day="1"]').click();
  assert.equal($('wardrobe-title').textContent,'明日穿搭推荐');
  assert.match($('outfit-basis').textContent,new RegExp(addDays(localDate('Asia/Shanghai'),1)));
  assert.equal(w.document.querySelector('[data-outfit-period="all"]').getAttribute('aria-pressed'),'true');
  w.document.querySelector('[data-outfit-period="evening"]').click();
  $('city-button').click();
  [...$('search-results').querySelectorAll('button')].find(button=>button.textContent.startsWith('北京')).click();await flush();
  assert.equal(w.document.querySelector('[data-outfit-period="all"]').getAttribute('aria-pressed'),'true');
});
test('missing periods are disabled; usable accessories remain and a refresh clears unavailable selections',async t=>{
  let calls=0;
  const {w,$}=await page(t,{fetchWeather:()=>{
    const data=fixture();
    if(++calls>1)data.hourly.apparent_temperature=[];
    return Response.json(data);
  }});
  w.document.querySelector('[data-outfit-period="morning"]').click();
  $('refresh').click();await flush();
  const periods=[...$('outfit-periods').querySelectorAll('button')];
  assert.equal(periods[0].getAttribute('aria-pressed'),'true');
  assert(periods.slice(1).every(button=>button.disabled));
  assert.match($('outfit-basis').textContent,/体感信息暂缺/);
  assert.match($('outfit-items').textContent,/暂缺/);assert.match($('carry-items').textContent,/雨伞/);
});
test('out-of-date forecast explains the missing target date without inventing an outfit',async t=>{
  const data=fixture();data.daily.time=[];data.hourly.time=[];
  const {w,$}=await page(t,{fetchWeather:()=>Response.json(data)});
  assert.match($('hero-reason').textContent,new RegExp(`不含 ${localDate('Asia/Shanghai')}`));
  assert.match($('outfit-basis').textContent,/信息暂缺/);
  assert.equal(w.document.querySelectorAll('#outfit-items img').length,0);
});
async function closetFixture(){
  const factory=new IDBFactory();
  await new Promise((resolve,reject)=>{
    const request=factory.open('weather-layer-closet-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('clothes',{keyPath:'id'});
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('clothes','readwrite');
      for(const [id,kind,name] of [['shirt','tshirt','我的 <蓝色> T恤'],['shirt-2','longsleeve','备用薄长袖'],['outer','light-jacket','米色薄外套'],['pants','trousers','轻薄长裤']])tx.objectStore('clothes').put({id,kind,name,thickness:'light',photo:new Blob(['photo'],{type:'image/jpeg'}),updatedAt:1});
      tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
    };
  });return factory;
}
test('saved photos become owned outfit cards, names are escaped, swaps work, and reload retains the closet',async t=>{
  const closetDB=await closetFixture(),{w,$}=await page(t,{closetDB});
  assert.match($('closet-summary').textContent,/你的 3 件/);
  assert.equal($('outfit-items').querySelectorAll('[data-owned=true] img').length,3);
  assert([...$('outfit-items').querySelectorAll('img')].every(img=>img.src.startsWith('blob:')));
  assert(!$('outfit-items').querySelector('蓝色'));
  const first=$('outfit-items').textContent;$('closet-variation').click();assert.notEqual($('outfit-items').textContent,first);
  assert.match($('carry-items').textContent,/衣橱暂缺/);
  const again=await page(t,{closetDB});assert.match(again.$('closet-open-label').textContent,/4/);
  assert.equal(again.$('outfit-items').querySelectorAll('[data-owned=true] img').length,3);
});
test('editing and reversible removal update actual owned recommendations without changing weather',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture()});
  const forecast=$('forecast').innerHTML;
  w.document.querySelector('.closet-open').click();await flush();
  $('closet-grid').querySelector('[data-edit-clothes="outer"]').click();
  $('closet-name').value='保暖厚外套';$('closet-kind').value='coat';$('closet-thickness').value='warm';
  $('closet-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();
  assert.match($('closet-summary').textContent,/你的 2 件/);assert.match($('outfit-items').textContent,/建议单品 · 衣橱暂缺/);
  $('closet-grid').querySelector('[data-remove-clothes="pants"]').click();await flush();
  assert.match($('closet-summary').textContent,/你的 1 件/);
  $('closet-filter-removed').click();$('closet-grid').querySelector('[data-restore-clothes="pants"]').click();await flush();
  assert.match($('closet-summary').textContent,/你的 2 件/);assert.equal($('forecast').innerHTML,forecast);
});
test('closet search, category and thickness filters compose and clear without changing the selected outfit',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture()}),outfitBefore=$('outfit-items').textContent;
  w.document.querySelector('.closet-open').click();await flush();
  $('closet-group').value='outer';$('closet-group').dispatchEvent(new w.Event('change'));
  $('closet-weight-filter').value='light';$('closet-weight-filter').dispatchEvent(new w.Event('change'));
  $('closet-search').value='米色';$('closet-search').dispatchEvent(new w.Event('input'));
  assert.match($('closet-result-count').textContent,/1 \/ 4/);assert.equal($('closet-grid').querySelectorAll('article').length,1);
  assert.match($('closet-export').textContent,/筛选的 1 件/);
  $('closet-search').value='不存在';$('closet-search').dispatchEvent(new w.Event('input'));
  assert.match($('closet-grid').textContent,/没有符合筛选/);assert($('closet-export').disabled);
  $('closet-clear-filters').click();assert.match($('closet-result-count').textContent,/4 \/ 4/);
  assert.equal($('outfit-items').textContent,outfitBefore);
});
test('outfit explanations follow the selected date, period and sensitivity and distinguish owned items from gaps',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture()});
  assert.match($('outfit-match-reasons').textContent,/你标注/);assert.equal($('outfit-match-reasons').querySelector('蓝色'),null);
  w.document.querySelector('[data-day="1"]').click();w.document.querySelector('[data-outfit-period="morning"]').click();
  w.document.querySelector('[data-sensitivity="cold"]').click();
  assert.match($('outfit-explanation-basis').textContent,new RegExp(addDays(localDate('Asia/Shanghai'),1)));
  assert.match($('outfit-explanation-basis').textContent,/07–09 时/);assert.match($('outfit-explanation-basis').textContent,/怕冷/);
  assert.match($('outfit-match-reasons').textContent,/没有类型和厚薄都合适/);
});
const waitUntil=async condition=>{for(let i=0;i<100;i++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('UI did not settle');};
async function stageBackup(w,$,text){
  Object.defineProperty($('closet-backup-input'),'files',{configurable:true,value:[{name:'测试备份.json',size:new Blob([text]).size,text:async()=>text}]});
  $('closet-backup-input').dispatchEvent(new w.Event('change'));await waitUntil(()=>$('closet-restore-panel').getAttribute('aria-busy')==='false');
}
test('backup recovery is reviewable, preserves existing clothes and becomes available only after confirmation',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture()});
  w.document.querySelector('.closet-open').click();await flush();
  $('closet-group').value='outer';$('closet-group').dispatchEvent(new w.Event('change'));
  const text=await createClosetBackup([{id:'new-coat',name:'测试备份外套',kind:'coat',thickness:'warm',photo:new Blob([readFileSync(`${root}icons/icon-192.png`)],{type:'image/png'})}]);
  await stageBackup(w,$,text);assert.equal($('closet-restore-panel').hidden,false);assert.match($('closet-restore-counts').textContent,/新增 1 件/);
  assert.match($('closet-count').textContent,/4 件/);assert.equal($('closet-grid').querySelectorAll('article').length,1);
  $('closet-restore-confirm').click();await waitUntil(()=>$('closet-message').textContent.includes('恢复完成'));
  assert.match($('closet-count').textContent,/5 件/);assert.match($('closet-grid').textContent,/测试备份外套/);
  assert.equal($('closet-group').value,'all');
  await stageBackup(w,$,text);assert.match($('closet-restore-counts').textContent,/跳过相同衣物 1 件/);
  $('closet-restore-confirm').click();await waitUntil(()=>$('closet-message').textContent.includes('恢复完成'));
  assert.match($('closet-count').textContent,/5 件/);
});
test('invalid backup data and cancellation leave the local closet unchanged',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture()});w.document.querySelector('.closet-open').click();await flush();
  await stageBackup(w,$,'{"format":"other","items":[]}');
  assert.equal($('closet-message').dataset.error,'true');assert.equal($('closet-restore-panel').hidden,true);assert.match($('closet-count').textContent,/4 件/);
  const text=await createClosetBackup([{id:'new-coat',name:'不应写入',kind:'coat',thickness:'warm',photo:new Blob([readFileSync(`${root}icons/icon-192.png`)],{type:'image/png'})}]);
  await stageBackup(w,$,text);$('closet-restore-cancel').click();
  assert.equal($('closet-restore-panel').hidden,true);assert.match($('closet-message').textContent,/已取消/);assert.match($('closet-count').textContent,/4 件/);
});
test('undecodable backup photos are rejected before the recovery review or any write',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture(),photoDecoder:()=>Promise.reject(Object.assign(new Error('bad image'),{name:'EncodingError'}))});
  w.document.querySelector('.closet-open').click();await flush();
  const text=await createClosetBackup([{id:'bad-photo',name:'不应写入',kind:'coat',thickness:'warm',photo:new Blob([readFileSync(`${root}icons/icon-192.png`)],{type:'image/png'})}]);
  await stageBackup(w,$,text);assert.equal($('closet-restore-panel').hidden,true);
  assert.match($('closet-message').textContent,/无法读取的照片/);assert.match($('closet-count').textContent,/4 件/);
});
test('closing during backup reading cancels stale results and clears the processing message',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture()});w.document.querySelector('.closet-open').click();await flush();
  let release;const text=new Promise(resolve=>{release=resolve;});
  Object.defineProperty($('closet-backup-input'),'files',{configurable:true,value:[{name:'测试备份.json',size:20,text:()=>text}]});
  $('closet-backup-input').dispatchEvent(new w.Event('change'));$('closet-dialog').close();release('{"format":"other"}');await flush();
  assert.equal($('closet-restore-panel').hidden,true);assert.equal($('closet-message').textContent,'');assert.match($('closet-count').textContent,/4 件/);
});
test('unavailable browser storage disables wardrobe backup actions while keeping weather usable',async t=>{
  const {$}=await page(t);
  assert.equal($('dashboard').hidden,false);assert.equal($('forecast').children.length,7);
  assert($('closet-add').disabled);assert($('closet-export').disabled);assert($('closet-import-backup').disabled);
  assert.match($('closet-message').textContent,/无法使用本机衣橱存储/);
});

test('single item picker preserves other garments, closes accessibly, and remains a draft until explicitly saved',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture()});
  const before=[...$('outfit-items').querySelectorAll('article>strong')].map(x=>x.textContent);
  const opener=$('outfit-items').querySelector('[data-pick-slot]');opener.focus();opener.click();
  assert($('outfit-picker').open);assert.equal(w.document.activeElement.id,'outfit-picker-title');
  assert.equal($('outfit-picker-items').querySelectorAll('button').length,2);assert.match($('outfit-picker-context').textContent,/杭州/);
  assert(!$('outfit-picker-items').querySelector('蓝色'));
  $('outfit-picker-items').querySelector('[aria-pressed=false]').click();
  assert(!$('outfit-picker').open);assert.equal(w.document.activeElement.dataset.pickSlot,'wear:tshirt');
  const after=[...$('outfit-items').querySelectorAll('article>strong')].map(x=>x.textContent);
  assert.notEqual(after[0],before[0]);assert.deepEqual(after.slice(1),before.slice(1));
  assert.equal(w.localStorage.getItem(OUTFIT_STORAGE_KEY),null);assert.match($('outfit-save-status').textContent,/尚未记住/);
  $('outfit-save').click();assert.match($('outfit-save-status').textContent,/已为 杭州/);assert($('outfit-save').disabled);
});
test('confirmed outfit survives reopening and is isolated from other dates, periods and cities',async t=>{
  const closetDB=await closetFixture(),a=await page(t,{closetDB});
  a.$('closet-variation').click();a.$('outfit-save').click();
  const saved=a.w.localStorage.getItem(OUTFIT_STORAGE_KEY),name=a.$('outfit-items').querySelector('article>strong').textContent;
  const {w,$}=await page(t,{closetDB,savedOutfits:saved});
  assert.equal($('outfit-items').querySelector('article>strong').textContent,name);assert($('outfit-save').disabled);
  w.document.querySelector('[data-outfit-period=morning]').click();assert.equal($('outfit-forget').hidden,true);
  w.document.querySelector('[data-outfit-period=all]').click();assert.equal($('outfit-items').querySelector('article>strong').textContent,name);
  w.document.querySelector('[data-day="1"]').click();assert.equal($('outfit-forget').hidden,true);
  w.document.querySelector('[data-day="0"]').click();assert.equal($('outfit-items').querySelector('article>strong').textContent,name);
  $('city-button').click();[...$('search-results').querySelectorAll('button')].find(b=>b.textContent.startsWith('北京')).click();await flush();
  assert.equal($('outfit-forget').hidden,true);assert.equal(w.localStorage.getItem(OUTFIT_STORAGE_KEY),saved);
});
test('saved outfit invalidates after clothing rules change or saved clothes are removed',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture()});$('outfit-save').click();
  const saved=w.localStorage.getItem(OUTFIT_STORAGE_KEY);
  w.document.querySelector('[data-sensitivity=cold]').click();assert.match($('outfit-save-status').textContent,/需要重新确认/);assert.equal($('outfit-save').disabled,false);
  w.document.querySelector('[data-sensitivity=normal]').click();assert($('outfit-save').disabled);assert.match($('outfit-save-status').textContent,/已为/);
  w.document.querySelector('.closet-open').click();await flush();$('closet-grid').querySelector('[data-remove-clothes=outer]').click();await flush();
  assert.match($('outfit-save-status').textContent,/衣橱已变化/);assert.equal(w.localStorage.getItem(OUTFIT_STORAGE_KEY),saved);
  assert.match($('outfit-items').textContent,/衣橱暂缺/);assert.equal($('outfit-save').disabled,false);
});
test('save failures and corrupted records are visible without losing the draft or weather',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture()});$('closet-variation').click();const selected=$('outfit-items').textContent;
  const set=w.Storage.prototype.setItem;w.Storage.prototype.setItem=function(key,value){if(key===OUTFIT_STORAGE_KEY)throw new w.DOMException('quota','QuotaExceededError');return set.call(this,key,value);};
  $('outfit-save').click();assert.match($('outfit-save-status').textContent,/保存失败/);assert.equal($('outfit-items').textContent,selected);assert.equal(w.localStorage.getItem(OUTFIT_STORAGE_KEY),null);
  w.Storage.prototype.setItem=set;$('outfit-save').click();assert.match($('outfit-save-status').textContent,/已为/);
  const bad=await page(t,{closetDB:await closetFixture(),savedOutfits:'broken'});assert(bad.$('outfit-save').disabled);assert.match(bad.$('outfit-save-status').textContent,/无法读取/);assert.equal(bad.$('forecast').children.length,7);
});
test('revert and forget affect only the current outfit, leaving the wardrobe intact',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture()});$('outfit-save').click();const saved=$('outfit-items').textContent;
  $('closet-variation').click();assert.notEqual($('outfit-items').textContent,saved);$('outfit-revert').click();assert.equal($('outfit-items').textContent,saved);
  $('outfit-forget').click();assert.deepEqual(JSON.parse(w.localStorage.getItem(OUTFIT_STORAGE_KEY)).entries,[]);assert.match($('outfit-save-status').textContent,/已取消记住/);assert.match($('closet-open-label').textContent,/4/);
});
test('missing forecast data disables saved-outfit confirmation and picker controls',async t=>{
  const closetDB=await closetFixture(),a=await page(t,{closetDB});a.$('outfit-save').click();
  const data=fixture();data.hourly.apparent_temperature=[];
  const {$}=await page(t,{closetDB,savedOutfits:a.w.localStorage.getItem(OUTFIT_STORAGE_KEY),fetchWeather:()=>Response.json(data)});
  assert($('outfit-save').disabled);assert.equal($('outfit-items').querySelectorAll('[data-pick-slot]').length,0);assert.match($('outfit-save-status').textContent,/体感信息暂缺/);
});
test('storage events recheck other-tab saved choices without overwriting an unsaved local adjustment',async t=>{
  const closetDB=await closetFixture(),{w,$}=await page(t,{closetDB});$('outfit-save').click();const first=w.localStorage.getItem(OUTFIT_STORAGE_KEY);
  $('closet-variation').click();const draft=$('outfit-items').textContent;
  w.dispatchEvent(new w.StorageEvent('storage',{key:OUTFIT_STORAGE_KEY,newValue:first}));
  assert.equal($('outfit-items').textContent,draft);assert.match($('outfit-save-status').textContent,/另一页面/);
  $('outfit-revert').click();assert.notEqual($('outfit-items').textContent,draft);
});

test('weather changes close an outdated picker and focus a stable current-period control',async t=>{
  let calls=0;
  const {w,$}=await page(t,{closetDB:await closetFixture(),fetchWeather:()=>{const data=fixture();if(++calls>1)data.hourly.apparent_temperature=data.hourly.time.map(()=>7);return Response.json(data);}});
  $('outfit-items').querySelector('[data-pick-slot]').click();assert($('outfit-picker').open);
  $('refresh').click();await flush();assert(!$('outfit-picker').open);
  assert.equal(w.document.activeElement.dataset.outfitPeriod,'all');assert.match($('outfit-items').textContent,/厚外套/);
  assert(!w.document.body.classList.contains('modal-open'));
});

const fakeProfile=(values={})=>JSON.stringify({version:1,height:170,weight:65,chest:null,waist:null,hips:null,preference:'relaxed',revision:'test-revision',...values});
function submit(w,form){form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));}
async function editGarmentSizing(w,$,id,{fit='unknown',label='',ranges={}}={}){
  if(!$('closet-dialog').open){w.document.querySelector('.closet-open').click();await flush();}
  $('closet-grid').querySelector(`[data-edit-clothes="${id}"]`).click();
  $('closet-size-label').value=label;$('closet-wear-fit').value=fit;
  for(const [key,range] of Object.entries(ranges))for(const side of ['min','max'])$(`closet-range-${key}-${side}`).value=range[side]??'';
  submit(w,$('closet-form'));await flush();
}
test('body profile is optional, only applies on save, keeps weather preferences, and does not refetch or transmit measurements',async t=>{
  let fetches=0;const {w,$}=await page(t,{closetDB:await closetFixture(),fetchWeather:()=>{fetches++;return Response.json(fixture());}});
  const weather=w.localStorage.getItem('weather-layer-v1');w.document.querySelector('.profile-entry [data-open-profile]').click();
  $('profile-height').value='170';$('profile-weight').value='65';assert.equal(w.localStorage.getItem(PROFILE_KEY),null);
  submit(w,$('profile-form'));assert(!$('profile-dialog').open);const saved=JSON.parse(w.localStorage.getItem(PROFILE_KEY));
  assert.equal(saved.height,170);assert.equal(saved.weight,65);assert.equal(saved.chest,null);assert.equal(fetches,1);assert.equal(w.localStorage.getItem('weather-layer-v1'),weather);
  assert.match(w.document.querySelector('[data-profile-summary]').textContent,/2 项/);assert.match($('outfit-fit-note').textContent,/暂无可对照/);
});
test('profile drafts are cancelled on reopen and invalid input does not overwrite prior data',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture(),bodyProfile:fakeProfile()});
  w.document.querySelector('.profile-entry [data-open-profile]').click();$('profile-height').value='180';$('profile-dialog').scrollTop=500;$('profile-dialog').close();
  w.document.querySelector('.profile-entry [data-open-profile]').click();assert.equal($('profile-height').value,'170');assert.equal($('profile-dialog').scrollTop,0);
  const before=w.localStorage.getItem(PROFILE_KEY);$('profile-height').value='0';submit(w,$('profile-form'));assert.equal(w.localStorage.getItem(PROFILE_KEY),before);assert($('profile-dialog').open);
});
test('height/weight ranges change real owned selection, preserve weather, and labels persist through editing',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture(),bodyProfile:fakeProfile()});const forecast=$('forecast').innerHTML;
  await editGarmentSizing(w,$,'shirt',{fit:'regular',label:'S',ranges:{height:{max:160},weight:{max:60}}});
  assert.match($('outfit-items').textContent,/备用薄长袖/);assert(!$('outfit-items').textContent.includes('我的 <蓝色> T恤'));
  assert.match($('closet-grid').textContent,/超出已填适用范围/);$('closet-fit-only').click();assert.match($('closet-result-count').textContent,/3 \/ 4/);assert.match($('closet-export').textContent,/3 件/);
  $('closet-clear-filters').click();$('closet-grid').querySelector('[data-edit-clothes=shirt]').click();assert.equal($('closet-size-label').value,'S');assert.equal($('closet-range-height-max').value,'160');assert.equal($('forecast').innerHTML,forecast);
});
test('actual comfort ranking and preference appear in daily explanations without changing temperature thresholds',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture(),bodyProfile:fakeProfile()});
  await editGarmentSizing(w,$,'shirt',{fit:'relaxed',label:'M',ranges:{height:{min:160,max:180},weight:{min:55,max:75}}});
  assert.match($('outfit-items').textContent,/符合穿着偏好/);assert.match($('outfit-match-reasons').textContent,/身高、体重在已填适用范围/);assert.match($('outfit-fit-note').textContent,/1 件/);
  assert.equal($('uv-value').textContent,'2');assert.equal($('forecast').children.length,7);
});
test('invalid clothing range fails without discarding the photo draft or changing old recommendations',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture()});const before=$('outfit-items').textContent;
  await editGarmentSizing(w,$,'outer',{ranges:{height:{min:190,max:160}}});
  assert(!$('closet-form').hidden);assert.match($('closet-message').textContent,/下限不能大于上限/);assert.equal($('outfit-items').textContent,before);
});
test('profile removal can be undone locally and never removes garment records',async t=>{
  const raw=fakeProfile(),{w,$}=await page(t,{closetDB:await closetFixture(),bodyProfile:raw});
  w.document.querySelector('.profile-entry [data-open-profile]').click();$('profile-clear').click();assert.equal(w.localStorage.getItem(PROFILE_KEY),null);assert(!$('profile-undo').hidden);
  assert.match($('closet-open-label').textContent,/4/);$('profile-undo').click();assert.equal(w.localStorage.getItem(PROFILE_KEY),raw);assert.equal($('profile-height').value,'170');
});
test('profile write denial leaves the current saved data applied and the edit open',async t=>{
  const raw=fakeProfile(),{w,$}=await page(t,{closetDB:await closetFixture(),bodyProfile:raw});
  w.document.querySelector('.profile-entry [data-open-profile]').click();$('profile-weight').value='66';
  const set=w.Storage.prototype.setItem;w.Storage.prototype.setItem=function(key,value){if(key===PROFILE_KEY)throw new w.DOMException('denied','SecurityError');return set.call(this,key,value);};
  submit(w,$('profile-form'));assert($('profile-dialog').open);assert.match($('profile-message').textContent,/保存失败/);assert.equal(w.localStorage.getItem(PROFILE_KEY),raw);w.Storage.prototype.setItem=set;
});
test('corrupted body records preserve weather and show a clear unapplied state',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture(),bodyProfile:'broken'});assert.equal($('forecast').children.length,7);assert.match($('outfit-fit-note').textContent,/无法读取/);
  w.document.querySelector('.profile-entry [data-open-profile]').click();assert.match($('profile-message').textContent,/原记录仍保留/);assert.equal(w.localStorage.getItem(PROFILE_KEY),'broken');
});
test('profile opens from inside the wardrobe; closing or Back keeps the parent modal locked and returns focus',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture()});w.document.querySelector('.closet-open').click();await flush();
  $('closet-dialog').querySelector('[data-open-profile]').focus();$('closet-dialog').querySelector('[data-open-profile]').click();assert($('profile-dialog').open&&$('closet-dialog').open);
  $('profile-dialog').close();assert($('closet-dialog').open);assert(w.document.body.classList.contains('modal-open'));assert.equal(w.document.activeElement,$('closet-dialog').querySelector('[data-open-profile]'));
  $('closet-dialog').querySelector('[data-open-profile]').click();w.history.replaceState({weatherDialog:'closet-dialog'},'',w.location.href);w.dispatchEvent(new w.PopStateEvent('popstate',{state:{weatherDialog:'closet-dialog'}}));
  assert(!$('profile-dialog').open);assert($('closet-dialog').open);assert(w.document.body.classList.contains('modal-open'));
  $('closet-dialog').close();assert(!w.document.body.classList.contains('modal-open'));
});
test('profile changes invalidate remembered outfits without storing raw body data in outfit records',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture(),bodyProfile:fakeProfile()});$('outfit-save').click();
  const record=JSON.parse(w.localStorage.getItem(OUTFIT_STORAGE_KEY)).entries[0];assert(!Object.hasOwn(record,'height'));assert(!Object.hasOwn(record,'weight'));assert(JSON.parse(record.signature).some(value=>value?.profileRevision==='test-revision'));
  w.localStorage.setItem(PROFILE_KEY,fakeProfile({height:175,revision:'changed-revision'}));w.dispatchEvent(new w.StorageEvent('storage',{key:PROFILE_KEY}));
  assert.match($('outfit-save-status').textContent,/穿衣档案已变化/);
});
test('another-tab profile changes cannot be overwritten by a stale open form',async t=>{
  const {w,$}=await page(t,{closetDB:await closetFixture(),bodyProfile:fakeProfile()});
  w.document.querySelector('.profile-entry [data-open-profile]').click();$('profile-height').value='180';
  const changed=fakeProfile({height:175,revision:'latest'});w.localStorage.setItem(PROFILE_KEY,changed);w.dispatchEvent(new w.StorageEvent('storage',{key:PROFILE_KEY}));
  submit(w,$('profile-form'));assert.equal(w.localStorage.getItem(PROFILE_KEY),changed);assert.match($('profile-message').textContent,/避免覆盖/);
  $('profile-reset').click();assert.equal($('profile-height').value,'175');
});
