import test from 'node:test';
import assert from 'node:assert/strict';
import {lapSegments,cleanLaps,pitLaps} from '../assets/lap-series.js';

const laps = [[1,90,0,'S',30,30,30],[2,92,0,'S',29,31,32],[3,120,0,'S',40,40,40],[4,160,1,'M',60,50,50],[5,89,0,'M',28,30,31],[6,91,0,'M',30,30,31]];
test('the graph reports actual laps rather than mixed-sector rolling sums',()=>{
  const points=lapSegments(laps,'all').flat();
  assert.deepEqual(points.map(p=>[p.x,p.y]),[[1,90],[2,92],[3,120],[4,160],[5,89],[6,91]]);
});
test('clean mode excludes pit entry, pit exit and slow laps and leaves a gap',()=>{
  assert.deepEqual(cleanLaps(laps).map(l=>l[0]),[1,2,5,6]);
  assert.deepEqual(lapSegments(laps,'clean').map(s=>s.map(p=>p.x)),[[1,2],[5,6]]);
  assert.deepEqual([...pitLaps(laps)],[3]);
});
test('missing lap numbers are not joined, and empty data stays empty',()=>{
  assert.equal(lapSegments([laps[0],laps[4]],'all').length,2);
  assert.deepEqual(lapSegments([],'clean'),[]);
});
