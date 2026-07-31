import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Layout, PageKey } from './components/Layout';
import { TasksPage } from './pages/TasksPage';
import { TablesPage } from './pages/TablesPage';
import { ReportPage } from './pages/ReportPage';
import { MeetingPage } from './pages/MeetingPage';
import { SettingsPage } from './pages/SettingsPage';
import { AuthPage } from './pages/AuthPage';
import { getTasks, saveTasks, pullAllFromCloud } from './lib/store';
import { initAuth, onAuthChange, isCloudConfigured } from './lib/cloud';
import type { Task } from './types';

export default function App() {
  const [page, setPage] = useState<PageKey>('tasks');
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
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
      unsub = onAuthChange((sess) => {
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

  async function persist(next: Task[]) {
    setTasks(next);
    await saveTasks(next);
  }
  function upsert(t: Task) {
    const idx = tasks.findIndex((x) => x.id === t.id);
    const next = idx >= 0 ? tasks.map((x) => (x.id === t.id ? t : x)) : [t, ...tasks];
    void persist(next);
  }
  function remove(id: string) {
    void persist(tasks.filter((t) => t.id !== id));
  }

  if (!ready) {
    return <div className="loading-screen">加载中…</div>;
  }

  // 配置了云端但未登录 → 登录页（提供「仅本地使用」兜底）
  if (isCloudConfigured && !session && !forceLocal) {
    return <AuthPage onLocal={() => setForceLocal(true)} />;
  }

  return (
    <Layout active={page} onNav={setPage}>
      {page === 'tasks' && <TasksPage tasks={tasks} onUpsert={upsert} onDelete={remove} />}
      {page === 'tables' && <TablesPage />}
      {page === 'report' && <ReportPage tasks={tasks} />}
      {page === 'meeting' && <MeetingPage />}
      {page === 'settings' && <SettingsPage />}
    </Layout>
  );
}
