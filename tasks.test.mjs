import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTasks, validateTasks, addPlannedTask, rescheduleTask, schedulePlan } from './tasks.mjs';
import { defaultProject, createManifest } from './model.mjs';

test('default task board represents dependencies without asserting execution', () => {
  const items=defaultTasks(new Date('2026-01-01T00:00:00Z'));
  assert.equal(items.length, 7);
  assert.equal(validateTasks(items).length, 0);
  assert.ok(items.every(x=>x.status==='planned'));
  assert.ok(items.find(x=>x.id==='T-05').dependsOn.includes('T-03'));
});

test('custom task is planned, unique, and can depend on an existing task', () => {
  const items=defaultTasks(new Date('2026-01-01T00:00:00Z'));
  const next=addPlannedTask(items,{ title:'Site review', dueDate:'2026-01-15', dependsOn:['T-01'], priority:'high' });
  assert.equal(next.length,items.length+1);
  assert.equal(next.at(-1).status,'planned');
  assert.equal(next.at(-1).id,'T-08');
  assert.deepEqual(next.at(-1).dependsOn,['T-01']);
  assert.equal(items.length,7);
});

test('rejects cycles, nonexistent dependencies, and schedules before their prerequisites', () => {
  const items=defaultTasks(new Date('2026-01-01T00:00:00Z'));
  assert.throws(()=>addPlannedTask(items,{title:'X',dueDate:'2026-01-15',dependsOn:['MISSING'],priority:'normal'}),/dependency/);
  assert.throws(()=>rescheduleTask(items,'T-01','2026-02-01'),/dependency/);
  const broken=structuredClone(items); broken[0].dependsOn=['T-07'];
  assert.ok(validateTasks(broken).some(x=>x.includes('cycle')));
});

test('schedule is ordered and makes execution blockers explicit', () => {
  const planned=schedulePlan(defaultTasks(new Date('2026-01-01T00:00:00Z')));
  assert.ok(planned.every(x=>x.execution==='not-executed'));
  assert.ok(planned.find(x=>x.id==='T-07').blockers.includes('T-05'));
  assert.ok(planned.every((x,i)=>i===0 || planned[i-1].dueDate<=x.dueDate));
});

test('project manifest includes schedule as planning data, not dispatched jobs', () => {
  const manifest=JSON.parse(createManifest(defaultProject()));
  assert.equal(manifest.tasks.length,7);
  assert.equal(manifest.schedule.length,7);
  assert.ok(manifest.schedule.every(x=>x.execution==='not-executed'));
});
