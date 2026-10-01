import { useEffect, useState, useSyncExternalStore } from 'react';
import { schedulePlan } from '../../../tasks.mjs';
import type { AppController } from '../../app/AppController';
import { applyScheduleDate } from './scheduleCommands';

type RecordItem = { id: string; name: string; project: unknown };
type Task = { id: string; title: string; category: string; dueDate: string; blockers: string[]; execution: string };
type Project = { tasks: unknown[] };
const categoryLabels: Record<string, string> = { scene: 'Scene preparation', ran: 'Virtual RAN', integration: 'Integration',
  drive: 'Drive test', ab: 'A/B test', data: 'Dataset', custom: 'Custom task' };

export default function SchedulePreviewLeaf({ controller, record }: { controller: AppController; record: RecordItem }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === record.id) ?? record;
  const tasks = (record.project as Project).tasks;
  const rows = schedulePlan(tasks) as Task[];
  const [dates, setDates] = useState<Record<string, string>>(() => Object.fromEntries(rows.map(task => [task.id, task.dueDate])));
  const [error, setError] = useState('');
  useEffect(() => { setDates(Object.fromEntries(rows.map(task => [task.id, task.dueDate]))); setError(''); }, [record.id, rows.map(task => `${task.id}:${task.dueDate}`).join('|')]);

  const changeDate = (taskId: string, dueDate: string) => {
    setDates(previous => ({ ...previous, [taskId]: dueDate }));
    try {
      const save = applyScheduleDate(controller, record.id, taskId, dueDate);
      if (!save) return;
      setError('');
      void save.catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setDates(Object.fromEntries(rows.map(task => [task.id, task.dueDate])));
    }
  };

  return <section className="schedule-preview" role="region" aria-label="Schedule preview route">
    <header><div><h1>Schedule</h1>
      <p>Sequence scene, virtual-RAN, drive-test, A/B and dataset preparation in one dependency-aware timeline.</p></div></header>
    <p className="artifacts-boundary">Planning calendar only. Dates do not dispatch jobs or represent execution results.</p>
    {error && <p role="alert">Schedule change rejected · {error}</p>}
    <section className="panel" aria-labelledby="schedule-timeline-title">
      <header className="panel-header"><div><h2 id="schedule-timeline-title">Planned timeline</h2>
        <p className="panel-caption">{rows.length} dated tasks · change dates here or in the task board</p></div><span className="mini-pill">PLANNING ONLY</span></header>
      <ol className="ops-timeline">{rows.map((task, index) => <li className="ops-milestone" key={task.id}>
        <div className="ops-line"><span>{String(index + 1).padStart(2, '0')}</span></div>
        <div className="ops-milestone-body"><div><small>{task.dueDate} · {categoryLabels[task.category] ?? task.category}</small>
          <strong>{task.title}</strong><span>Prerequisites: {task.blockers.length ? task.blockers.join(', ') : 'none'}</span></div>
          <label className="ops-date-label">Reschedule <input type="date" aria-label={`Reschedule ${task.id}`} value={dates[task.id] ?? task.dueDate}
            onChange={event => changeDate(task.id, event.currentTarget.value)} /></label><span className="mini-pill">NOT RUN</span>
        </div>
      </li>)}</ol>
    </section>
    <div className="lower-grid">
      <section className="panel"><header className="panel-header"><div><h2>Dependency policy</h2>
        <p className="panel-caption">Keep evidence and run order explicit</p></div></header>
        <p className="detail-copy">A downstream task may not be due before a prerequisite. Importing a manifest cannot mark jobs complete. Actual scheduling requires an authenticated job service, timezone policy, resource reservations, retries, logs and operator approval.</p>
      </section>
      <section className="panel"><header className="panel-header"><div><h2>Operational boundary</h2>
        <p className="panel-caption">Clock time is not a result</p></div></header>
        <p className="detail-copy">H200/GH200 capacity, vDU availability and external scene assets have not been checked. This calendar neither starts processes nor sends notifications.</p>
      </section>
    </div>
  </section>;
}
