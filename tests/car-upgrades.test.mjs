import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const data=JSON.parse(await readFile(new URL('../data/car-upgrades/2026.json',import.meta.url),'utf8'));
const index=JSON.parse(await readFile(new URL('../data/2026/index.json',import.meta.url),'utf8'));
test('each completed GP has eleven distinct teams with an official source',()=>{
  for(const meeting of index.meetings.filter(m=>/Grand Prix/.test(m.name)&&m.sessions.some(s=>s.laps))){
    const entry=data.meetings.find(m=>m.key===meeting.key);
    assert.ok(entry,meeting.name);
    assert.equal(entry.teams.length,11);
    assert.equal(new Set(entry.teams.map(t=>t.team)).size,11);
    assert.ok(entry.source.startsWith('https://www.fia.com/system/files/decision-document/2026_'));
    for(const team of entry.teams){
      assert.notEqual(team.status,'unavailable');
      if(team.status==='none')assert.equal(team.items.length,0);
      for(const item of team.items)assert.ok(item.component&&item.purpose&&item.page>1);
    }
  }
});
test('Brazil reports four McLaren changes and no submitted changes from Mercedes',()=>{
  const meeting=data.meetings.find(m=>m.key===1299);
  assert.deepEqual(meeting.teams.find(t=>t.team==='McLaren').items.map(i=>i.component),['Front Wing','Rear Wing','Beam Wing','Floor Furniture']);
  assert.equal(meeting.teams.find(t=>t.team==='Mercedes').status,'none');
});
test('image-based Williams Australia submission is included rather than marked empty',()=>{
  const team=data.meetings.find(m=>m.key===1279).teams.find(t=>t.team==='Williams');
  assert.equal(team.items.length,4);
  assert.equal(team.status,'reported');
  assert.ok(team.items.every(item=>item.page===10));
});
