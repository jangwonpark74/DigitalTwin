import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { schedulePlan } from '../../../tasks.mjs';
import type { AppController } from '../../app/AppController';
import { applyScheduleDate } from './scheduleCommands';
import { addPlannedTask, type PlannedTaskSpec } from './taskCommands';

type RecordItem = { id: string; name: string; project: unknown };
type Task = { id: string; title: string; category: string; priority: string; dueDate: string; blockers: string[]; execution: string };
type Project = { tasks: { id: string; title: string; category: string; priority: string; dueDate: string; dependsOn: string[] }[] };
type Draft = PlannedTaskSpec;
const emptyDraft: Draft = { title: '', dueDate: '', priority: 'normal', dependency: '' };
const categoryLabels: Record<string, string> = { scene: 'Scene preparation', ran: 'Virtual RAN', integration: 'Integration',
  drive: 'Drive test', ab: 'A/B test', data: 'Dataset', custom: 'Custom task' };

export default function TaskBoardPreviewLeaf({ controller, record }: { controller: AppController; record: RecordItem }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === record.id) ?? record;
  const project = record.project as Project;
  const rows = schedulePlan(project.tasks) as Task[];
  const signature = rows.map(task => `${task.id}:${task.dueDate}`).join('|');
  const [dates, setDates] = useState<Record<string, string>>(() => Object.fromEntries(rows.map(task => [task.id, task.dueDate])));
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState('');
  useEffect(() => { setDates(Object.fromEntries(rows.map(task => [task.id, task.dueDate]))); setError(''); }, [record.id, signature]);

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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const save = addPlannedTask(controller, record.id, draft);
      if (!save) return;
      setError('');
      void save.then(() => setDraft(emptyDraft)).catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return <section className="task-board-preview" role="region" aria-label="Task board preview route">
    <header><div><h1>Task board</h1>
      <p>Plan the work needed to turn the RAN twin mockup into a verified deployment.</p></div></header>
    <p className="artifacts-boundary">Planning board only. Planned tasks are not dispatched or marked complete by this preview.</p>
    <div className="ops-summary"><div><strong>{project.tasks.length}</strong><span>planned tasks</span></div>
      <div><strong>{project.tasks.filter(task => task.dependsOn.length > 0).length}</strong><span>with dependencies</span></div>
      <div><strong>0</strong><span>planned tasks executed</span></div></div>
    {error && <p role="alert">Task change rejected · {error}</p>}
    <div className="lower-grid">
      <section className="panel" aria-labelledby="task-backlog-title">
        <header className="panel-header"><div><h2 id="task-backlog-title">Delivery backlog</h2>
          <p className="panel-caption">Tasks remain planned until external evidence exists</p></div><span className="mini-pill">DATABASE PLAN</span></header>
        <ol className="ops-task-list">{rows.map(task => <li className="ops-task" key={task.id}>
          <span className="ops-task-index">{task.id}</span><div className="ops-task-main"><strong>{task.title}</strong>
            <small>{categoryLabels[task.category] ?? task.category} · {task.priority.toUpperCase()} priority · NOT RUN</small></div>
          <span className="mini-pill">{task.blockers.length ? `AFTER ${task.blockers.join(', ')}` : 'NO DEPENDENCY'}</span>
          <label className="ops-date-label">Due <input type="date" aria-label={`Due date for ${task.id}`} data-task-date={task.id}
            value={dates[task.id] ?? task.dueDate} onChange={event => changeDate(task.id, event.currentTarget.value)} /></label>
        </li>)}</ol>
      </section>
      <section className="panel" aria-labelledby="task-create-title">
        <header className="panel-header"><div><h2 id="task-create-title">Add a planned task</h2>
          <p className="panel-caption">No task worker or executor is connected</p></div><span className="mini-pill">NO DISPATCH</span></header>
        <form id="add-task-form" aria-label="Add a planned task" className="pad form-grid" onSubmit={submit}>
          <label className="form-field"><span>Task title</span><input name="title" aria-label="Task title" required maxLength={120}
            placeholder="e.g. Validate antenna patterns" value={draft.title}
            onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))} /></label>
          <label className="form-field"><span>Due date</span><input name="dueDate" type="date" aria-label="Task due date" required value={draft.dueDate}
            onChange={event => setDraft(previous => ({ ...previous, dueDate: event.target.value }))} /></label>
          <label className="form-field"><span>Priority</span><select name="priority" aria-label="Priority" value={draft.priority}
            onChange={event => setDraft(previous => ({ ...previous, priority: event.target.value }))}>
            <option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option>
          </select></label>
          <label className="form-field"><span>Depends on</span><select name="dependency" aria-label="Depends on" value={draft.dependency}
            onChange={event => setDraft(previous => ({ ...previous, dependency: event.target.value }))}>
            <option value="">None</option>{project.tasks.map(task => <option key={task.id} value={task.id}>{task.id} · {task.title}</option>)}
          </select></label>
          <button type="submit" className="button primary">+ Add to plan</button>
        </form>
        <p className="detail-copy">Dates must follow dependencies. Scheduled dates represent planning intent, not a cron job, deployment slot or execution guarantee.</p>
      </section>
    </div>
  </section>;
}
