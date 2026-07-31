import { useState } from 'react';
import type { Task, Priority } from '../types';
import { TaskCard } from '../components/TaskCard';
import { Modal } from '../components/Modal';
import { todayStr, addDays } from '../lib/date';
import { uid } from '../lib/store';

const PRI: Priority[] = ['high', 'medium', 'low'];
const PRI_LABEL: Record<Priority, string> = { high: '高', medium: '中', low: '低' };

interface Props {
  tasks: Task[];
  onUpsert: (t: Task) => void;
  onDelete: (id: string) => void;
}

export function TasksPage({ tasks, onUpsert, onDelete }: Props) {
  const [date, setDate] = useState(todayStr());
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', priority: 'medium' as Priority });

  const dayTasks = tasks
    .filter((t) => t.date === date)
    .sort((a, b) => b.createdAt - a.createdAt);

  function submitAdd() {
    if (!form.title.trim()) return;
    const now = Date.now();
    const task: Task = {
      id: uid(),
      title: form.title.trim(),
      content: form.content.trim(),
      priority: form.priority,
      date,
      steps: [],
      createdAt: now,
      updatedAt: now,
    };
    onUpsert(task);
    setAdding(false);
    setForm({ title: '', content: '', priority: 'medium' });
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>每日工作管理</h2>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          + 新增任务
        </button>
      </div>

      <div className="date-bar">
        <button className="btn-sm" onClick={() => setDate(addDays(date, -1))}>
          ← 前一天
        </button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn-sm" onClick={() => setDate(addDays(date, 1))}>
          后一天 →
        </button>
        <button className="btn-sm" onClick={() => setDate(todayStr())}>
          今天
        </button>
        <span className="muted">共 {dayTasks.length} 个任务</span>
      </div>

      {dayTasks.length === 0 ? (
        <div className="empty">
          <p>这一天还没有任务。</p>
          <button className="btn-primary" onClick={() => setAdding(true)}>
            + 新增任务
          </button>
        </div>
      ) : (
        <div className="task-list">
          {dayTasks.map((t) => (
            <TaskCard key={t.id} task={t} onChange={onUpsert} onDelete={onDelete} />
          ))}
        </div>
      )}

      {adding && (
        <Modal
          title="新增工作任务"
          onClose={() => setAdding(false)}
          footer={
            <>
              <button className="btn-sm" onClick={() => setAdding(false)}>
                取消
              </button>
              <button className="btn-primary" onClick={submitAdd}>
                保存
              </button>
            </>
          }
        >
          <label className="field">
            <span>任务名称 *</span>
            <input
              autoFocus
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="例如：承运云提现日报核对"
            />
          </label>
          <label className="field">
            <span>内容 / 详情</span>
            <textarea
              rows={4}
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              placeholder="任务背景、目标、注意事项…"
            />
          </label>
          <label className="field">
            <span>优先级</span>
            <div className="pri-group">
              {PRI.map((p) => (
                <button
                  key={p}
                  className={'pri-btn pri-' + p + (form.priority === p ? ' on' : '')}
                  onClick={() => setForm({ ...form, priority: p })}
                >
                  {PRI_LABEL[p]}
                </button>
              ))}
            </div>
          </label>
          <p className="muted">归属日期：{date}</p>
        </Modal>
      )}
    </div>
  );
}
