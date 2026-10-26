import { API_BASE } from './reminder-config.js';
import { CITIES, validCity, temp } from './shared/weather.js';
import { addDays, localDate, validDate, validZone, nextReminder, displayRun } from './shared/dates.js';
import { assembleBriefing, fetchBriefingData, WHO_SOURCE } from './shared/briefing.js?v=20261002-range1';
import { openDialog } from './dialogs.js?v=20261025-fit4';

const $ = id => document.getElementById(id);
const TOKEN_KEY = 'weather-layer-reminder-token-v1', DRAFT_KEY = 'weather-layer-reminder-draft-v1';
const STOP_KEY = 'weather-layer-reminder-stop-v1';
const base = new URL('./', import.meta.url);
let reminderCity = null, saved = null, service = null, registration = null, searchVersion = 0, previewVersion = 0, busy = false, dirty = false, pendingTestKey = null;
let pendingStop = null, recoveryDetail = '', intentStored = true;
let confirmed = false;
const states = { pending: '待执行', claimed: '准备发送', sending: '正在请求推送服务', retry: '等待重试',
  push_accepted: '推送服务已接受（非送达确认）', failed: '失败', expired: '已过期', cancelled: '已取消', unknown: '发送结果未知，不自动补发' };
function message(text) { $('reminder-status').textContent = text; reminderSummary(); }
function reminderSummary() {
  const title = $('reminder-card-title'), summary = $('reminder-card-summary'), state = $('reminder-card-state');
  if (pendingStop) {
    title.textContent = '关闭操作，尚待确认。'; summary.textContent = '已记住你的操作，打开设置可查看进度并重试。'; state.textContent = '待处理 · 完成前不会重新开启';
  } else if (confirmed && saved?.enabled && service?.ready) {
    title.textContent = '明天的准备，已安排。';
    summary.textContent = `${saved.config.city.name}\n${saved.nextRunAt ? displayRun(saved.nextRunAt, saved.config.timezone) : '单次计划已进入执行流程'}\n${saved.targetDate ? `对应 ${saved.targetDate} 出门 · ` : ''}${saved.config.modules.map(id => id === 'sun' ? '紫外线与防晒' : '穿衣建议').join('、')}`;
    state.textContent = '服务端计划已开启 · 不代表设备已收到';
  } else {
    title.textContent = '把明天的准备，留在今晚。';
    summary.textContent = saved?.enabled ? '服务端存在计划，本设备状态尚需确认。请打开设置检查或关闭。' : '设定你的时间，提前看看明天穿什么、如何防晒。';
    state.textContent = !API_BASE ? '设置与简报可预览 · 定时推送尚未配置' : !service?.ready ? '推送服务未就绪 · 可管理已有计划' : '尚未开启 · 保存开启后才申请通知权限';
  }
}
function availabilityUI() {
  const unready = !service?.ready;
  $('reminder-availability').textContent = unready
    ? '定时推送尚未配置或暂不可用。可以保存本地准备单、预览简报；不会自动发送通知。已有计划仍可关闭或删除。'
    : '推送服务已连接。只有勾选开启并保存，才会申请通知权限；服务端接受不等于设备送达。';
  $('reminder-test').disabled = busy || !!pendingStop || unready;
  $('reminder-test').setAttribute('aria-describedby', 'reminder-availability');
  $('reminder-test').title = unready ? '需要先连接并开启推送服务，目前可使用简报预览。' : '';
  $('reminder-enabled').disabled = busy || !!pendingStop || unready;
  $('reminder-enabled').setAttribute('aria-describedby', 'reminder-availability');
  $('reminder-save').textContent = unready ? '保存本地准备单' : '保存提醒设置';
}
function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function ensureToken() {
  let token = getToken();
  if (!token) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    token = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    try { localStorage.setItem(TOKEN_KEY, token); } catch { throw new Error('浏览器不能保存管理凭证，无法开启提醒。'); }
  }
  return token;
}
function apiURL(path) {
  if (!API_BASE) throw new Error('提醒后端尚未配置。可以预览简报，定时提醒未开启。');
  const url = new URL(API_BASE);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('提醒后端地址必须使用 HTTPS。');
  return `${url.origin}${path}`;
}
async function api(path, method = 'GET', body) {
  const headers = {};
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(apiURL(path), { method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000), credentials: 'omit', cache: 'no-store', redirect: 'error' });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || '提醒服务暂时不可用。'); error.status = response.status; throw error; }
  return data;
}
function supportsPush() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function needsHomeScreen() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !matchMedia('(display-mode: standalone)').matches && !navigator.standalone;
}
async function getRegistration() {
  if (!('serviceWorker' in navigator)) throw new Error('此浏览器不支持 Service Worker，仍可使用天气和简报预览。');
  if (!registration) {
    registration = (async () => {
      const reg = await navigator.serviceWorker.register(new URL('sw.js', base), { scope: base.pathname });
      if (reg.active) return reg;
      // Wait for this registration, not an unrelated ancestor scope's worker.
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => done(new Error('通知服务启动超时，请重试。')), 10000);
        const poll = setInterval(() => { if (reg.active) done(); }, 100);
        function done(error) { clearTimeout(timer); clearInterval(poll); error ? reject(error) : resolve(reg); }
      });
    })().catch(error => { registration = null; throw error; });
  }
  return registration;
}
async function syncWorker(enabled, revision) {
  if (!('serviceWorker' in navigator)) return;
  const reg = await getRegistration();
  await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const done = error => { clearTimeout(timeout); channel.port1.close(); error ? reject(error) : resolve(); };
    const timeout = setTimeout(() => done(new Error('通知状态同步超时，请刷新后重试。')), 5000);
    channel.port1.onmessage = () => done();
    try { reg.active.postMessage({ type: 'reminder-state', enabled, revision }, [channel.port2]); }
    catch (error) { done(error); }
  });
}
function setCity(city, zone) {
  reminderCity = { name: city.name, latitude: city.latitude, longitude: city.longitude };
  $('reminder-city-name').textContent = `固定提醒：${city.name}`;
  $('reminder-zone').value = zone || '';
  changed();
}
function daysUI() {
  $('reminder-custom-days').hidden = $('reminder-days').value !== 'custom';
  $('reminder-date-label').hidden = $('reminder-days').value !== 'once';
}
function formPlan() {
  if (!validCity(reminderCity)) throw new Error('请先选择固定提醒城市。');
  const timezone = $('reminder-zone').value.trim(), time = $('reminder-time').value;
  if (!validZone(timezone)) throw new Error('请填写有效 IANA 时区，例如 Asia/Shanghai。');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('请选择提醒时间。');
  const mode = $('reminder-days').value;
  const days = mode === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : mode === 'weekdays' ? [1, 2, 3, 4, 5] : mode === 'custom'
    ? [...document.querySelectorAll('[data-reminder-day]:checked')].map(input => Number(input.value)) : [];
  const targetDate = mode === 'once' ? $('reminder-date').value : null;
  if (mode === 'once' && !validDate(targetDate)) throw new Error('请选择目标出门日期。');
  if (mode !== 'once' && !days.length) throw new Error('至少选择一个目标出门日。');
  const modules = ['clothing', 'sun'].filter(id => $(`module-${id}`).checked);
  if (!modules.length) throw new Error('至少开启一个内容模块。');
  return { city: reminderCity, timezone, time, days, targetDate, modules, sensitivity: $('reminder-sensitivity').value };
}
function showNext() {
  let text = pendingStop ? '关闭操作尚待确认，请完成下方恢复操作。' : saved?.enabled && saved.nextRunAt
    ? `服务端下次提醒：${displayRun(saved.nextRunAt, saved.config.timezone)}；对应 ${saved.targetDate} 出门。`
    : saved?.enabled ? '该单次计划已进入执行流程，请查看发送记录。' : '服务端提醒未开启。';
  try {
    const p = formPlan(), next = nextReminder(p);
    if (dirty || !saved?.enabled) text += next
      ? ` 当前设置${dirty ? '（尚未保存到服务端，仅预览）' : '（仅预览）'}：${displayRun(next.runAt, p.timezone)} 提醒，目标出门日 ${next.targetDate}。`
      : ' 当前设置没有下一次提醒；指定日期的前夜时间可能已过。';
  } catch (error) { text += ` ${error.message}`; }
  $('reminder-next').textContent = text;
  reminderSummary();
}
function persistDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ plan: formPlan(), enabled: $('reminder-enabled').checked, dirty })); } catch {}
}
function changed(event) {
  if (event?.target?.id === 'reminder-city-search') return;
  dirty = true; ++previewVersion;
  $('reminder-preview-result').hidden = true;
  daysUI(); showNext(); persistDraft();
  message('设置已修改，请重新预览；保存后才会生效。');
}
function fill(plan) {
  reminderCity = plan.city;
  $('reminder-city-name').textContent = `固定提醒：${plan.city.name}`;
  $('reminder-zone').value = plan.timezone; $('reminder-time').value = plan.time;
  $('reminder-sensitivity').value = plan.sensitivity;
  $('reminder-days').value = plan.targetDate ? 'once' : plan.days.join(',') === '1,2,3,4,5,6,7' ? 'daily' : plan.days.join(',') === '1,2,3,4,5' ? 'weekdays' : 'custom';
  $('reminder-date').value = plan.targetDate ?? '';
  document.querySelectorAll('[data-reminder-day]').forEach(input => { input.checked = plan.days.includes(Number(input.value)); });
  for (const id of ['clothing', 'sun']) $(`module-${id}`).checked = plan.modules.includes(id);
  daysUI();
}
async function refresh() {
  if (pendingStop) return stop(pendingStop === 'delete');
  if (!getToken()) { message('本设备尚未开启提醒。'); showNext(); return; }
  try { saved = await api('/v1/plan'); }
  catch (error) {
    if (error.status !== 404) throw error;
    saved = { enabled: false, active: false, jobs: [] };
  }
  if (!dirty) {
    if (saved.config) fill(saved.config);
    $('reminder-enabled').checked = saved.enabled;
    persistDraft();
  }
  $('reminder-history').replaceChildren(...saved.jobs.map(job => {
    const li = document.createElement('li');
    li.textContent = `${job.kind === 'test' ? '测试' : '定时'} · ${job.target_date} · ${states[job.state] ?? job.state} · 尝试 ${job.attempts} 次`;
    return li;
  }));
  const sub = supportsPush() ? await (await getRegistration()).pushManager.getSubscription() : null;
  const usable = service?.ready && saved.enabled && saved.active && sub && Notification.permission === 'granted';
  confirmed = !!usable;
  message((!service?.ready ? '推送服务尚未就绪或已暂停。可查看已有计划、关闭提醒或删除数据。'
    : usable ? '服务端提醒计划已开启。实际到达请用测试通知在设备上确认。'
    : saved.enabled ? '服务端存在计划，但此浏览器权限或订阅已失效，请重新开启，或关闭提醒。'
    : !saved.active ? '服务端数据不存在或订阅已失效，提醒已停止。请重新开启。' : '提醒已关闭。') + (dirty ? ' 已保留未保存的设置。' : ''));
  await syncWorker(!!usable, saved.revision);
  showNext();
}
async function unsubscribe() {
  if (!supportsPush()) return;
  const sub = await (await getRegistration()).pushManager.getSubscription();
  if (sub && !(await sub.unsubscribe())) throw new Error('浏览器取消订阅失败，请重试或在浏览器设置中关闭此站点通知。');
}
function recoveryUI() {
  $('reminder-recovery').hidden = !pendingStop;
  $('reminder-retry-stop').hidden = !pendingStop;
  $('reminder-recovery').textContent = pendingStop
    ? `${pendingStop === 'delete' ? '删除服务端数据' : '关闭提醒'}待确认。${recoveryDetail || '正在关闭本地通知并联系服务端。'} 在完成前不能重新开启或发送测试。${intentStored ? '联网后会重试，也可手动重试。' : '浏览器未能记住此次操作，请在关闭页面前完成重试。'}` : '';
  if (!busy) {
    $('reminder-enabled').disabled = !!pendingStop;
    $('reminder-save').disabled = !!pendingStop;
    $('reminder-test').disabled = !!pendingStop;
  }
  availabilityUI(); reminderSummary();
}
async function stop(remove = false) {
  confirmed = false;
  // Persist the user's intent before any async step. A reload must never turn
  // notifications back on while the server's stop/delete result is uncertain.
  pendingStop = remove || pendingStop === 'delete' ? 'delete' : 'stop';
  remove = pendingStop === 'delete';
  try { localStorage.setItem(STOP_KEY, pendingStop); intentStored = true; } catch { intentStored = false; }
  $('reminder-enabled').checked = false; recoveryDetail = ''; recoveryUI(); showNext();
  const hadToken = !!getToken();
  // All three are independent: a worker or network failure must not prevent the
  // other cleanup paths. Keep the capability until every step is acknowledged.
  const results = await Promise.allSettled([syncWorker(false, null), unsubscribe(),
    hadToken ? api(remove ? '/v1/account' : '/v1/plan', 'DELETE') : Promise.resolve()]);
  recoveryDetail = results.flatMap((result, i) => result.status === 'rejected'
    ? [`${['本地通知关闭', '浏览器取消订阅', '服务端操作'][i]}未确认：${result.reason.message}。`] : []).join(' ');
  if (recoveryDetail) { recoveryUI(); message('关闭操作尚未全部完成，请查看待确认提示并重试。'); return; }
  saved = null; dirty = false;
  if (remove) { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(DRAFT_KEY); }
  else persistDraft();
  localStorage.removeItem(STOP_KEY); pendingStop = null; recoveryUI();
  showNext(); message(!hadToken ? '本浏览器没有服务端管理凭证，已关闭本地通知。如曾清除浏览器数据，无法凭此确认旧服务端数据已删除。'
    : remove ? '服务端订阅、计划及发送记录已删除。' : '提醒已关闭，浏览器订阅已取消。');
  if (remove) $('reminder-history').replaceChildren();
  // A page reopened with a pending stop skips initial service discovery. Restore
  // readiness after recovery so a later explicit enable gesture can work.
  if (!service && API_BASE) { try { service = await api('/v1/config'); } catch {} }
}
function applicationKey(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
async function save() {
  if (pendingStop) throw new Error('请先完成待确认的关闭或删除操作，再重新开启。');
  if (!service?.ready) {
    const plan = formPlan();
    if (!nextReminder(plan)) throw new Error('此计划的前夜提醒时间已过，请调整目标日期或时间。');
    $('reminder-enabled').checked = false;
    // This is explicitly a local draft, never a simulated server enable.
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ plan, enabled:false, dirty:true })); }
    catch { throw new Error('准备单保存失败：浏览器无法保存本地设置，请检查存储权限后重试。'); }
    dirty = true; message('准备单已保存在本浏览器。定时推送未配置或不可用，提醒未开启。'); showNext(); return;
  }
  if (!$('reminder-enabled').checked) return stop();
  const plan = formPlan();
  if (!nextReminder(plan)) throw new Error('此计划的前夜提醒时间已过，请调整目标日期或时间。');
  if (!service?.ready) throw new Error('提醒后端尚未配置或服务已暂停，定时提醒未开启。');
  if (needsHomeScreen()) throw new Error('请先添加到 iPhone / iPad 主屏幕，并从主屏幕打开后开启通知。');
  if (!supportsPush()) throw new Error('此浏览器不支持网页推送；仍可查询天气和预览简报。');
  // This is the only permission request and runs directly from the Save gesture.
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') throw new Error('通知权限被拒绝，提醒未开启。可在浏览器站点设置中修改权限后重试。');
  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  const hadToken = !!getToken(); ensureToken();
  const key = applicationKey(service.publicKey);
  const currentKey = sub?.options.applicationServerKey;
  if (sub && (!hadToken || (currentKey && !new Uint8Array(currentKey).every((b, i) => b === key[i])) || (sub.expirationTime && sub.expirationTime <= Date.now()))) {
    await sub.unsubscribe(); sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/v1/register', 'POST', { subscription: sub.toJSON() });
  saved = await api('/v1/plan', 'PUT', plan);
  dirty = false; persistDraft();
  await syncWorker(true, saved.revision);
  confirmed = true;
  message('服务端提醒计划已开启。可发送测试通知，验证设备是否实际收到。'); showNext();
}
async function perform(action, { editable = false } = {}) {
  if (busy) return; busy = true;
  const controls = [...document.querySelectorAll(editable ? '.reminder-actions button' : '#reminder-form fieldset, #reminder-form input, #reminder-form select, #reminder-form button, #reminder-enabled')];
  const disabled = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  try { await action(); } catch (error) {
    message(`${error.name === 'TimeoutError' ? '网络请求超时，请刷新服务端状态确认结果后重试。' : error.message} 未确认服务端结果时，不代表操作已成功。`);
  } finally { busy = false; controls.forEach((control, i) => { control.disabled = disabled[i]; }); recoveryUI(); }
}
function element(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function renderBrief(container, brief) {
  const tomorrow = addDays(localDate(brief.timezone), 1);
  container.replaceChildren(element('h3', `${brief.city.name} · ${brief.targetDate} 出门简报`), element('p', `${brief.timezone} 当地日期 · 天气预报，随更新可能变化`, 'reminder-note'));
  for (const module of brief.modules) {
    const card = element('section', '', 'brief-module');
    card.append(element('h4', module.id === 'sun' ? `${brief.targetDate === tomorrow ? '明日' : brief.targetDate}最高紫外线指数，预报值` : module.title));
    if (module.id === 'sun') {
      card.append(element('p', `${module.value ?? '信息暂缺'}${module.level ? ` · ${module.level}` : ''}`), element('p', module.text));
      const link = element('a', '防护文案依据：WHO 紫外线指数指引'); link.href = WHO_SOURCE; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link);
      card.append(element('p', '仅有每日最大值，不能据此确定精确高峰时段。', 'reminder-note'));
    } else {
      if (module.temperatureAlert) {
        const alert = element('aside', '', 'temperature-alert');
        alert.append(element('h4', `温差提醒 · ${module.temperatureAlert.title}`), element('p', module.temperatureAlert.text));
        if (module.temperatureAlert.detail) alert.append(element('p', `${module.temperatureAlert.detail}（预报）`, 'temperature-alert-detail'));
        card.append(alert);
      }
      card.append(element('p', module.text));
      if (module.items) card.append(element('p', `内搭 / 外搭 / 下装：${module.items.join(' / ')}`));
      card.append(element('p', `目标日最低 / 最高：${temp(module.low)} / ${temp(module.high)}；07:00–21:00 最低体感 ${temp(module.basis)}。`, 'reminder-note'));
    }
    container.append(card);
  }
  container.hidden = false;
}
async function preview() {
  const plan = formPlan(), next = nextReminder(plan);
  if (!next) throw new Error('该设置没有下一次提醒，请调整目标出门日。');
  const version = ++previewVersion;
  message(`正在生成 ${plan.city.name} · ${next.targetDate} 简报…`);
  const { data } = await fetchBriefingData(plan.city, plan.timezone, plan.modules);
  if (version !== previewVersion) return;
  renderBrief($('reminder-preview-result'), assembleBriefing(data, plan, next.targetDate));
  message('预览已生成；预览不会开启定时提醒或发送通知。');
}
function cityResults(cities) {
  $('reminder-city-results').replaceChildren(...cities.map(city => {
    const button = element('button', [city.name, city.admin1, city.country].filter(Boolean).join(' · '), 'secondary-button'); button.type = 'button';
    button.addEventListener('click', () => {
      setCity(city, city.timezone || (city.country === '中国' ? 'Asia/Shanghai' : ''));
      $('reminder-city-results').replaceChildren();
    }); return button;
  }));
}
async function searchCities() {
  const query = $('reminder-city-search').value.trim(), version = ++searchVersion;
  if (query.length < 2) { cityResults(CITIES.slice(0, 6)); return; }
  const local = CITIES.filter(c => c.name.includes(query) || `${c.name}市` === query);
  cityResults(local);
  try {
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: query, count: '12', language: 'zh', format: 'json' })}`, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(); const data = await response.json();
    if (version !== searchVersion) return;
    const cities = [...local, ...(data.results ?? []).filter(validCity)];
    cityResults(cities.filter((c, i) => cities.findIndex(other => other.name === c.name && Math.abs(other.latitude - c.latitude) < .15 && Math.abs(other.longitude - c.longitude) < .15) === i));
    if (!cities.length) message('没有找到城市，可以试试拼音或附近城市。');
  } catch { if (version === searchVersion) message('城市在线搜索暂时不可用，可选择常用城市。'); }
}
async function showDetail() {
  const params = new URLSearchParams(location.search);
  if (!params.has('brief')) return;
  document.body.classList.add('brief-view');
  const container = $('brief-detail'); container.hidden = false;
  const back = element('a', '← 返回天气与提醒设置'); back.href = base.href;
  container.append(back, element('p', '正在读取指定日期的简报…'));
  try {
    const plan = { city: { name: params.get('city'), latitude: Number(params.get('lat')), longitude: Number(params.get('lon')) },
      timezone: params.get('tz'), sensitivity: ['cold', 'normal', 'warm'].includes(params.get('sensitivity')) ? params.get('sensitivity') : 'normal',
      modules: (params.get('modules') ?? 'clothing,sun').split(',').filter(id => ['clothing', 'sun'].includes(id)) };
    const date = params.get('date');
    if (!validCity(plan.city) || !validZone(plan.timezone) || !validDate(date)) throw new Error('通知中的城市或目标日期无效。');
    const today = localDate(plan.timezone);
    if (date < addDays(today, -1) || date > addDays(today, 6)) throw new Error(`${plan.city.name} · ${date} 已超出当前预报范围，无法还原当时的预报。`);
    const { data } = await fetchBriefingData(plan.city, plan.timezone, plan.modules);
    renderBrief(container, assembleBriefing(data, plan, date)); container.prepend(back);
    document.title = `${plan.city.name} · ${date} 出门简报 · 添一件`;
  } catch (error) { container.replaceChildren(back, element('p', error.message)); }
}

for (let day = 1; day <= 7; day++) {
  const label = element('label', '', 'check-label'), input = document.createElement('input');
  input.type = 'checkbox'; input.value = day; input.dataset.reminderDay = day; input.checked = day <= 5;
  label.append(input, document.createTextNode(`周${'一二三四五六日'[day - 1]}`)); $('reminder-custom-days').append(label);
}
$('reminder-form').addEventListener('change', changed);
document.querySelectorAll('[data-open-reminder]').forEach(button => button.addEventListener('click', () => {
  openDialog($('reminder-dialog'), $('reminder-dialog').querySelector('[data-close-dialog]'));
}));
$('reminder-form').addEventListener('input', changed);
$('reminder-enabled').addEventListener('change', changed);
$('reminder-form').addEventListener('submit', event => { event.preventDefault(); perform(save); });
$('reminder-preview').addEventListener('click', () => perform(preview, { editable: true }));
$('reminder-test').addEventListener('click', () => perform(async () => {
  if (pendingStop) throw new Error('请先完成待确认的关闭或删除操作。');
  if (dirty) throw new Error('设置有未保存的修改，请先保存再测试。');
  pendingTestKey ??= crypto.randomUUID();
  const result = await api('/v1/test', 'POST', { requestKey: pendingTestKey });
  pendingTestKey = null;
  message(`测试已排队（${result.job.target_date}），等待服务端真实推送；这不代表设备已收到。`);
}));
$('reminder-stop').addEventListener('click', () => perform(() => stop(false)));
$('reminder-delete').addEventListener('click', () => perform(() => stop(true)));
$('reminder-retry-stop').addEventListener('click', () => perform(() => stop(pendingStop === 'delete')));
$('reminder-refresh').addEventListener('click', () => perform(async () => {
  if (!pendingStop) {
    try { service = await api('/v1/config'); } catch { service = null; }
  }
  await refresh();
}));
window.addEventListener('online', () => { if (pendingStop) perform(() => stop(pendingStop === 'delete')); });
$('reminder-search').addEventListener('click', searchCities);
$('reminder-city-search').addEventListener('input', () => { ++searchVersion; });
$('reminder-city-search').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); searchCities(); } });
$('reminder-use-current').addEventListener('click', () => perform(async () => {
  let current; try { current = JSON.parse(localStorage.getItem('weather-layer-v1')); } catch {}
  if (!validCity(current?.city)) throw new Error('请先在天气页面选择查询城市，或直接搜索固定提醒城市。');
  // Explicit action only; no storage listener ties temporary browsing to reminders.
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ latitude: current.city.latitude, longitude: current.city.longitude, timezone: 'auto', daily: 'temperature_2m_max', forecast_days: '1' })}`, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('暂时无法确认城市时区，请用提醒城市搜索。');
  const data = await response.json();
  if (!validZone(data.timezone)) throw new Error('城市时区暂缺，请用提醒城市搜索。');
  setCity(current.city, data.timezone);
}));
async function init() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY)), plan = draft?.plan ?? draft;
    if (plan && validCity(plan.city)) {
      fill(plan); dirty = draft.dirty !== false;
      $('reminder-enabled').checked = draft.enabled === true;
    }
  } catch {}
  try {
    const intent = localStorage.getItem(STOP_KEY);
    if (['stop', 'delete'].includes(intent)) { pendingStop = intent; $('reminder-enabled').checked = false; }
  } catch {}
  cityResults(CITIES.slice(0, 6)); recoveryUI(); showNext();
  if (pendingStop) {
    await perform(() => stop(pendingStop === 'delete'));
    if (pendingStop) return;
  }
  if (needsHomeScreen()) message('请从 iPhone / iPad 主屏幕打开后开启推送；现在可以预览。');
  if (!API_BASE) { message('提醒后端尚未配置。可以预览明日简报，定时提醒未开启。'); return; }
  try {
    service = await api('/v1/config');
    availabilityUI(); reminderSummary();
    if (getToken()) await perform(refresh);
    else if (!service.ready) message('提醒服务尚未配置完成或已暂停，定时提醒未开启。');
    else message(supportsPush() ? '服务已连接。勾选开启并保存后，才会请求通知权限。' : '此浏览器不支持网页推送，仍可使用天气和预览。');
  } catch (error) { message(`尚未确认服务端状态：${error.message}`); }
}
showDetail(); init();
