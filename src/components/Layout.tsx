import React from 'react';

export type PageKey = 'tasks' | 'tables' | 'report' | 'meeting' | 'settings';

const NAV: { key: PageKey; label: string; icon: string }[] = [
  { key: 'tasks', label: '每日工作', icon: '📋' },
  { key: 'tables', label: '表格对比', icon: '📊' },
  { key: 'report', label: '日报生成', icon: '📝' },
  { key: 'meeting', label: '会议纪要', icon: '🎙️' },
  { key: 'settings', label: '设置', icon: '⚙️' },
];

interface LayoutProps {
  active: PageKey;
  onNav: (p: PageKey) => void;
  children: React.ReactNode;
}

export function Layout({ active, onNav, children }: LayoutProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">个人工作台</div>
        <nav>
          {NAV.map((n) => (
            <button
              key={n.key}
              className={'nav-item' + (active === n.key ? ' active' : '')}
              onClick={() => onNav(n.key)}
            >
              <span className="nav-icon">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">v0.1 · 本地数据</div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
