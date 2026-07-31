// 移动端持久化层：AsyncStorage 本地 + Supabase 云端后台同步
// 接口与 Web 端 store 保持一致（均为异步），便于双端复用业务逻辑。
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Task, TableFile, Meeting, Settings } from './types';
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

async function readLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
async function writeLocal<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
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
  await writeLocal('tasks', tasks);
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
  await writeLocal('tasks', tasks);
  void deleteRemote('tasks', id);
  return tasks;
}

// ---------------- 表格 ----------------
export async function getTables(): Promise<TableFile[]> {
  return readLocal<TableFile[]>('tables', []);
}
export async function saveTables(tables: TableFile[]): Promise<void> {
  await writeLocal('tables', tables);
  void pushTables(tables);
}

// ---------------- 会议 ----------------
export async function getMeetings(): Promise<Meeting[]> {
  return readLocal<Meeting[]>('meetings', []);
}
export async function saveMeetings(meetings: Meeting[]): Promise<void> {
  await writeLocal('meetings', meetings);
  void pushMeetings(meetings);
}

// ---------------- 设置（含密钥，仅本机，不云同步）----------------
const DEFAULT_SETTINGS: Settings = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  whisperModel: 'whisper-1',
  chatModel: 'gpt-4o-mini',
};
export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await readLocal<Partial<Settings>>('settings', {})) };
}
export async function saveSettings(s: Settings): Promise<void> {
  await writeLocal('settings', s);
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
    if (t.data) await writeLocal('tasks', (t.data as Record<string, any>[]).map(rowToTask));
    if (f.data) await writeLocal('tables', (f.data as Record<string, any>[]).map(rowToTableFile));
    if (m.data) await writeLocal('meetings', (m.data as Record<string, any>[]).map(rowToMeeting));
    return true;
  } catch (e) {
    console.error('云端拉取失败', e);
    return false;
  }
}
