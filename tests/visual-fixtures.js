// Loaded only by tests/serve-visual.py at its explicit development preview path.
// The production index never imports this file. Every screenshot shows the label.
(() => {
  if(!['127.0.0.1','localhost'].includes(location.hostname)||location.port!=='8766'||location.pathname!=='/weather-layer/__preview__/')return;
  const scenario=new URLSearchParams(location.search).get('case')||'sunny';
  const cases={sunny:'晴天',range:'昼夜温差大',rain:'雨天',night:'夜间',long:'长城市与长文案',missing:'部分数据缺失',empty:'无数据',failure:'首次请求失败',refresh:'刷新失败保留内容',loading:'加载中',first:'首次进入',large:'200% 字号'};
  const params=new URLSearchParams(location.search), theme=params.get('theme')==='dark'?'dark':'light';
  localStorage.setItem('weather-layer-theme-v1',theme);
  const largeText=scenario==='large'||params.get('font')==='large';
  const city={name:scenario==='long'?'呼和浩特市·新城区·成吉思汗大街街道（长城市名称与地区信息展示检查）':'杭州',latitude:30.2741,longitude:120.1551};
  if(scenario==='first')localStorage.removeItem('weather-layer-v1');
  else localStorage.setItem('weather-layer-v1',JSON.stringify({city,sensitivity:'normal'}));
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const dates=Array.from({length:8},(_,i)=>{const d=new Date(`${today}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+i-1);return d.toISOString().slice(0,10);});
  let calls=0,release;
  const loading=new Promise(resolve=>{release=resolve;});
  const normalFetch=window.fetch.bind(window);
  window.fetch=async(url,options)=>{
    if(!String(url).includes('api.open-meteo.com'))return normalFetch(url,options);
    if(scenario==='loading')await loading;
    calls++;
    if(scenario==='failure'||(scenario==='refresh'&&calls>1))throw new TypeError('开发预览：模拟网络不可达');
    if(scenario==='empty')return Response.json({timezone:'Asia/Shanghai'});
    const code=scenario==='rain'?63:scenario==='missing'?null:0;
    return Response.json({timezone:'Asia/Shanghai',current:scenario==='missing'?undefined:{time:`${today}T12:00`,temperature_2m:23,apparent_temperature:22,is_day:scenario==='night'?0:1,weather_code:code},
      daily:{time:dates,temperature_2m_min:dates.map((_,i)=>scenario==='range'&&i===1?8:16+i%3),temperature_2m_max:dates.map((_,i)=>[23,25,26,27,25,22,24,23][i]),weather_code:dates.map((_,i)=>scenario==='rain'?63:[0,2,3,61,0,2,3,1][i]),uv_index_max:dates.map(()=>scenario==='missing'?null:scenario==='rain'?2.6:6.2),precipitation_probability_max:dates.map(()=>scenario==='rain'?80:20),wind_speed_10m_max:dates.map(()=>12)},
      hourly:{time:dates.flatMap(date=>Array.from({length:24},(_,h)=>`${date}T${String(h).padStart(2,'0')}:00`)),temperature_2m:dates.flatMap((_,i)=>Array.from({length:24},(_,h)=>scenario==='range'&&i===1?[10,9,9,8,8,8,8,9,12,15,18,21,23,25,24,23,22,20,17,15,13,11,10,9][h]:18+Math.sin(h/24*Math.PI)*8)),apparent_temperature:dates.flatMap((_,i)=>Array.from({length:24},(_,h)=>scenario==='missing'?null:scenario==='range'&&i===1?[9,8,8,7,7,7,7,8,11,14,17,20,22,24,23,22,21,19,16,14,12,10,9,8][h]:18+Math.sin(h/24*Math.PI)*7))}});
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const banner=document.createElement('div');banner.id='dev-preview-banner';banner.style.cssText='position:sticky;top:0;z-index:9;background:#f3dfab;color:#453619;padding:7px 16px;font:12px/1.7 system-ui;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    const text=document.createElement('strong');text.textContent=`仅开发预览 · 模拟数据 · ${cases[scenario]||scenario}${largeText?' · 200% 字号':''}`;
    const select=document.createElement('select');select.setAttribute('aria-label','开发预览场景');select.style.cssText='font:inherit;min-height:32px;padding:3px 6px;max-width:100%';
    for(const [value,label] of Object.entries(cases)){const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=value===scenario;select.append(option);}
    select.addEventListener('change',()=>{location.search=new URLSearchParams({case:select.value,theme}).toString();});banner.append(text,select);
    const sample=document.createElement('button');sample.textContent='载入示例衣橱（仅预览）';sample.style.cssText='font:inherit;min-height:32px;padding:3px 8px';
    sample.addEventListener('click',async()=>{
      sample.disabled=true;sample.textContent='正在准备本机示例…';
      try{
        const clothes=[['tshirt','雾蓝短袖','light'],['longsleeve','奶白薄长袖','light'],['light-jacket','轻薄通勤外套','light'],['trousers','日常轻薄长裤','light'],['hat','浅色遮阳帽','light'],['umbrella','折叠雨伞','regular'],['coat','秋冬保暖外套','warm']];
        const records=[];
        for(const [kind,name,thickness] of clothes){
          const image=new Image();image.src=`./assets/clothes/${kind}.svg`;await image.decode();
          const canvas=document.createElement('canvas');canvas.width=360;canvas.height=360;const ctx=canvas.getContext('2d');ctx.fillStyle='#f2f4f8';ctx.fillRect(0,0,360,360);ctx.drawImage(image,20,20,320,320);
          const photo=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));
          records.push({id:`dev-sample-${kind}`,name:`示例 · ${name}`,kind,thickness,photo,updatedAt:Date.now(),createdAt:Date.now(),removedAt:null,sizing:{label:'',fit:'regular',ranges:{}}});
        }
        await new Promise((resolve,reject)=>{
          const request=indexedDB.open('weather-layer-closet-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('clothes',{keyPath:'id'});request.onerror=()=>reject(request.error);
          request.onsuccess=()=>{const db=request.result,tx=db.transaction('clothes','readwrite');for(const item of records)tx.objectStore('clothes').put(item);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(tx.error);};};
        });location.reload();
      }catch{sample.disabled=false;sample.textContent='示例载入失败，点击重试';}
    });banner.append(sample);
    if(scenario==='loading'){const button=document.createElement('button');button.textContent='完成模拟加载';button.addEventListener('click',()=>release());banner.append(button);}
    document.body.prepend(banner);
    if(largeText)document.documentElement.style.fontSize='32px';
    if(scenario==='long'){
      const observer=new MutationObserver(()=>{const title=document.getElementById('advice-title');if(title?.textContent&&!title.dataset.stress){title.dataset.stress='true';title.textContent='今天，带件方便穿脱的外套，照顾早晚的凉意，也给白天留一点轻松。';}});
      observer.observe(document.getElementById('advice-title'),{childList:true});
    }
  });
})();
