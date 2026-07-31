import type { Task, Priority } from '../types';

const PRIORITY_LABEL: Record<Priority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export function taskProgress(task: Task): { done: number; total: number } {
  const total = task.steps.length;
  const done = task.steps.filter((s) => s.status === 'done').length;
  return { done, total };
}

export function isTaskDone(task: Task): boolean {
  const { done, total } = taskProgress(task);
  return total > 0 && done === total;
}

// 根据当天任务自动汇总生成日报（Markdown）
export function generateReport(tasks: Task[], date: string): string {
  const dayTasks = tasks.filter((t) => t.date === date);
  const total = dayTasks.length;
  const doneTasks = dayTasks.filter(isTaskDone).length;
  const totalSteps = dayTasks.reduce((s, t) => s + t.steps.length, 0);
  const doneSteps = dayTasks.reduce(
    (s, t) => s + t.steps.filter((x) => x.status === 'done').length,
    0
  );

  const lines: string[] = [];
  lines.push(`# 工作日报 · ${date}`);
  lines.push('');
  lines.push('## 一、概览');
  lines.push(`- 任务总数：${total}（已完成 ${doneTasks}）`);
  lines.push(`- 步骤进展：${doneSteps}/${totalSteps} 步已完成`);
  lines.push('');

  if (total === 0) {
    lines.push('_当日暂无任务记录。_');
    return lines.join('\n');
  }

  lines.push('## 二、任务明细');
  dayTasks.forEach((t, i) => {
    const { done, total: ts } = taskProgress(t);
    const tag = isTaskDone(t) ? '✅' : '🔄';
    lines.push(`### ${i + 1}. ${tag} ${t.title} 〔优先级：${PRIORITY_LABEL[t.priority]}〕`);
    if (t.content) lines.push(`> ${t.content.replace(/\n/g, ' ')}`);
    if (t.steps.length) {
      lines.push('');
      lines.push(`**步骤（${done}/${ts}）**：`);
      t.steps.forEach((s) => {
        const mark = s.status === 'done' ? '[x]' : '[ ]';
        const note = s.note ? ` —— ${s.note}` : '';
        lines.push(`- ${mark} ${s.text}${note}`);
      });
    }
    lines.push('');
  });

  const pending = dayTasks.filter((t) => !isTaskDone(t));
  if (pending.length) {
    lines.push('## 三、待跟进事项');
    pending.forEach((t) => {
      const { done, total: ts } = taskProgress(t);
      lines.push(`- ${t.title}（步骤 ${done}/${ts}）`);
    });
    lines.push('');
  }

  lines.push('---');
  lines.push(`_本日报由工作台根据当日任务自动生成，生成时间 ${new Date().toLocaleString('zh-CN')}。_`);
  return lines.join('\n');
}
