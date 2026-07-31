-- ============================================================================
-- 个人工作台 · Supabase 数据库结构
-- ============================================================================
-- 使用方法（在 Supabase 控制台完成）：
--   1. 打开 https://app.supabase.com 创建一个新项目（选离你近的区域）。
--   2. 左侧菜单 SQL Editor → New query → 把本文件全部内容粘进去 → Run。
--   3. 跑完后，到 Project Settings → API，复制：
--        - Project URL        → 填到应用 .env 的 VITE_SUPABASE_URL
--        - anon public key    → 填到应用 .env 的 VITE_SUPABASE_ANON_KEY
--   4. anon key 是公开的，靠下面的「行级安全(RLS)」保证只有本人能读写自己的数据。
--
-- 设计说明：
--   - 每个表都有 user_id，并开启 RLS，确保 A 用户绝对读不到 B 用户的数据。
--   - steps / sheets / chapters 用 jsonb 存（和前端结构一致），整行 upsert 同步最简单。
--   - 时间戳用 bigint 毫秒（与前端 Date.now() 一致），便于多端「最后写入获胜」冲突处理。
--   - 转写 API 配置(Settings) 含密钥，刻意【不】进云端，各端本地保存，避免密钥上云。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 每日任务（含分步步骤，steps 存为 jsonb）
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id          text        primary key default gen_random_uuid()::text,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  title       text        not null default '',
  content     text        not null default '',
  priority    text        not null default 'medium'
                          check (priority in ('high', 'medium', 'low')),
  date        date        not null default current_date,
  steps       jsonb       not null default '[]'::jsonb,
  created_at  bigint      not null default extract(epoch from now()) * 1000,
  updated_at  bigint      not null default extract(epoch from now()) * 1000
);

create index if not exists tasks_user_date_idx on public.tasks (user_id, date desc);

-- ---------------------------------------------------------------------------
-- 2. 导入的表格文件（sheets 含 rows 二维数组，存为 jsonb）
-- ---------------------------------------------------------------------------
create table if not exists public.table_files (
  id          text        primary key default gen_random_uuid()::text,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  name        text        not null default '',
  sheets      jsonb       not null default '[]'::jsonb,
  imported_at bigint      not null default extract(epoch from now()) * 1000,
  updated_at  bigint      not null default extract(epoch from now()) * 1000
);

create index if not exists table_files_user_idx on public.table_files (user_id, imported_at desc);

-- ---------------------------------------------------------------------------
-- 3. 会议与纪要（音频文件本身不上云，仅同步文本；audio_path 仅桌面端本地有效）
-- ---------------------------------------------------------------------------
create table if not exists public.meetings (
  id          text        primary key default gen_random_uuid()::text,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  title       text        not null default '',
  date        date        not null default current_date,
  audio_path  text,
  transcript  text        not null default '',
  chapters    jsonb       not null default '[]'::jsonb,
  summary     text        not null default '',
  created_at  bigint      not null default extract(epoch from now()) * 1000,
  updated_at  bigint      not null default extract(epoch from now()) * 1000
);

create index if not exists meetings_user_idx on public.meetings (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. 行级安全（RLS）：每张表只允许本人读写自己的行
-- ---------------------------------------------------------------------------
alter table public.tasks       enable row level security;
alter table public.table_files enable row level security;
alter table public.meetings    enable row level security;

-- tasks
drop policy if exists "tasks_owner" on public.tasks;
create policy "tasks_owner" on public.tasks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- table_files
drop policy if exists "table_files_owner" on public.table_files;
create policy "table_files_owner" on public.table_files
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- meetings
drop policy if exists "meetings_owner" on public.meetings;
create policy "meetings_owner" on public.meetings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 可选：开启实时订阅（让多端改动秒级互相同步，而非仅靠刷新）。
-- 在 Supabase 控制台 Database → Replication → 把这三张表加入 publication，或运行：
-- alter publication supabase_realtime add table public.tasks;
-- alter publication supabase_realtime add table public.table_files;
-- alter publication supabase_realtime add table public.meetings;
