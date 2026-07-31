import { useState } from 'react';
import type { Task, Step, Priority } from '../types';
import { uid } from '../lib/store';
import { taskProgress, isTaskDone } from '../lib/report';

const PRI_LABEL: Record<Priority, string> = { high: '高', medium: '中', low: '低' };

interface Props {
  task: Task;
  onChange: (t: Task) => void;
  onDelete: (id: string) => void;
}

export function TaskCard({ task, onChange, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const { done, total } = taskProgress(task);
  const doneTask = isTaskDone(task);

  function update(patch: Partial<Task>) {
    onChange({ ...task, ...patch, updatedAt: Date.now() });
  }

  function addStep() {
    const step: Step = { id: uid(), text: '', note: '', status: 'pending', updatedAt: Date.now() };
    update({ steps: [...task.steps, step] });
  }
  function updateStep(id: string, patch: Partial<Step>) {
    update({
      steps: task.steps.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s)),
    });
  }
  function removeStep(id: string) {
    update({ steps: task.steps.filter((s) => s.id !== id) });
  }

  return (
    <div className={'task-card' + (doneTask ? ' done' : '')}>
      <div className="task-head" onClick={() => setOpen((v) => !v)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className={'pri pri-' + task.priority}>{PRI_LABEL[task.priority]}</span>
        <span className="task-title">{task.title}</span>
        <span className="task-prog">
          {total > 0 ? `${done}/${total} 步` : '无步骤'}
        </span>
        {doneTask && <span className="badge-done">已完成</span>}
      </div>

      {open && (
        <div className="task-detail">
          <label className="field">
            <span>内容 / 详情</span>
            <textarea
              value={task.content}
              rows={3}
              onChange={(e) => update({ content: e.target.value })}
              placeholder="补充任务背景、目标、注意事项…"
            />
          </label>

          <div className="steps-head">
            <span>分步记录（{done}/{total}）</span>
            <button className="btn-sm" onClick={addStep}>
              + 添加步骤
            </button>
          </div>

          {task.steps.length === 0 && (
            <p className="muted">暂无步骤，点击「添加步骤」开始记录操作与进展。</p>
          )}

          {task.steps.map((s) => (
            <div className="step-row" key={s.id}>
              <input
                type="checkbox"
                checked={s.status === 'done'}
                onChange={(e) =>
                  updateStep(s.id, { status: e.target.checked ? 'done' : 'pending' })
                }
              />
              <input
                className="step-text"
                value={s.text}
                placeholder="具体操作 / 步骤"
                onChange={(e) => updateStep(s.id, { text: e.target.value })}
              />
              <input
                className="step-note"
                value={s.note ?? ''}
                placeholder="进展备注"
                onChange={(e) => updateStep(s.id, { note: e.target.value })}
              />
              <button className="icon-btn" onClick={() => removeStep(s.id)} title="删除步骤">
                ×
              </button>
            </div>
          ))}

          <div className="task-actions">
            <button
              className="pri-select"
              onClick={() =>
                update({
                  priority:
                    task.priority === 'high'
                      ? 'medium'
                      : task.priority === 'medium'
                      ? 'low'
                      : 'high',
                })
              }
            >
              优先级：{PRI_LABEL[task.priority]}
            </button>
            <button className="btn-danger" onClick={() => onDelete(task.id)}>
              删除任务
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
