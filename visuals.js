// Visual vocabulary only. Clothing and UV decisions stay in shared/.
import { finite } from './shared/weather.js';
const assets = new URL('./assets/', import.meta.url);
export const scenes = Object.fromEntries(['clear','cloudy','rain','snow','fog','storm','night','unknown'].map(id => [id, new URL(`weather/${id}.svg`, assets).href]));
export function weatherScene(code, night = false) {
  if (!finite(code)) return 'unknown';
  if (night) return 'night';
  if ([95,96,99].includes(code)) return 'storm';
  if ([71,73,75,77,85,86].includes(code)) return 'snow';
  if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return 'rain';
  if ([45,48].includes(code)) return 'fog';
  if ([0,1,2].includes(code)) return 'clear';
  return code === 3 ? 'cloudy' : 'unknown';
}
export const clothes = Object.fromEntries(['tshirt','longsleeve','knit','light-jacket','jacket','coat','puffer','base-layer','trousers','shorts','hat','umbrella','sunscreen','water'].map(id => [id, new URL(`clothes/${id}.svg`, assets).href]));
export const outfitHeadlines = {
  '出门，认真穿暖一点。':'认真穿暖一点。', '外套，选厚一点的。':'外套选厚一点。',
  '出门，多带一件外套。':'多带一件外套。', '带件薄外套，刚刚好。':'带件薄外套。',
  '轻装出门，就很舒服。':'轻装出门。', '出门，穿轻一点。':'穿得轻一点。'
};
// Map existing rule output; never duplicate or adjust the temperature thresholds.
const garmentMap = {
  '保暖内搭':'base-layer','针织衫 / 卫衣':'knit','长袖上衣':'longsleeve','T 恤 / 薄长袖':'tshirt',
  '透气短袖':'tshirt','宽松短袖':'tshirt','羽绒服 / 厚外套':'puffer','厚外套':'coat','常规外套':'jacket',
  '薄衬衫 / 薄外套':'light-jacket','备用薄衫':'light-jacket','遮阳帽 / 防晒衣':'hat',
  '厚长裤':'trousers','长裤':'trousers','轻薄长裤':'trousers','轻薄下装':'shorts','透气下装':'shorts'
};
const garmentReasons = {
  'base-layer':'贴身留住暖意','knit':'柔软保暖','longsleeve':'轻松打底','tshirt':'轻薄透气',
  'puffer':'挡住冷意','coat':'多留一层暖意','jacket':'外层方便穿脱','light-jacket':'随时增减一层',
  'trousers':'照顾腿部体感','shorts':'轻盈好活动','hat':'遮护头面部'
};
export function wardrobe(report, sun) {
  const wear = [], carry = [];
  report.advice.items.forEach((label, i) => {
    const asset = garmentMap[label]; if (!asset) return;
    const item = { asset, label, role: ['内搭','外层','下装'][i], reason: garmentReasons[asset] };
    (['备用薄衫','遮阳帽 / 防晒衣'].includes(label) ? carry : wear).push(item);
  });
  if (finite(report.rain) && report.rain >= 50) carry.push({asset:'umbrella',label:'雨伞',reason:`最高降水概率 ${Math.round(report.rain)}%`});
  if (sun.status === 'available' && sun.value >= 3) {
    if (!carry.some(i => i.asset === 'hat')) carry.push({asset:'hat',label:'遮阳帽',reason:'遮护头面部'});
    carry.push({asset:'sunscreen',label:'防晒霜',reason:'紫外线需要防护'});
  }
  if (finite(report.high) && report.high >= 28) carry.push({asset:'water',label:'水杯',reason:`最高 ${Math.round(report.high)}°，记得补水`});
  return { wear, carry };
}
