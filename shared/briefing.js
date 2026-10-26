import { summarize, finite, forecastURL } from './weather.js';
import { validDate } from './dates.js';
import { temperatureAlert } from './temperature-alert.js';

export const WHO_SOURCE = 'https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-(uv)-index';
export function sunAdvice(value) {
  if (!finite(value) || value < 0) return { status: 'unavailable', value: null, level: '信息暂缺', text: '紫外线预报信息暂缺，暂不判断防护等级。' };
  if (value < 3) return { status: 'available', value, level: '日常关注', text: '紫外线水平较低，日常关注即可；敏感人群按自身情况采取防护。' };
  if (value < 8) return { status: 'available', value, level: '需要防护', text: '午间注意寻找阴凉处，穿遮护衣物、戴帽，并使用防晒霜。' };
  return { status: 'available', value, level: '加强防护', text: '尽量避免午间户外活动；寻找阴凉处，配合遮护衣物、帽子和防晒霜。' };
}

// Modules consume a dated forecast and return independent results. Future rain /
// airQuality implementations can be registered here; unimplemented IDs are rejected.
export const modules = {
  clothing(data, date, sensitivity) {
    const r = summarize(data, date, sensitivity);
    return { id: 'clothing', status: finite(r.basis) ? 'available' : 'unavailable',
      title: '出门穿衣建议', text: `${r.advice.title} ${r.advice.description}`,
      items: r.advice.items, basis: r.basis, low: r.low, high: r.high, temperatureAlert: temperatureAlert(r) };
  },
  sun(data, date) {
    const index = data.daily?.time?.indexOf(date) ?? -1;
    const advice = sunAdvice(index < 0 ? null : data.daily.uv_index_max?.[index]);
    return { id: 'sun', title: '明日最高紫外线指数，预报值', ...advice, source: WHO_SOURCE };
  }
};
export function assembleBriefing(data, plan, targetDate) {
  const results = plan.modules.map(id => {
    try {
      if (!modules[id]) throw new Error('Unsupported module');
      return modules[id](data, targetDate, plan.sensitivity);
    } catch { return { id, status: 'unavailable', title: id === 'clothing' ? '出门穿衣建议' : '紫外线预报', text: '信息暂缺' }; }
  });
  return { city: plan.city, timezone: plan.timezone, targetDate, modules: results };
}
export function briefingText(briefing) {
  return briefing.modules.map(m => m.id === 'sun'
    ? `明日最高紫外线指数，预报值：${m.value ?? '信息暂缺'}。${m.level ?? ''} ${m.text}`
    : `${m.temperatureAlert ? `温差提醒：${m.temperatureAlert.title}。${m.temperatureAlert.text}\n` : ''}穿衣：${m.items?.join(' / ') ?? '信息暂缺'}。${m.text}`).join('\n');
}
// Independent data-source contract. Keep one module usable when the other fetch fails.
export async function fetchBriefingData(city, timezone, enabled, fetcher = fetch) {
  const requests = enabled.map(async id => {
    const url = new URL(forecastURL(city, timezone));
    url.searchParams.delete('current');
    if (id === 'sun') { url.searchParams.delete('hourly'); url.searchParams.set('daily', 'uv_index_max'); }
    else url.searchParams.set('daily', 'temperature_2m_min,temperature_2m_max');
    const response = await fetcher(url.toString(), { signal: AbortSignal.timeout(12000), redirect: 'error' });
    if (!response.ok) throw new Error('天气服务暂时不可用。');
    const data = await response.json();
    if (data?.error || !Array.isArray(data?.daily?.time) || !data.daily.time.every(validDate)) throw new Error('天气服务暂时不可用。');
    const daily = { time: data.daily.time };
    const fields = id === 'sun' ? ['uv_index_max'] : ['temperature_2m_min', 'temperature_2m_max'];
    for (const field of fields) daily[field] = Array.isArray(data.daily[field]) ? data.daily[field] : [];
    // A malformed module response must not overwrite another module's fields.
    return { daily, ...(id === 'clothing' ? { hourly: data.hourly ?? {} } : {}) };
  });
  const results = await Promise.allSettled(requests);
  // Merge by date, not position: upstream responses may have different lengths.
  const data = { timezone, daily: { time: [] }, hourly: {} };
  const fulfilled = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  data.daily.time = [...new Set(fulfilled.flatMap(d => d.daily?.time ?? []))].sort();
  for (const source of fulfilled) {
    if (source.hourly) data.hourly = source.hourly;
    for (const [key, values] of Object.entries(source.daily ?? {})) {
      if (key !== 'time') data.daily[key] = data.daily.time.map(date => values[source.daily.time.indexOf(date)] ?? null);
    }
  }
  return { data, allFailed: !fulfilled.length };
}
