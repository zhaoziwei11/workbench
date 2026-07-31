import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Alert,
  Switch,
} from 'react-native';
import type { Task, Priority, Meeting, TableFile, Settings, StepStatus } from './lib/types';
import {
  signIn,
  signUp,
  isCloudConfigured,
  getCurrentUser,
  signOut,
} from './lib/cloud';
import {
  getTasks,
  upsertTask,
  deleteTask,
  getMeetings,
  getTables,
  saveTables,
  getSettings,
  saveSettings,
} from './lib/store';
import { todayStr, addDays } from './lib/date';
import { generateReport } from './lib/report';
import { theme } from './theme';

const PRI_LABEL: Record<Priority, string> = { high: '高', medium: '中', low: '低' };
const PRIS: Priority[] = ['high', 'medium', 'low'];

// ============================ 登录 ============================
export function AuthScreen({ onLocal }: { onLocal: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!email.trim() || password.length < 6) {
      setErr('邮箱必填，密码至少 6 位');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      if (mode === 'up') {
        const r = await signUp(email.trim(), password);
        if (!r.session) Alert.alert('注册成功', '若开启邮箱确认，请验证邮箱后再登录。');
      } else {
        await signIn(email.trim(), password);
      }
    } catch (e: any) {
      setErr(e?.message || '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.authWrap}>
      <Text style={styles.h1}>个人工作台</Text>
      <Text style={styles.muted}>登录后手机与电脑数据自动同步、保持一致</Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.tabBtn, mode === 'in' && styles.tabBtnOn]}
          onPress={() => setMode('in')}
        >
          <Text>登录</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, mode === 'up' && styles.tabBtnOn]}
          onPress={() => setMode('up')}
        >
          <Text>注册</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.input}
        placeholder="邮箱"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="密码（至少 6 位）"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {err ? <Text style={styles.err}>{err}</Text> : null}
      <TouchableOpacity style={styles.primary} disabled={busy} onPress={submit}>
        <Text style={{ color: '#fff', textAlign: 'center' }}>
          {busy ? '处理中…' : mode === 'in' ? '登录' : '注册并登录'}
        </Text>
      </TouchableOpacity>
      {!isCloudConfigured && (
        <Text style={[styles.muted, { color: theme.medium }]}>
          未检测到云端配置，无法开启同步。
        </Text>
      )}
      <TouchableOpacity onPress={onLocal}>
        <Text style={styles.link}>仅本地使用（不同步）</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ============================ 任务 ============================
export function TasksScreen({
  tasks,
  onChange,
}: {
  tasks: Task[];
  onChange: () => void;
}) {
  const [date, setDate] = useState(todayStr());
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [expanded, setExpanded] = useState<string | null>(null);

  const dayTasks = tasks
    .filter((t) => t.date === date)
    .sort((a, b) => b.createdAt - a.createdAt);

  async function addTask() {
    if (!title.trim()) return;
    const now = Date.now();
    const t: Task = {
      id: now.toString(36) + Math.random().toString(36).slice(2, 8),
      title: title.trim(),
      content: content.trim(),
      priority,
      date,
      steps: [],
      createdAt: now,
      updatedAt: now,
    };
    await upsertTask(t);
    setTitle('');
    setContent('');
    setPriority('medium');
    setAdding(false);
    onChange();
  }

  async function toggleStep(task: Task, stepId: string) {
    const steps = task.steps.map((s) =>
      s.id === stepId
        ? { ...s, status: (s.status === 'done' ? 'pending' : 'done') as StepStatus, updatedAt: Date.now() }
        : s
    );
    await upsertTask({ ...task, steps, updatedAt: Date.now() });
    onChange();
  }

  async function remove(task: Task) {
    Alert.alert('删除任务', `确定删除「${task.title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await deleteTask(task.id);
          onChange();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.page}>
      <View style={styles.dateBar}>
        <TouchableOpacity onPress={() => setDate(addDays(date, -1))}>
          <Text style={styles.link}>← 前一天</Text>
        </TouchableOpacity>
        <Text>{date}</Text>
        <TouchableOpacity onPress={() => setDate(addDays(date, 1))}>
          <Text style={styles.link}>后一天 →</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.primary} onPress={() => setAdding(true)}>
        <Text style={{ color: '#fff', textAlign: 'center' }}>+ 新增任务</Text>
      </TouchableOpacity>

      {dayTasks.length === 0 && <Text style={styles.muted}>这一天还没有任务。</Text>}

      {dayTasks.map((t) => {
        const done = t.steps.filter((s) => s.status === 'done').length;
        const open = expanded === t.id;
        return (
          <View key={t.id} style={styles.card}>
            <View style={styles.cardHead}>
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => setExpanded(open ? null : t.id)}
              >
                <Text style={styles.cardTitle}>{t.title}</Text>
                <Text style={styles.muted}>
                  优先级：{PRI_LABEL[t.priority]} · 步骤 {done}/{t.steps.length}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => remove(t)}>
                <Text style={{ color: theme.danger }}>删除</Text>
              </TouchableOpacity>
            </View>
            {open && (
              <View style={{ marginTop: 8 }}>
                {t.content ? <Text style={styles.muted}>{t.content}</Text> : null}
                {t.steps.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.stepRow}
                    onPress={() => toggleStep(t, s.id)}
                  >
                    <Text style={{ color: s.status === 'done' ? theme.low : theme.muted }}>
                      {s.status === 'done' ? '✓' : '○'} {s.text}
                    </Text>
                  </TouchableOpacity>
                ))}
                {t.steps.length === 0 && <Text style={styles.muted}>暂无步骤</Text>}
              </View>
            )}
          </View>
        );
      })}

      <Modal visible={adding} animationType="slide" onRequestClose={() => setAdding(false)}>
        <ScrollView contentContainerStyle={styles.modalWrap}>
          <Text style={styles.h1}>新增任务</Text>
          <TextInput
            style={styles.input}
            placeholder="任务名称 *"
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            style={[styles.input, { height: 80 }]}
            placeholder="内容 / 详情"
            multiline
            value={content}
            onChangeText={setContent}
          />
          <View style={styles.row}>
            {PRIS.map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.tabBtn, priority === p && styles.tabBtnOn]}
                onPress={() => setPriority(p)}
              >
                <Text>{PRI_LABEL[p]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.muted}>归属日期：{date}</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.ghost} onPress={() => setAdding(false)}>
              <Text>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primary} onPress={addTask}>
              <Text style={{ color: '#fff' }}>保存</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}

// ============================ 日报 ============================
export function ReportScreen({ tasks }: { tasks: Task[] }) {
  const [date, setDate] = useState(todayStr());
  const md = generateReport(tasks, date);
  const count = tasks.filter((t) => t.date === date).length;
  return (
    <ScrollView style={styles.page}>
      <View style={styles.dateBar}>
        <TouchableOpacity onPress={() => setDate(addDays(date, -1))}>
          <Text style={styles.link}>← 前一天</Text>
        </TouchableOpacity>
        <Text>{date}（{count} 个任务）</Text>
        <TouchableOpacity onPress={() => setDate(addDays(date, 1))}>
          <Text style={styles.link}>后一天 →</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.card}>
        <Text style={{ fontFamily: 'monospace' }}>{md}</Text>
      </View>
    </ScrollView>
  );
}

// ============================ 会议 ============================
export function MeetingScreen() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [open, setOpen] = useState<Meeting | null>(null);

  useEffect(() => {
    getMeetings().then(setMeetings);
  }, []);

  return (
    <ScrollView style={styles.page}>
      {meetings.length === 0 && <Text style={styles.muted}>还没有会议纪要。</Text>}
      {meetings.map((m) => (
        <TouchableOpacity key={m.id} style={styles.card} onPress={() => setOpen(m)}>
          <Text style={styles.cardTitle}>{m.title}</Text>
          <Text style={styles.muted}>
            {m.date} · {m.chapters.length} 个章节
          </Text>
        </TouchableOpacity>
      ))}

      <Modal visible={!!open} animationType="slide" onRequestClose={() => setOpen(null)}>
        {open && (
          <ScrollView contentContainerStyle={styles.modalWrap}>
            <Text style={styles.h1}>{open.title}</Text>
            {open.summary ? <Text style={styles.cardTitle}>摘要：{open.summary}</Text> : null}
            {open.chapters.map((c, i) => (
              <View key={c.id} style={styles.card}>
                <Text style={styles.cardTitle}>
                  议题 {i + 1}：{c.title}
                </Text>
                <Text>{c.content}</Text>
              </View>
            ))}
            <Text style={styles.cardTitle}>转写全文</Text>
            <Text style={{ fontFamily: 'monospace' }}>{open.transcript || '（无）'}</Text>
            <TouchableOpacity style={styles.ghost} onPress={() => setOpen(null)}>
              <Text>关闭</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </Modal>
    </ScrollView>
  );
}

// ============================ 表格 ============================
export function TablesScreen() {
  const [tables, setTables] = useState<TableFile[]>([]);
  useEffect(() => {
    getTables().then(setTables);
  }, []);

  async function remove(id: string) {
    const next = tables.filter((t) => t.id !== id);
    setTables(next);
    await saveTables(next);
  }

  return (
    <ScrollView style={styles.page}>
      <Text style={styles.muted}>
        表格导入请在电脑端操作；手机端可查看已同步的表格与会议数据。
      </Text>
      {tables.length === 0 && <Text style={styles.muted}>还没有表格。</Text>}
      {tables.map((t) => (
        <View key={t.id} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{t.name}</Text>
              <Text style={styles.muted}>{t.sheets.length} 个 sheet</Text>
            </View>
            <TouchableOpacity onPress={() => remove(t.id)}>
              <Text style={{ color: theme.danger }}>删除</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// ============================ 设置 ============================
export function SettingsScreen() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const user = getCurrentUser();

  useEffect(() => {
    getSettings().then(setS);
  }, []);

  async function save() {
    if (!s) return;
    await saveSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <ScrollView style={styles.page}>
      {isCloudConfigured && user && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>已登录：{user.email}</Text>
          <TouchableOpacity style={styles.ghost} onPress={() => signOut()}>
            <Text style={{ color: theme.danger }}>退出登录</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>转写 API 配置（仅本机保存）</Text>
        <TextInput
          style={styles.input}
          placeholder="API Base URL"
          autoCapitalize="none"
          value={s?.baseUrl ?? ''}
          onChangeText={(v) => setS((p) => (p ? { ...p, baseUrl: v } : p))}
        />
        <TextInput
          style={styles.input}
          placeholder="API Key"
          secureTextEntry
          value={s?.apiKey ?? ''}
          onChangeText={(v) => setS((p) => (p ? { ...p, apiKey: v } : p))}
        />
        <TextInput
          style={styles.input}
          placeholder="纪要模型"
          value={s?.chatModel ?? ''}
          onChangeText={(v) => setS((p) => (p ? { ...p, chatModel: v } : p))}
        />
        <TouchableOpacity style={styles.primary} onPress={save}>
          <Text style={{ color: '#fff', textAlign: 'center' }}>
            {saved ? '已保存 ✓' : '保存设置'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.muted}>
          说明：API Key 仅保存在本机，不会上传第三方。手机端会议录音建议在电脑端完成。
        </Text>
      </View>
    </ScrollView>
  );
}

// ============================ 共享样式 ============================
const styles = StyleSheet.create({
  page: { flex: 1, padding: 14, backgroundColor: theme.bg },
  authWrap: { flexGrow: 1, justifyContent: 'center', padding: 28, backgroundColor: theme.bg },
  h1: { fontSize: 22, fontWeight: '700', marginBottom: 6, color: theme.text },
  muted: { color: theme.muted, fontSize: 13, marginTop: 6 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  tabBtn: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  tabBtnOn: { borderColor: theme.primary, backgroundColor: '#f0f5ff' },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
    backgroundColor: '#fff',
    fontSize: 15,
  },
  primary: {
    backgroundColor: theme.primary,
    borderRadius: 8,
    padding: 12,
    marginTop: 14,
  },
  ghost: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    padding: 12,
    marginTop: 14,
    alignItems: 'center',
  },
  err: { color: theme.danger, marginTop: 8, fontSize: 13 },
  link: { color: theme.primary, fontSize: 13 },
  dateBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: theme.text },
  stepRow: { paddingVertical: 6, borderTopWidth: 1, borderTopColor: theme.border, marginTop: 6 },
  modalWrap: { padding: 20, backgroundColor: theme.bg, minHeight: '100%' },
});
