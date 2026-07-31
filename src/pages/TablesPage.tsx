import React, { useEffect, useRef, useState } from 'react';
import type { TableFile, SheetData, CompareOutput, CompareMode } from '../types';
import { getTables, saveTables } from '../lib/store';
import { compareTables } from '../lib/tables';

// 后端地址: 单进程方案下前端由后端同源托管, 用相对路径即可(端口随启动脚本变化也不用改)
const COMPARE_API = '';

// 运单时间字段选项(从 probe_output 拿到的真实下拉项, 顺序与页面对齐)
const TIME_FIELDS = [
  '预约时间', '提前出发时间', '接单时间', '磅单审核通过时间',
  '前往货源地时间', '到达货源地时间', '装车成功时间', '前往目的地时间',
  '到达目的地时间', '货主确认车辆时间', '系统自动确认收货时间',
  '收货待确认时间', '确认收货时间', '待结算时间', '完成时间',
];

// 本地日期(按浏览器时区, 与后端 Python datetime.now() 对齐)
function localDate(d: Date = new Date()): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

// 默认日期范围 = T-1(昨天一天, 本地时区)
function defaultRange() {
  const y = new Date();
  y.setDate(y.getDate() - 1); // 昨天
  const s = localDate(y);
  return { start: s, end: s };
}

function uid() {
  return 'tb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 后端返回的 row => 二维数组(加表头)
function rowsToSheet(headers: string[], rows: string[][]): SheetData {
  return { name: 'Sheet1', rows: [headers, ...rows] };
}

// 按某列去重计数(用于运单数统计)
function countDistinctByCol(sheet: SheetData, colName: string): number | null {
  const header = sheet.rows[0] || [];
  const idx = header.indexOf(colName);
  if (idx < 0) return null;
  const set = new Set<string>();
  for (let i = 1; i < sheet.rows.length; i++) {
    const v = (sheet.rows[i][idx] || '').trim();
    if (v) set.add(v);
  }
  return set.size;
}

export function TablesPage() {
  const [tables, setTables] = useState<TableFile[]>([]);
  useEffect(() => {
    getTables().then(setTables);
  }, []);

  // ========== 自动获取状态 ==========
  const rng = defaultRange();
  const [start, setStart] = useState(rng.start);
  const [end, setEnd] = useState(rng.end);
  const [timeField, setTimeField] = useState('磅单审核通过时间'); // 默认: 磅单审核通过时间
  const [fetching, setFetching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState('');
  const [taskRunning, setTaskRunning] = useState(false);
  const pollRef = useRef<number | null>(null);
  const autoFetchedRef = useRef(false);     // 是否已自动获取过
  const autoComparedRef = useRef(false);    // 是否已自动对比过
  const autoLastSeenRef = useRef<string | null>(null); // 后端今日自动获取日期(用于轮询刷新)
  const viewRef = useRef({ start, end, timeField });   // 当前视图(供轮询判断是否默认视图)
  const autoPollRef = useRef<number | null>(null);     // 8点自动刷新轮询
  viewRef.current = { start, end, timeField };
  const defaultRangeRef = useRef(rng);                 // 工作日调整后的默认范围(周一=周五~周日), 供"默认视图"判断

  // 拉取结果统计
  const [fetchSummary, setFetchSummary] = useState<{
    waybill: { rows: number; headers: string[] } | null;
    billing: { rows: number; headers: string[] } | null;
    waybillCount: number | null;  // 按运单编号去重的运单数
    billingCount: number | null;
    timeField: string;
    range: string;
  } | null>(null);

  // ========== 字段筛选(每个表格的"已选列") ==========
  const [colFilter, setColFilter] = useState<Record<string, Set<string>>>({});

  // ========== 对比状态 ==========
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [sheetA, setSheetA] = useState(0);
  const [sheetB, setSheetB] = useState(0);
  const [mode, setMode] = useState<CompareMode>('key');
  const [keyCol, setKeyCol] = useState(0);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [result, setResult] = useState<CompareOutput | null>(null);
  const [msg, setMsg] = useState('');

  // ========== 工具: 取表格某 sheet 经"列筛选"投影后的数据 ==========
  function projectSheet(t: TableFile | undefined, sheetIdx: number): SheetData | null {
    if (!t) return null;
    const sheet = t.sheets[sheetIdx];
    if (!sheet) return null;
    const allCols = sheet.rows[0] || [];
    const allowed = colFilter[t.id];
    const keepIdx = allCols
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => !allowed || allowed.size === 0 || allowed.has(h) || i === 0)
      .map(({ i }) => i);
    if (keepIdx.length === 0) return null;
    const proj = sheet.rows.map((r) => keepIdx.map((i) => r[i] ?? ''));
    return { name: sheet.name + '(已筛选)', rows: proj };
  }

  // ========== 导入文件(原逻辑) ==========
  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setMsg('正在解析…');
    const { parseFile } = await import('../lib/tables');
    const parsed = await Promise.all(files.map(parseFile));
    const next = [...tables, ...parsed];
    setTables(next);
    saveTables(next);
    setMsg(`已导入 ${parsed.length} 个文件，当前共 ${next.length} 个表格。`);
    e.target.value = '';
  }

  function removeTable(id: string) {
    const next = tables.filter((t) => t.id !== id);
    setTables(next);
    saveTables(next);
    if (aId === id) setAId('');
    if (bId === id) setBId('');
    setResult(null);
    setColFilter((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  }

  // ========== 自动获取: 启动爬取 ==========
  async function startFetch() {
    if (fetching || taskRunning) {
      setMsg('已有任务在跑, 请先等它完成');
      return;
    }
    if (!start || !end || start > end) {
      setMsg('日期范围不合法 (开始 ≤ 结束)');
      return;
    }
    setFetching(true);
    setMsg('');
    setProgress(0);
    setProgressMsg('正在启动后端爬取…');
    setFetchSummary(null);
    try {
      const res = await fetch(`${COMPARE_API}/api/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start, end, time_field: timeField }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(`启动失败: ${data.error || res.statusText}`);
        setFetching(false);
        return;
      }
      setProgressMsg(`已提交, 等待浏览器登录态 + 爬取…`);
      beginPolling();
    } catch (e: any) {
      setMsg(`后端不可达 (是否启动了 compare_backend.py?): ${e.message}`);
      setFetching(false);
    }
  }

  // ========== 自动获取: 轮询进度 ==========
  function beginPolling() {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`${COMPARE_API}/api/status`);
        const data = await res.json();
        setTaskRunning(!!data.task_running);
        setProgress(data.progress || 0);
        setProgressMsg(data.message || data.stage || '');
        if (data.done || (!data.task_running && data.stage !== 'init' && data.stage !== 'idle')) {
          if (pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setFetching(false);
          if (data.error) {
            setMsg(`❌ 爬取失败: ${data.error}`);
            return;
          }
          await loadFetchedData();
        }
      } catch (e) {
        if (pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setFetching(false);
        setMsg(`后端连接断开: ${(e as Error).message}`);
      }
    }, 1500);
  }

  // ========== 自动获取: 拉取完数据塞入 tables(无参, 参数取自后端 meta) ==========
  async function loadFetchedData() {
    try {
      const [wRes, bRes] = await Promise.all([
        fetch(`${COMPARE_API}/api/data?source=waybill`).then((r) => r.json()),
        fetch(`${COMPARE_API}/api/data?source=billing`).then((r) => r.json()),
      ]);
      if (!wRes.ok && !bRes.ok) {
        setMsg('尚未获取到数据，可点「获取数据」手动拉取。');
        return;
      }
      // 参数优先用后端返回的 meta(同一次 fetch 的 start/end/time_field), 兜底用默认
      const s = wRes.start || bRes.start || defaultRange().start;
      const e = wRes.end || bRes.end || defaultRange().end;
      const tf = wRes.time_field || '磅单审核通过时间';

      const waybillSheet = wRes.ok ? rowsToSheet(wRes.headers, wRes.rows) : null;
      const billingSheet = bRes.ok ? rowsToSheet(bRes.headers, bRes.rows) : null;

      const newTables: TableFile[] = [];
      if (waybillSheet && waybillSheet.rows.length > 1) {
        newTables.push({
          id: uid(),
          name: `运单 (${tf} ${s}~${e})`,
          sheets: [waybillSheet],
          importedAt: Date.now(),
        });
      }
      if (billingSheet && billingSheet.rows.length > 1) {
        newTables.push({
          id: uid(),
          name: `货主计费 (创建时间 ${s}~${e})`,
          sheets: [billingSheet],
          importedAt: Date.now(),
        });
      }

      // 替换旧的两张自动表(同名则覆盖)
      const filtered = tables.filter(
        (t) => !t.name.startsWith('运单 (') && !t.name.startsWith('货主计费 (')
      );
      const next = [...filtered, ...newTables];
      setTables(next);
      saveTables(next);

      const wCount = waybillSheet ? countDistinctByCol(waybillSheet, '运单编号') : null;
      const bCount = billingSheet ? countDistinctByCol(billingSheet, '运单编号') : null;

      setFetchSummary({
        waybill: wRes.ok ? { rows: wRes.row_count, headers: wRes.headers } : null,
        billing: bRes.ok ? { rows: bRes.row_count, headers: bRes.headers } : null,
        waybillCount: wCount,
        billingCount: bCount,
        timeField: tf,
        range: `${s} ~ ${e}`,
      });

      setMsg(`✅ 已完成数据统计: 运单 ${wRes.row_count || 0} 行 / 计费 ${bRes.row_count || 0} 行`);
    } catch (err: any) {
      setMsg(`读取爬取数据失败: ${err.message}`);
    }
  }

  // 卸载清轮询
  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (autoPollRef.current) window.clearInterval(autoPollRef.current);
    };
  }, []);

  // ========== 每日 8 点自动刷新轮询(后端常驻调度, 到点拉完前端自动展示) ==========
  function startAutoPoll() {
    if (autoPollRef.current) return;
    autoPollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`${COMPARE_API}/api/status`);
        const st = await res.json();
        const today = localDate();
        if (st.auto_last_date === today && st.auto_last_date !== autoLastSeenRef.current) {
          autoLastSeenRef.current = st.auto_last_date;
          // 仅当用户停留在默认视图(工作日范围 + 磅单审核)时才自动刷新, 不打断手动查看
          const v = viewRef.current;
          const def = defaultRangeRef.current;
          const isDefaultView =
            v.start === def.start && v.end === def.end && v.timeField === '磅单审核通过时间';
          if (isDefaultView) {
            setMsg('🌅 每日 8:00 自动获取已完成，已更新最新数据');
            await loadFetchedData();
          }
        } else {
          autoLastSeenRef.current = st.auto_last_date || autoLastSeenRef.current;
        }
      } catch {
        /* 后端未起, 忽略 */
      }
    }, 60000);
  }

  // 挂载: 拉取调度信息(工作日判断) → 今日 8 点已自动获取则直接展示; 否则仅"当天首次"兜底拉一次
  useEffect(() => {
    if (autoFetchedRef.current) return;
    autoFetchedRef.current = true;
    const today = localDate();
    const flagKey = `wb_autofetch_${today}`;
    (async () => {
      let st: any = {};
      let sched: any = {};
      try {
        const sres = await fetch(`${COMPARE_API}/api/status`);
        st = await sres.json();
        autoLastSeenRef.current = st.auto_last_date || null;
      } catch {
        /* 后端未起, 走兜底拉取 */
      }
      // 调度信息: 工作日 / 节假日 / 下个工作日 / 今日自动范围(与后端同一份日历)
      try {
        const scres = await fetch(`${COMPARE_API}/api/schedule`);
        sched = await scres.json();
      } catch {
        sched = {};
      }
      const isWorkday = sched.is_workday !== false; // 取不到默认按工作日处理
      const range =
        sched.auto_range && sched.auto_range.start && sched.auto_range.end
          ? sched.auto_range
          : defaultRange();
      // 同步默认范围(输入框 + 默认视图判断), 使周一展示周五~周日等缺口范围
      setStart(range.start);
      setEnd(range.end);
      defaultRangeRef.current = range;

      if (!isWorkday) {
        const label = sched.reason === 'weekend' ? '周末' : '法定节假日';
        const nxt = sched.next_workday || '—';
        setMsg(`📴 今日为${label}，自动获取已跳过；下个工作日 ${nxt} 08:00 自动获取。`);
        startAutoPoll();
        return;
      }

      if (st.auto_last_date === today) {
        setMsg('📅 今日 8:00 自动获取已完成，正在展示最新数据…');
        await loadFetchedData();
        startAutoPoll();
        return;
      }
      // 今日还没数据: 仅当今天尚未自动拉取过, 才兜底拉一次(防止每次刷新都弹 Edge 窗口)
      let already = false;
      try { already = localStorage.getItem(flagKey) === '1'; } catch {}
      if (already) {
        setMsg('ℹ️ 今日数据尚未获取，可点「获取数据」手动拉取。');
        startAutoPoll();
        return;
      }
      try { localStorage.setItem(flagKey, '1'); } catch {}
      const t = window.setTimeout(() => {
        startFetch();
        startAutoPoll();
      }, 800);
      return () => window.clearTimeout(t);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自动对比: 获取完 → 选运单表为A、计费表为B → 关键列=运单编号 → 自动跑对比
  useEffect(() => {
    if (!fetchSummary) return;
    const w = tables.find((t) => t.name.startsWith('运单 ('));
    const b = tables.find((t) => t.name.startsWith('货主计费 ('));
    if (!w || !b) return;
    if (aId !== w.id || bId !== b.id) {
      setAId(w.id);
      setBId(b.id);
      // 确保 A 表列全选(运单编号一定在), 关键列默认运单编号
      const ha = w.sheets[0]?.rows[0] || [];
      selectAllCols(w.id, ha);
      const ki = ha.indexOf('运单编号');
      if (ki >= 0) setKeyCol(ki);
      return;
    }
    // 已选好表, 首次自动对比
    if (!autoComparedRef.current && !result) {
      autoComparedRef.current = true;
      const t = window.setTimeout(() => runCompare(), 300);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSummary, tables, aId, bId, keyCol]);

  // ========== 字段筛选 toggle ==========
  function toggleCol(tableId: string, col: string) {
    setColFilter((prev) => {
      const cur = new Set(prev[tableId] || []);
      if (cur.has(col)) cur.delete(col);
      else cur.add(col);
      return { ...prev, [tableId]: cur };
    });
    setResult(null);
  }

  function selectAllCols(tableId: string, cols: string[]) {
    setColFilter((prev) => ({ ...prev, [tableId]: new Set(cols) }));
    setResult(null);
  }

  function clearColFilter(tableId: string) {
    setColFilter((prev) => {
      const { [tableId]: _, ...rest } = prev;
      return rest;
    });
    setResult(null);
  }

  // ========== 跑对比(应用字段筛选) ==========
  function runCompare() {
    const ta = tables.find((t) => t.id === aId);
    const tb = tables.find((t) => t.id === bId);
    if (!ta || !tb) {
      setMsg('请选择两个表格进行对比。');
      return;
    }
    const projA = projectSheet(ta, sheetA);
    const projB = projectSheet(tb, sheetB);
    if (!projA || !projB) {
      setMsg('表格为空或列筛选后无数据。');
      return;
    }
    const out = compareTables(projA, projB, { mode, keyCol });
    setResult(out);
    setMsg('');
  }

  const ta = tables.find((t) => t.id === aId);
  const tb = tables.find((t) => t.id === bId);
  const headersA = ta?.sheets[sheetA]?.rows[0] ?? [];
  const headersB = tb?.sheets[sheetB]?.rows[0] ?? [];
  const allowedA = colFilter[aId];
  const allowedB = colFilter[bId];

  return (
    <div className="page">
      <div className="page-head">
        <h2>多表格导入与对比</h2>
        <label className="btn-primary">
          + 批量导入
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            style={{ display: 'none' }}
            onChange={onFiles}
          />
        </label>
      </div>

      {msg && <p className="muted">{msg}</p>}

      {/* ========== 自动获取面板 ========== */}
      <div className="auto-fetch-panel">
        <h3>🚀 自动获取承运云数据（工作日 8:00 自动 · 节假日跳过）</h3>
        <p className="muted small">
          后端在每个<b>工作日</b>的 <b>8:00</b> 自动获取「运单列表 + 货主计费」并导入下方表格；<b>周末及法定节假日自动跳过</b>，跨假期的缺口会在节后首个工作日一次性补取（例如周五~周日的数据，下周一 8:00 自动获取）。当天首次打开页面且今日 8 点尚未获取时，自动兜底拉取一次（之后刷新只读缓存，不再弹浏览器，省资源）。
        </p>
        <div className="cmp-row">
          <label>
            开始日期
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} disabled={fetching} />
          </label>
          <label>
            结束日期
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={fetching} />
          </label>
          <label>
            运单时间字段
            <select value={timeField} onChange={(e) => setTimeField(e.target.value)} disabled={fetching}>
              {TIME_FIELDS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          <button className="btn-primary" onClick={startFetch} disabled={fetching}>
            {fetching ? '获取中…' : '▶ 获取数据'}
          </button>
        </div>

        {(fetching || progress > 0) && (
          <div className="progress-wrap">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="progress-msg">
              {progress}% · {progressMsg}
              {taskRunning && <span className="dot-flash"> ●</span>}
            </span>
          </div>
        )}

        {fetchSummary && (
          <div className="fetch-summary">
            <strong>✅ 已完成数据统计</strong> (范围 {fetchSummary.range} / 运单时间字段 {fetchSummary.timeField})
            <div className="sum-row">
              <span className="sum-block">
                📦 运单: {fetchSummary.waybill?.rows || 0} 行 / {fetchSummary.waybill?.headers.length || 0} 列
              </span>
              <span className="sum-block">
                💰 货主计费: {fetchSummary.billing?.rows || 0} 行 / {fetchSummary.billing?.headers.length || 0} 列
              </span>
            </div>
            {/* 关键对比数据: 运单数(按运单编号去重) */}
            <div className="wb-key-stats">
              🚚 <strong>运单数对比</strong>：
              运单表 <b>{fetchSummary.waybillCount ?? '—'}</b> 条 ·
              计费表 <b>{fetchSummary.billingCount ?? '—'}</b> 条
              {fetchSummary.waybillCount != null && fetchSummary.billingCount != null && (
                <span className={fetchSummary.waybillCount === fetchSummary.billingCount ? 'wb-match' : 'wb-diff'}>
                  （差异 {Math.abs(fetchSummary.waybillCount - fetchSummary.billingCount)} 条）
                </span>
              )}
              {fetchSummary.waybillCount == null && <span className="wb-warn">（运单表无「运单编号」列）</span>}
              {fetchSummary.billingCount == null && <span className="wb-warn">（计费表无「运单编号」列）</span>}
            </div>
          </div>
        )}
      </div>

      {/* ========== 已导入表格列表 ========== */}
      <h3>已加载表格</h3>
      <div className="table-list">
        {tables.length === 0 && <p className="muted">还没有表格, 可点上方"批量导入"或"获取数据"。</p>}
        {tables.map((t) => {
          const cols = t.sheets[0]?.rows[0] || [];
          const sel = colFilter[t.id];
          return (
            <div className="table-chip" key={t.id}>
              <span>{t.name}</span>
              <span className="muted">
                {t.sheets.length} 个 sheet · {cols.length} 列
                {sel && sel.size > 0 && sel.size < cols.length && ` · 已筛 ${sel.size}`}
              </span>
              <button className="icon-btn" onClick={() => removeTable(t.id)}>×</button>
            </div>
          );
        })}
      </div>

      {/* ========== 对比设置 ========== */}
      {tables.length >= 2 && (
        <div className="compare-panel">
          <h3>对比设置 {aId && bId && <span className="muted small">（已自动选好两表，运单编号为关键列）</span>}</h3>
          <div className="cmp-row">
            <label>
              表格 A
              <select value={aId} onChange={(e) => { setAId(e.target.value); setResult(null); }}>
                <option value="">选择…</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label>
              Sheet
              <select
                value={sheetA}
                onChange={(e) => { setSheetA(Number(e.target.value)); setResult(null); }}
                disabled={!ta}
              >
                {ta?.sheets.map((s, i) => (
                  <option key={i} value={i}>{s.name}</option>
                ))}
              </select>
            </label>
            {aId && (
              <button className="btn-link" onClick={() => clearColFilter(aId)} disabled={!allowedA || allowedA.size === 0}>
                清空 A 字段筛选
              </button>
            )}
          </div>

          {aId && headersA.length > 0 && (
            <div className="col-filter">
              <div className="col-filter-head">
                <strong>表格 A 字段筛选</strong>
                <span className="muted small">（{allowedA?.size || 0} / {headersA.length} 已选 · 不选 = 全选）</span>
                <button className="btn-link" onClick={() => selectAllCols(aId, headersA)}>全选</button>
              </div>
              <div className="col-chip-list">
                {headersA.map((h, i) => (
                  <label key={i} className="col-chip">
                    <input
                      type="checkbox"
                      checked={!allowedA || allowedA.size === 0 || allowedA.has(h)}
                      onChange={() => toggleCol(aId, h)}
                    />
                    <span>{h || `第${i + 1}列`}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="cmp-row">
            <label>
              表格 B
              <select value={bId} onChange={(e) => { setBId(e.target.value); setResult(null); }}>
                <option value="">选择…</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label>
              Sheet
              <select
                value={sheetB}
                onChange={(e) => { setSheetB(Number(e.target.value)); setResult(null); }}
              >
                {tb?.sheets.map((s, i) => (
                  <option key={i} value={i}>{s.name}</option>
                ))}
              </select>
            </label>
            {bId && (
              <button className="btn-link" onClick={() => clearColFilter(bId)} disabled={!allowedB || allowedB.size === 0}>
                清空 B 字段筛选
              </button>
            )}
          </div>

          {bId && headersB.length > 0 && (
            <div className="col-filter">
              <div className="col-filter-head">
                <strong>表格 B 字段筛选</strong>
                <span className="muted small">（{allowedB?.size || 0} / {headersB.length} 已选 · 不选 = 全选）</span>
                <button className="btn-link" onClick={() => selectAllCols(bId, headersB)}>全选</button>
              </div>
              <div className="col-chip-list">
                {headersB.map((h, i) => (
                  <label key={i} className="col-chip">
                    <input
                      type="checkbox"
                      checked={!allowedB || allowedB.size === 0 || allowedB.has(h)}
                      onChange={() => toggleCol(bId, h)}
                    />
                    <span>{h || `第${i + 1}列`}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="cmp-row">
            <label>
              对比方式
              <select value={mode} onChange={(e) => setMode(e.target.value as CompareMode)}>
                <option value="key">按关键列匹配（推荐）</option>
                <option value="position">按位置逐格对比</option>
              </select>
            </label>
            {mode === 'key' && (
              <label>
                关键列
                <select value={keyCol} onChange={(e) => setKeyCol(Number(e.target.value))}>
                  {(projectSheet(ta, sheetA)?.rows[0] || headersA).map((h: string, i: number) => (
                    <option key={i} value={i}>{h || `第${i + 1}列`}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <button className="btn-primary" onClick={runCompare}>开始对比</button>
        </div>
      )}

      {/* ========== 对比结果 ========== */}
      {result && (
        <div className="result-panel">
          <div className="result-summary">
            <span className="sum-changed">不一致 {result.summary.changed}</span>
            <span className="sum-onlya">仅A有 {result.summary.onlyA}</span>
            <span className="sum-onlyb">新增(仅B) {result.summary.onlyB}</span>
            <label className="diff-toggle">
              <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
              仅看差异
            </label>
          </div>

          {/* 关键对比数据: 运单数(对比结果内也展示) */}
          {fetchSummary && (
            <div className="wb-key-stats result">
              🚚 <strong>运单数对比</strong>：
              运单表 <b>{fetchSummary.waybillCount ?? '—'}</b> 条 ·
              计费表 <b>{fetchSummary.billingCount ?? '—'}</b> 条
              {fetchSummary.waybillCount != null && fetchSummary.billingCount != null && (
                <span className={fetchSummary.waybillCount === fetchSummary.billingCount ? 'wb-match' : 'wb-diff'}>
                  （差异 {Math.abs(fetchSummary.waybillCount - fetchSummary.billingCount)} 条）
                </span>
              )}
            </div>
          )}

          <div className="diff-table-wrap">
            <table className="diff-table">
              <thead>
                <tr>
                  <th className="key-col">{result.mode === 'key' ? '关键列' : '行'}</th>
                  {result.headers.map((h) => (
                    <th key={h}>{h || '—'}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows
                  .filter((r) => (onlyDiff ? r.cells.some((c) => c.status !== 'same') : true))
                  .map((r) => (
                    <tr key={r.key}>
                      <td className="key-col">{r.key}</td>
                      {result.headers.map((h) => {
                        const cell = r.cells.find((c) => c.col === h);
                        if (!cell)
                          return (
                            <td key={h} className="c-empty">-</td>
                          );
                        return (
                          <td
                            key={h}
                            className={
                              'c-' +
                              (cell.status === 'changed'
                                ? 'changed'
                                : cell.status === 'onlyA'
                                ? 'onlya'
                                : cell.status === 'onlyB'
                                ? 'onlyb'
                                : 'same')
                            }
                          >
                            <div className="va">{cell.a || <span className="na">∅</span>}</div>
                            <div className="vb">{cell.b || <span className="na">∅</span>}</div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="legend">
            <span className="lg c-changed">红：不一致</span>
            <span className="lg c-onlya">黄：仅 A 有（B 缺失）</span>
            <span className="lg c-onlyb">绿：仅 B 有（新增）</span>
          </p>
        </div>
      )}
    </div>
  );
}
