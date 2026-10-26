import test from 'node:test';
import assert from 'node:assert/strict';
import { outfitPeriods } from '../shared/outfit-periods.js';
import { outfit } from '../shared/weather.js';

function report(values={7:8,8:10,9:12,11:23,13:25,16:24,18:15,21:12}) {
  return {date:'2026-12-31',hours:Object.entries(values).map(([hour,feels])=>({hour:Number(hour),time:`2026-12-31T${hour.padStart(2,'0')}:00`,feels}))};
}
test('each city-local time window uses its own minimum and the unchanged outfit rules',()=>{
  for(const sensitivity of ['cold','normal','warm']) {
    const periods=outfitPeriods(report(),sensitivity);
    assert.deepEqual(periods.map(period=>period.basis),[8,8,23,12]);
    for(const period of periods)assert.deepEqual(period.advice,outfit(period.basis,sensitivity));
  }
});
test('all-day basis keeps the original 07–21 limits; adjacent dates never leak into a period',()=>{
  const data=report({6:-20,7:12,21:14,22:-20});
  data.hours.push({hour:8,time:'2027-01-01T08:00',feels:-40});
  assert.equal(outfitPeriods(data)[0].basis,12);
  assert.equal(outfitPeriods(data)[1].basis,12);
  assert.equal(outfitPeriods(data)[2].basis,null);
});
test('zero is valid; missing, strings and nonfinite values do not create clothing recommendations',()=>{
  const periods=outfitPeriods(report({7:0,8:null,9:'-10',11:NaN,13:Infinity,18:undefined}));
  assert.equal(periods[1].basis,0);assert.equal(periods[1].available,true);
  for(const period of periods.slice(2)){
    assert.equal(period.available,false);assert.equal(period.basis,null);assert.equal(period.advice.label,'暂不判断');
  }
});
