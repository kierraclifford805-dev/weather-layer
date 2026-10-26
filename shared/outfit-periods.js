import { finite, minimum, outfit } from './weather.js';

// Calendar hours in the forecast city's timezone. All periods use the original
// clothing rules; only the explicitly selected forecast window changes.
export const OUTFIT_PERIODS = [
  { id:'all', label:'全天', start:7, end:21, time:'07–21 时' },
  { id:'morning', label:'早间', start:7, end:9, time:'07–09 时' },
  { id:'daytime', label:'白天', start:11, end:16, time:'11–16 时' },
  { id:'evening', label:'晚间', start:18, end:21, time:'18–21 时' }
];

export function outfitPeriods(report, sensitivity = 'normal') {
  return OUTFIT_PERIODS.map(period => {
    const points = (report.hours ?? []).filter(point => point.time?.startsWith(`${report.date}T`) &&
      point.hour >= period.start && point.hour <= period.end && finite(point.feels));
    const basis = minimum(points.map(point => point.feels));
    return { ...period, basis, available:finite(basis), samples:points.length,
      advice:outfit(basis, sensitivity) };
  });
}
