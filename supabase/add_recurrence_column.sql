-- ============================================================================
-- 给云端 tasks 表补加 recurrence 列（任务频次功能需要）
-- 适用场景：你之前已建好 tasks 表，但那时还没有 recurrence 字段。
--           新版前端会把 recurrence(jsonb) 一起 upsert 到云端，
--           若列不存在会报错 "column recurrence does not exist"。
-- 执行方式：连上能访问 supabase.co 的网络后，
--           打开 Supabase 控制台 → SQL Editor → New query
--           → 粘贴下面内容 → Run。
-- 说明：add column if not exists 是幂等的，重复执行安全。
-- ============================================================================

alter table public.tasks
  add column if not exists recurrence jsonb not null default '{"type":"none"}'::jsonb;
