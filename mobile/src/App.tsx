import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { initAuth, onAuthChange, isCloudConfigured } from './lib/cloud';
import { getTasks, pullAllFromCloud } from './lib/store';
import { theme } from './theme';
import { AuthScreen, TasksScreen, ReportScreen, MeetingScreen, TablesScreen, SettingsScreen } from './screens';
import type { Task } from './lib/types';

type Tab = 'tasks' | 'tables' | 'report' | 'meeting' | 'settings';
const TAB_LABEL: Record<Tab, string> = {
  tasks: '任务',
  tables: '表格',
  report: '日报',
  meeting: '会议',
  settings: '设置',
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('tasks');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [forceLocal, setForceLocal] = useState(false);

  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const s = await initAuth();
      setSession(s);
      if (s) {
        await pullAllFromCloud();
        setTasks(await getTasks());
      }
      setReady(true);
      unsub = onAuthChange((sess: Session | null) => {
        setSession(sess);
        if (sess) {
          pullAllFromCloud().then(() => getTasks().then(setTasks));
        } else {
          setTasks([]);
        }
      });
    })();
    return () => unsub();
  }, []);

  function refreshTasks() {
    getTasks().then(setTasks);
  }

  if (!ready) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={theme.primary} />
      </SafeAreaView>
    );
  }
  if (isCloudConfigured && !session && !forceLocal) {
    return <AuthScreen onLocal={() => setForceLocal(true)} />;
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        {tab === 'tasks' && <TasksScreen tasks={tasks} onChange={refreshTasks} />}
        {tab === 'tables' && <TablesScreen />}
        {tab === 'report' && <ReportScreen tasks={tasks} />}
        {tab === 'meeting' && <MeetingScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </View>
      <View style={styles.tabbar}>
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
          <TouchableOpacity key={t} style={styles.tabItem} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{TAB_LABEL[t]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  body: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
  tabbar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.panel,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabText: { color: theme.muted, fontSize: 12 },
  tabTextOn: { color: theme.primary, fontWeight: '600' },
});
