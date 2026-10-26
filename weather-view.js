import { finite, temp, escapeHTML as esc, describeWeather, summarize, outfit, dayHours } from './shared/weather.js';
import { localDate, addDays } from './shared/dates.js';
import { modules } from './shared/briefing.js?v=20261025-fit4';
import { temperatureAlert } from './shared/temperature-alert.js';
import { scenes, weatherScene, outfitHeadlines } from './visuals.js?v=20261025-fit4';
import { renderOutfit } from './outfit-view.js?v=20261025-fit4';
const $ = id => document.getElementById(id);
export function formatDate(date, options = {}) {
  return new Intl.DateTimeFormat('zh-CN', { month:'long', day:'numeric', weekday:'long', timeZone:'UTC', ...options }).format(new Date(`${date}T12:00:00Z`));
}
export function dayView(weather, day, sensitivity, now = Date.now()) {
  const today = localDate(weather.timezone, now), date = addDays(today, day);
  let report;
  try { report = summarize(weather, date, sensitivity); }
  catch { report = { date, index:-1, hours:dayHours(weather,date), advice:outfit(null), low:null, high:null, basis:null, morning:null, evening:null, change:null, rain:null, wind:null }; }
  const isCurrent = day === 0 && weather.current?.time?.startsWith(date) && finite(weather.current?.temperature_2m);
  const code = isCurrent ? weather.current.weather_code : weather.daily?.weather_code?.[report.index];
  const sun = modules.sun(weather, date);
  return {today,date,day,report,sun,isCurrent,code,scene:weatherScene(code, isCurrent && weather.current.is_day === 0),
    temperature:isCurrent ? weather.current.temperature_2m : report.high};
}
export function forecastRows(weather, today, count = 7) {
  const daily = weather.daily ?? {};
  const rows = Array.from({length:count},(_,offset) => {
    const date = addDays(today,offset), i = daily.time?.indexOf(date) ?? -1;
    return {date,offset,low:daily.temperature_2m_min?.[i],high:daily.temperature_2m_max?.[i],code:daily.weather_code?.[i]};
  });
  const values = rows.flatMap(r=>[r.low,r.high]).filter(finite);
  const min = values.length ? Math.min(...values) : null, max = values.length ? Math.max(...values) : null;
  return rows.map(r=>({...r,start:finite(r.low)&&finite(r.high)&&r.high>=r.low ? (r.low-min)/Math.max(1,max-min)*100 : null,
    range:finite(r.low)&&finite(r.high)&&r.high>=r.low ? (r.high-r.low)/Math.max(1,max-min)*100 : null}));
}
const reasons = {
  '厚衣保暖':'把暖意穿在身上，护好早晚的凉。', '记得添衣':'早晚偏凉，外层方便穿脱。',
  '轻薄叠穿':'一件轻薄外层，照顾早晚的温差。', '无需特意添衣':'透气又轻盈，穿得舒服一点。',
  '清凉出门':'衣物轻一点，出门记得补水。', '暂不判断':'可靠的数据回来后，再为你选一身。'
};
export function renderWeather(weather, city, view, fetchedAt, sensitivity='normal') {
  const {report:r,date,today,day,isCurrent,temperature,code,scene,sun} = view, dayName = day ? '明天' : '今天';
  document.querySelectorAll('[data-day]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.day)===day)));
  $('today-tab-date').textContent=today.slice(5).replace('-','/'); $('tomorrow-tab-date').textContent=addDays(today,1).slice(5).replace('-','/');
  $('date-label').textContent=`${city.name} · ${formatDate(date)}`;
  const headline = finite(r.basis) ? outfitHeadlines[r.advice.title] ?? r.advice.title : '添衣建议暂缺。';
  $('advice-title').innerHTML=`<span class="hero-prefix">${dayName}，</span><span class="hero-conclusion">${esc(headline)}</span>`;
  $('hero-reason').textContent=r.index<0?`返回的预报不含 ${date} 的数据。请更新天气，或稍后再试。`:reasons[r.advice.label] ?? r.advice.description;
  $('advice-badge').textContent=r.advice.label;
  $('weather-window').dataset.scene=scene;
  if ($('weather-scene').getAttribute('src')!==scenes[scene]) $('weather-scene').src=scenes[scene];
  $('current-temp').textContent=finite(temperature)?Math.round(temperature):'—';
  $('weather-description').textContent=describeWeather(code)[0];
  $('reading-type').textContent=isCurrent?`当前实况 · 体感 ${temp(weather.current.apparent_temperature)}`:`${dayName}最高气温 · 预报`;
  $('temp-range').textContent=`${temp(r.low)} / ${temp(r.high)}`;
  const rangeAlert = temperatureAlert(r);
  $('temperature-alert').hidden = !rangeAlert;
  $('temperature-alert-title').textContent = rangeAlert?.title ?? '';
  $('temperature-alert-text').textContent = rangeAlert?.text ?? '';
  $('temperature-alert-detail').textContent = rangeAlert?.detail ? `${rangeAlert.detail}（预报）` : '';
  $('temperature-alert-detail').hidden = !rangeAlert?.detail;
  const fetched=new Intl.DateTimeFormat('zh-CN',{timeZone:weather.timezone,hour:'2-digit',minute:'2-digit',hour12:false}).format(fetchedAt);
  $('updated-at').textContent=`${isCurrent ? `${weather.current.time.slice(11,16)} 实况` : `${date} 预报`} · ${weather.timezone}`;
  renderOutfit(r,sun,day,date,sensitivity,`${city.latitude},${city.longitude}@${weather.timezone}`,city.name);
  $('sun-date').textContent=`${date} · ${dayName}最高紫外线指数，预报值`;
  $('uv-value').textContent=sun.value ?? '信息暂缺'; $('uv-value').classList.toggle('unavailable',sun.status!=='available');
  $('uv-level').textContent=sun.level; $('uv-level').hidden=sun.status!=='available'; $('sun-advice').textContent=sun.text;
  $('uv-marker').hidden=sun.status!=='available';
  if(sun.status==='available') $('uv-marker').style.setProperty('--uv-position',`${Math.min(sun.value,11)/11*100}%`);
  $('uv-scale').setAttribute('aria-label',sun.status==='available'?`每日最高紫外线指数 ${sun.value}，${sun.level}。刻度 0、3、8、11 及以上。`:'紫外线信息暂缺，无当前指示值');
  renderHours(r);
  $('hourly-date').textContent=`${date} · 体感预报`;
  const tips=[];
  if(finite(r.change)&&r.change<=-3) tips.push(['添一层再出门',`目标日最低温比前一天低 ${Math.abs(r.change).toFixed(1)}°。`]);
  if(finite(r.wind)&&r.wind>=29) tips.push(['外层，也照顾风',`目标日最大预报风速约 ${Math.round(r.wind)} km/h，外层注意挡风。`]);
  if(finite(r.rain)&&r.rain>=50) tips.push(['出门带把伞',`目标日最高降水概率 ${Math.round(r.rain)}%，鞋子也选不怕打湿的。`]);
  $('tips').innerHTML=tips.map(([title,body])=>`<li><strong>${esc(title)}</strong>${esc(body)}</li>`).join('');
  $('forecast').innerHTML=forecastRows(weather,today).map(row=>{
    const label=row.offset===0?'今天':row.offset===1?'明天':formatDate(row.date,{month:undefined,day:undefined,weekday:'short'});
    const description=describeWeather(row.code)[0];
    return `<div class="forecast-row" data-selected="${row.date===date}"><div class="forecast-date"><strong>${label}</strong><span>${row.date.slice(5).replace('-','/')}</span></div><img class="forecast-icon" src="${scenes[weatherScene(row.code)]}" alt="${description}" width="220" height="250"><span class="forecast-low">${temp(row.low)}</span><div class="temperature-track" role="img" aria-label="${label}最低 ${temp(row.low)}，最高 ${temp(row.high)}">${row.start===null?'':`<i style="--start:${row.start}%;--range:${row.range}%"></i>`}</div><span class="forecast-high">${temp(row.high)}</span></div>`;
  }).join('');
  $('method-note').textContent=`${date} 的穿衣建议参考当地 07:00–21:00 最低体感 ${temp(r.basis)}，沿用你的体感偏好。${fetched} 查询；预报随更新可能变化，仅作日常穿搭参考。`;
}
let hourSelection=null, hourlyReport=null;
export function renderHours(r) {
  if(hourlyReport?.date!==r.date) hourSelection=null;
  hourlyReport=r;
  const points=[7,10,13,16,19,21].map(hour=>r.hours.find(h=>h.hour===hour)).filter(h=>h&&finite(h.feels));
  if(!points.length){$('hourly-chart').innerHTML='<p class="empty-note">该日期的分时体感信息暂缺。</p>';$('hour-detail').hidden=true;$('chart-caption').textContent='';return;}
  if(!points.some(p=>p.hour===hourSelection)) hourSelection=points[0].hour;
  const min=Math.min(...points.map(p=>p.feels)),max=Math.max(...points.map(p=>p.feels));
  const width=600, padding=width/points.length/2;
  const xy=points.map((p,i)=>({x:padding+i*(width-padding*2)/Math.max(1,points.length-1),y:66-(p.feels-min)*45/Math.max(6,max-min),...p}));
  $('hourly-chart').innerHTML=`<svg class="hour-curve" viewBox="0 0 600 84" preserveAspectRatio="none" aria-hidden="true"><polyline points="${xy.map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>${xy.map(p=>`<circle cx="${p.x}" cy="${p.y}" r="3" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`).join('')}</svg><div class="hour-buttons" role="group" aria-label="选择时刻查看天气详情" style="grid-template-columns:repeat(${points.length},minmax(0,1fr))">${points.map(p=>`<button class="hour-tick" data-hour="${p.hour}" aria-pressed="${hourSelection===p.hour}" aria-label="${p.hour} 点，体感 ${temp(p.feels)}"><strong>${temp(p.feels)}</strong><span>${String(p.hour).padStart(2,'0')}:00</span></button>`).join('')}</div>`;
  showHour(hourSelection);
  $('chart-caption').textContent=`早间 07–09 时最低体感 ${temp(r.morning)} · 晚间 18–21 时 ${temp(r.evening)}`;
}
function showHour(hour) {
  const p=hourlyReport?.hours.find(point=>point.hour===hour); if(!p)return;
  hourSelection=hour;
  document.querySelectorAll('[data-hour]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.hour)===hour)));
  $('hour-detail').hidden=false;
  $('hour-detail').textContent=`${hourlyReport.date} ${String(hour).padStart(2,'0')}:00 · 气温 ${temp(p.temperature)} · 体感 ${temp(p.feels)}（预报）`;
}
export function setupHourly() {
  $('hourly-chart').addEventListener('click',event=>{const button=event.target.closest('[data-hour]');if(button)showHour(Number(button.dataset.hour));});
  $('hourly-chart').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const buttons=[...$('hourly-chart').querySelectorAll('[data-hour]')], i=buttons.indexOf(event.target);if(i<0)return;
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
    buttons[next].focus();showHour(Number(buttons[next].dataset.hour));
  });
}
