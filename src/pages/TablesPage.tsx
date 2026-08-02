import React, { useEffect, useRef, useState } from 'react';
import type { TableFile, SheetData, CompareOutput, CompareMode } from '../types';
import { getTables, saveTables } from '../lib/store';
import { compareTables, parseFile } from '../lib/tables';

// ========== 前端直连承运云（零后端 / 零服务器 / 零费用） ==========
// 承运云网关已确认开放跨域(Allow-Origin:* / Allow-Headers:*)，且对国内浏览器 IP 不封锁，
// 因此前端可直接用 Token 请求头 fetch 接口，无需 GitHub Actions / 本机后端。
const GATEWAY = 'https://gateway.91msl.com/clx-performance/pc';
const WAYBILL_EP = '/carrier/orderChild/pageCarrierOrderChildList';
const BILLING_EP = '/carrier/settlementDriver/pageCarrierSettlementDriver';

const TOKEN_KEY = 'chengyun_token_v1';

// 本地日期(按浏览器时区)
function localDate(d: Date = new Date()): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

// 默认日期范围 = 昨天一天(本地时区)
function defaultRange() {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const s = localDate(y);
  return { start: s, end: s };
}

function uid() {
  return 'tb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ========== 接口记录 => 二维表(加表头) ==========
function recordsToSheet(name: string, records: any[]): SheetData | null {
  if (!records || records.length === 0) return null;
  const headers: string[] = Object.keys(records[0]);
  const rows = records.map((r) => headers.map((h) => (r[h] == null ? '' : String(r[h]))));
  return { name, rows: [headers, ...rows] };
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

// ========== 直连抓取(分页拉全量) ==========
async function fetchAllRecords(endpoint: string, token: string, body: Record<string, any>): Promise<any[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Token: token,
    'Client-Type': 'pc',
    'Product-Code': 'carrier-platform-npc',
    Accept: 'application/json, text/plain, */*',
  };
  const all: any[] = [];
  const pageSize = 1000;
  for (let page = 1; page <= 300; page++) {
    const b = { ...body, page, pageSize };
    const r = await fetch(GATEWAY + endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(b),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
    const j = await r.json();
    if (j.code !== 0) throw new Error(`接口返回 code=${j.code}：${j.msg || '未知错误'}`);
    const data = j.data || {};
    const recs: any[] = data.records || [];
    all.push(...recs);
    const total = data.total || 0;
    if (all.length >= total || recs.length === 0) break;
  }
  return all;
}

export function TablesPage() {
  const [tables, setTables] = useState<TableFile[]>([]);
  useEffect(() => {
    getTables().then(setTables);
  }, []);

  // ========== Token 管理(存 localStorage) ==========
  const [token, setToken] = useState<string>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  });
  const [tokenInput, setTokenInput] = useState<string>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  });
  const [tokenSaved, setTokenSaved] = useState<boolean>(() => {
    try {
      return !!localStorage.getItem(TOKEN_KEY);
    } catch {
      return false;
    }
  });

  function saveToken() {
    const v = tokenInput.trim();
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setToken(v);
    setTokenSaved(!!v);
    setMsg(v ? '✅ Token 已保存（仅存于本机浏览器）' : '已清除 Token');
  }

  // ========== 日期范围 ==========
  const rng = defaultRange();
  const [start, setStart] = useState(rng.start);
  const [end, setEnd] = useState(rng.end);
  const [fetching, setFetching] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const autoFetchedRef = useRef(false);

  // 拉取结果统计
  const [fetchSummary, setFetchSummary] = useState<{
    waybill: { rows: number; headers: string[] } | null;
    billing: { rows: number; headers: string[] } | null;
    waybillCount: number | null;
    billingCount: number | null;
    range: string;
  } | null>(null);

  // ========== 字段筛选 ==========
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

  // ========== 导入文件(原逻辑保留) ==========
  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setMsg('正在解析…');
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

  // ========== 前端直连抓取(替代原云端 CSV 读取) ==========
  async function fetchDirect() {
    if (!token.trim()) {
      setMsg('⚠️ 请先在上方输入并保存承运云 Token。Token 在承运云页面 F12 → Network → 任意请求的 Request Headers 里 `Token:` 这一行。');
      return;
    }
    if (fetching) return;
    setFetching(true);
    setMsg('');
    setProgressMsg('正在从承运云拉取运单数据…');
    setFetchSummary(null);
    try {
      const wbBody = {
        orderNo: '', orderSource: ' ', childNo: '', orderGoodsNo: '', truckNo: '',
        driverName: '', driverMobile: '', sendAddress: '', receiveAddress: '',
        statusList: [], timeType: 16, ownerUserNos: [], driverStatus: [],
        electronicCodeChildType: [],
        beginTime: `${start} 00:00:00`, endTime: `${end} 23:59:59`,
      };
      const biBody = {
        childNo: '', status: '', consumptionCardSettlementStatus: '', orderGoodsNo: '',
        driverUserNo: '', driverUserName: '', platformFreightQuotationTaxType: '',
        ownerUserNos: [],
        startTime: `${start} 00:00:00`, endTime: `${end} 23:59:59`,
      };

      setProgressMsg('正在拉取「运单列表」…');
      const wbRecs = await fetchAllRecords(WAYBILL_EP, token, wbBody);
      setProgressMsg('正在拉取「货主计费(承运结算)」…');
      const biRecs = await fetchAllRecords(BILLING_EP, token, biBody);

      const wSheet = recordsToSheet(`运单 (${start}~${end})`, wbRecs);
      const bSheet = recordsToSheet(`货主计费 (${start}~${end})`, biRecs);

      const newTables: TableFile[] = [];
      if (wSheet && wSheet.rows.length > 1) {
        newTables.push({ id: uid(), name: `运单 (${start}~${end})`, sheets: [wSheet], importedAt: Date.now() });
      }
      if (bSheet && bSheet.rows.length > 1) {
        newTables.push({ id: uid(), name: `货主计费 (${start}~${end})`, sheets: [bSheet], importedAt: Date.now() });
      }

      let nextTables: TableFile[] = [];
      setTables((prev) => {
        const filtered = prev.filter(
          (t) => !t.name.startsWith('运单 (') && !t.name.startsWith('货主计费 (')
        );
        nextTables = [...filtered, ...newTables];
        return nextTables;
      });
      saveTables(nextTables);

      const wCount = wSheet ? countDistinctByCol(wSheet, 'childNo') : null;
      const bCount = bSheet ? countDistinctByCol(bSheet, 'childNo') : null;
      setFetchSummary({
        waybill: wSheet ? { rows: wSheet.rows.length - 1, headers: wSheet.rows[0] } : null,
        billing: bSheet ? { rows: bSheet.rows.length - 1, headers: bSheet.rows[0] } : null,
        waybillCount: wCount,
        billingCount: bCount,
        range: `${start} ~ ${end}`,
      });
      setMsg(
        `✅ 已获取承运云最新数据：运单 ${wSheet ? wSheet.rows.length - 1 : 0} 行 / 计费 ${bSheet ? bSheet.rows.length - 1 : 0} 行`
      );
    } catch (err: any) {
      setMsg(`❌ 获取失败：${err?.message || err}。请检查 Token 是否正确、日期范围是否合理。`);
    } finally {
      setFetching(false);
    }
  }

  // ========== 挂载: 若已存 Token 则自动按默认范围拉取一次 ==========
  useEffect(() => {
    if (autoFetchedRef.current) return;
    autoFetchedRef.current = true;
    if (token.trim()) {
      fetchDirect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自动对比: 获取完 → 选运单表为A、计费表为B → 关键列=childNo → 自动跑对比
  const autoComparedRef = useRef(false);
  useEffect(() => {
    if (!fetchSummary) return;
    const w = tables.find((t) => t.name.startsWith('运单 ('));
    const b = tables.find((t) => t.name.startsWith('货主计费 ('));
    if (!w || !b) return;
    if (aId !== w.id || bId !== b.id) {
      setAId(w.id);
      setBId(b.id);
      const ha = w.sheets[0]?.rows[0] || [];
      selectAllCols(w.id, ha);
      const ki = ha.indexOf('childNo');
      if (ki >= 0) setKeyCol(ki);
      return;
    }
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
        <h2>承运云数据对比（运单 vs 货主计费）</h2>
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

      {/* ========== Token 设置面板 ========== */}
      <div className="auto-fetch-panel">
        <h3>🔑 承运云 Token（仅存本机浏览器，不上传任何人）</h3>
        <p className="muted small">
          首次使用需粘贴一次 Token：打开承运云网页按 <b>F12</b> → Network → 任意请求 →
          Request Headers 里找 <b>Token:</b> 这一行，复制其值填下面。保存后刷新页面会自动按默认范围拉取数据。
        </p>
        <div className="cmp-row">
          <label style={{ flex: 1 }}>
            Token
            <input
              type="text"
              value={tokenInput}
              placeholder="粘贴 Token 值（如 ab9d5655...）"
              onChange={(e) => setTokenInput(e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
          <button className="btn-primary" onClick={saveToken}>
            {tokenSaved ? '更新/清除' : '保存 Token'}
          </button>
          {tokenSaved && <span className="wb-match">已保存 ✅</span>}
        </div>
      </div>

      {/* ========== 数据获取面板 ========== */}
      <div className="auto-fetch-panel">
        <h3>🚀 获取数据（前端直连承运云 · 零后端零费用）</h3>
        <p className="muted small">
          浏览器直接用你的 Token 请求承运云网关（网关已开放跨域）。选好日期范围点「获取数据」，
          即可拉取「运单列表 + 货主计费」并自动加载、自动对比。任意设备（公司/家用/手机）打开本页都能用。
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
          <button className="btn-primary" onClick={fetchDirect} disabled={fetching || !token.trim()}>
            {fetching ? '获取中…' : '▶ 获取数据'}
          </button>
        </div>

        {fetching && (
          <div className="progress-wrap">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: '60%' }} />
            </div>
            <span className="progress-msg">{progressMsg}</span>
          </div>
        )}

        {fetchSummary && (
          <div className="fetch-summary">
            <strong>✅ 已完成数据统计</strong> (范围 {fetchSummary.range})
            <div className="sum-row">
              <span className="sum-block">
                📦 运单: {fetchSummary.waybill?.rows || 0} 行 / {fetchSummary.waybill?.headers.length || 0} 列
              </span>
              <span className="sum-block">
                💰 货主计费: {fetchSummary.billing?.rows || 0} 行 / {fetchSummary.billing?.headers.length || 0} 列
              </span>
            </div>
            <div className="wb-key-stats">
              🚚 <strong>运单数对比（按子单号 childNo 去重）</strong>：
              运单表 <b>{fetchSummary.waybillCount ?? '—'}</b> 条 ·
              计费表 <b>{fetchSummary.billingCount ?? '—'}</b> 条
              {fetchSummary.waybillCount != null && fetchSummary.billingCount != null && (
                <span className={fetchSummary.waybillCount === fetchSummary.billingCount ? 'wb-match' : 'wb-diff'}>
                  （差异 {Math.abs(fetchSummary.waybillCount - fetchSummary.billingCount)} 条）
                </span>
              )}
              {fetchSummary.waybillCount == null && <span className="wb-warn">（运单表无 childNo 列）</span>}
              {fetchSummary.billingCount == null && <span className="wb-warn">（计费表无 childNo 列）</span>}
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
          <h3>对比设置 {aId && bId && <span className="muted small">（已自动选好两表，childNo 为关键列）</span>}</h3>
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
