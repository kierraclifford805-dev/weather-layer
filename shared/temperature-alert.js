import { finite, temp } from './weather.js';

// Reuse the existing daily-range threshold. This is a preparation reminder,
// not an official weather warning or a new clothing-temperature rule.
export const LARGE_TEMPERATURE_RANGE = 10;
const degrees = value => Number(value.toFixed(1));

export function temperatureAlert(report) {
  const { low, high, morning, evening } = report;
  if (!finite(low) || !finite(high) || !finite(high-low) || high < low || high - low < LARGE_TEMPERATURE_RANGE) return null;
  const range = degrees(high - low);
  return {
    range,
    title: `昼夜温差 ${range}°C`,
    text: `全天预报 ${degrees(low)}–${degrees(high)}°C。别只看白天最高温，按出门时段增减衣物。`,
    detail: [
      finite(morning) ? `早间 07–09 时最低体感 ${temp(morning)}` : '',
      finite(evening) ? `晚间 18–21 时最低体感 ${temp(evening)}` : ''
    ].filter(Boolean).join('；')
  };
}
