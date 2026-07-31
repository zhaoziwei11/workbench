import { useMemo, useState } from 'react';
import { generateReport } from '../lib/report';
import { todayStr, addDays } from '../lib/date';
import type { Task } from '../types';

interface Props {
  tasks: Task[];
}

export function ReportPage({ tasks }: Props) {
  const [date, setDate] = useState(todayStr());
  const [copied, setCopied] = useState(false);

  const md = useMemo(() => generateReport(tasks, date), [tasks, date]);
  const dayCount = tasks.filter((t) => t.date === date).length;

  async function copy() {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function exportFile() {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `工作日报_${date}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>自动日报生成</h2>
        <div className="head-actions">
          <button className="btn-sm" onClick={copy}>
            {copied ? '已复制 ✓' : '复制'}
          </button>
          <button className="btn-primary" onClick={exportFile}>
            导出 .md
          </button>
        </div>
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
        <span className="muted">{date} 共 {dayCount} 个任务</span>
      </div>

      <div className="report-preview">
        <pre>{md}</pre>
      </div>
    </div>
  );
}
