// 移动端 Supabase 云同步客户端与鉴权（Expo 版）
// 与 Web 端逻辑一致，仅配置读取方式不同：Expo 用 app.json 的 extra。
import Constants from 'expo-constants';
import { createClient, type SupabaseClient, type Session, type User } from '@supabase/supabase-js';
import type { Task, TableFile, Meeting } from './types';

const url = Constants.expoConfig?.extra?.supabaseUrl as string | undefined;
const anonKey = Constants.expoConfig?.extra?.supabaseAnonKey as string | undefined;

export const isCloudConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isCloudConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

let currentUser: User | null = null;

export function getCurrentUser(): User | null {
  return currentUser;
}
export function getUserId(): string | null {
  return currentUser?.id ?? null;
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  if (!supabase) {
    cb(null);
    return () => {};
  }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user ?? null;
    cb(session);
  });
  return () => data.subscription.unsubscribe();
}

export async function initAuth(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user ?? null;
  return data.session;
}

export async function signUp(email: string, password: string) {
  if (!supabase) throw new Error('未配置云端同步，无法注册');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('未配置云端同步，无法登录');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  currentUser = null;
}

// ----------------- 行 → 前端对象 映射 -----------------
function rowToTask(r: Record<string, any>): Task {
  return {
    id: r.id,
    title: r.title ?? '',
    content: r.content ?? '',
    priority: r.priority ?? 'medium',
    date: r.date,
    steps: Array.isArray(r.steps) ? (r.steps as Task['steps']) : [],
    createdAt: r.created_at ?? Date.now(),
    updatedAt: r.updated_at ?? Date.now(),
  };
}
function rowToTableFile(r: Record<string, any>): TableFile {
  return {
    id: r.id,
    name: r.name ?? '',
    sheets: Array.isArray(r.sheets) ? (r.sheets as TableFile['sheets']) : [],
    importedAt: r.imported_at ?? Date.now(),
  };
}
function rowToMeeting(r: Record<string, any>): Meeting {
  return {
    id: r.id,
    title: r.title ?? '',
    date: r.date,
    audioPath: r.audio_path ?? undefined,
    transcript: r.transcript ?? '',
    chapters: Array.isArray(r.chapters) ? (r.chapters as Meeting['chapters']) : [],
    summary: r.summary ?? '',
    createdAt: r.created_at ?? Date.now(),
  };
}

// ----------------- 云端后台推送（best-effort）-----------------
export async function pushTasks(tasks: Task[]): Promise<void> {
  if (!supabase) return;
  const uid = getUserId();
  if (!uid) return;
  const rows = tasks.map((t) => ({
    id: t.id,
    user_id: uid,
    title: t.title,
    content: t.content,
    priority: t.priority,
    date: t.date,
    steps: t.steps,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  }));
  await supabase.from('tasks').upsert(rows);
}

export async function pushTables(files: TableFile[]): Promise<void> {
  if (!supabase) return;
  const uid = getUserId();
  if (!uid) return;
  const rows = files.map((f) => ({
    id: f.id,
    user_id: uid,
    name: f.name,
    sheets: f.sheets,
    imported_at: f.importedAt,
    updated_at: Date.now(),
  }));
  await supabase.from('table_files').upsert(rows);
}

export async function pushMeetings(meetings: Meeting[]): Promise<void> {
  if (!supabase) return;
  const uid = getUserId();
  if (!uid) return;
  const rows = meetings.map((m) => ({
    id: m.id,
    user_id: uid,
    title: m.title,
    date: m.date,
    audio_path: m.audioPath ?? null,
    transcript: m.transcript,
    chapters: m.chapters,
    summary: m.summary,
    created_at: m.createdAt,
    updated_at: Date.now(),
  }));
  await supabase.from('meetings').upsert(rows);
}

export async function deleteRemote(
  kind: 'tasks' | 'table_files' | 'meetings',
  id: string,
): Promise<void> {
  if (!supabase) return;
  await supabase.from(kind).delete().eq('id', id);
}

export { rowToTask, rowToTableFile, rowToMeeting };
