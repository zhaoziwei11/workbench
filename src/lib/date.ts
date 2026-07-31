// 日期工具
export function todayStr(): string {
  return fmt(new Date());
}

export function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return fmt(d);
}

export function isToday(dateStr: string): boolean {
  return dateStr === todayStr();
}

// 近 N 天的日期列表（含今天），用于历史展示
export function recentDays(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(todayStr(), -i));
  return out;
}
