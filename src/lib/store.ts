// 持久化层：本地 localStorage 即时读写 + 云端后台同步（若已配置并登录）
// 接口改为异步，便于登录后从云端拉取；未配置/未登录时退化为纯本地。
import type { Task, TableFile, Meeting, Settings } from '../types';
import {
  supabase,
  getUserId,
  pushTasks,
  pushTables,
  pushMeetings,
  deleteRemote,
  rowToTask,
  rowToTableFile,
  rowToMeeting,
} from './cloud';

const PREFIX = 'workbench:';

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function writeLocal<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.error('持久化失败', e);
  }
}

export const uid = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------------- 任务 ----------------
export async function getTasks(): Promise<Task[]> {
  return readLocal<Task[]>('tasks', []);
}
export async function saveTasks(tasks: Task[]): Promise<void> {
  writeLocal('tasks', tasks);
  void pushTasks(tasks);
}
export async function upsertTask(task: Task): Promise<Task[]> {
  const tasks = await getTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) tasks[idx] = task;
  else tasks.unshift(task);
  await saveTasks(tasks);
  return tasks;
}
export async function deleteTask(id: string): Promise<Task[]> {
  const tasks = (await getTasks()).filter((t) => t.id !== id);
  writeLocal('tasks', tasks);
  void deleteRemote('tasks', id);
  return tasks;
}

// ---------------- 表格 ----------------
export async function getTables(): Promise<TableFile[]> {
  return readLocal<TableFile[]>('tables', []);
}
export async function saveTables(tables: TableFile[]): Promise<void> {
  writeLocal('tables', tables);
  void pushTables(tables);
}

// ---------------- 会议 ----------------
export async function getMeetings(): Promise<Meeting[]> {
  return readLocal<Meeting[]>('meetings', []);
}
export async function saveMeetings(meetings: Meeting[]): Promise<void> {
  writeLocal('meetings', meetings);
  void pushMeetings(meetings);
}

// ---------------- 设置（含密钥，刻意不云同步，仅本机保存）----------------
const DEFAULT_SETTINGS: Settings = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  whisperModel: 'whisper-1',
  chatModel: 'gpt-4o-mini',
};

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...readLocal<Partial<Settings>>('settings', {}) };
}
export function saveSettings(s: Settings): void {
  writeLocal('settings', s);
}

// ---------------- 登录后从云端全量拉取覆盖本地 ----------------
export async function pullAllFromCloud(): Promise<boolean> {
  if (!supabase) return false;
  const uid = getUserId();
  if (!uid) return false;
  try {
    const [t, f, m] = await Promise.all([
      supabase.from('tasks').select('*').eq('user_id', uid),
      supabase.from('table_files').select('*').eq('user_id', uid),
      supabase.from('meetings').select('*').eq('user_id', uid),
    ]);
    if (t.data) writeLocal('tasks', (t.data as Record<string, any>[]).map(rowToTask));
    if (f.data) writeLocal('tables', (f.data as Record<string, any>[]).map(rowToTableFile));
    if (m.data) writeLocal('meetings', (m.data as Record<string, any>[]).map(rowToMeeting));
    return true;
  } catch (e) {
    console.error('云端拉取失败', e);
    return false;
  }
}
