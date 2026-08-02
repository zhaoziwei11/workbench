import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TableFile, SheetData, CompareOutput, CompareMode, RowDiff } from '../types';
import { getTables, saveTables } from '../lib/store';
import { compareTables, parseFile } from '../lib/tables';

// ========== 前端直连承运云（零后端 / 零服务器 / 零费用） ==========
const GATEWAY = 'https://gateway.91msl.com/clx-performance/pc';
const WAYBILL_EP = '/carrier/orderChild/pageCarrierOrderChildList';
const BILLING_EP = '/carrier/settlementDriver/pageCarrierSettlementDriver';

const TOKEN_KEY = 'chengyun_token_v1';
const COUNT_KEY = '__count__'; // 「🚚 运单数对比」选项的 keyColOrMode 哨兵值

// ========== 字段中文别名表（接口列名 → 中文） ==========
// 表格 A（运单列表，50 列）
// 表格 B（货主计费，45 列）
// 未列出的字段保持英文名原样显示
const FIELD_LABELS: Record<string, string> = {
  // --- 表格 A：运单 ---
  ownerUserNo: '货主编号',
  ownerName: '货主名称',
  childNo: '子单号（运单号）',
  status: '状态',
  statusMsg: '状态描述',
  orderNo: '订单号',
  orderGoodsNo: '货号',
  goodsName: '货物名称',
  driverName: '司机姓名',
  driverMobile: '司机电话',
  freightPrice: '运费',
  loadNet: '装货净重',
  unloadNet: '卸货净重',
  loadRough: '装货毛重',
  loadTare: '装货皮重',
  unloadRough: '卸货毛重',
  unloadTare: '卸货皮重',
  payTime: '支付时间',
  goToSendTime: '去装货时间',
  arriveSendTime: '到装货时间',
  firstLoadTime: '首次装货时间',
  goToReceiveTime: '去卸货时间',
  arriveReceiveTime: '到卸货时间',
  ownerConfirmTruckTime: '货主确认发车时间',
  systemAutoConfirmTime: '系统自动确认时间',
  firstUnloadTime: '首次卸货时间',
  waitSettlementTime: '待结算时间',
  confirmTime: '确认时间',
  finishTime: '完成时间',
  poundAuditTime: '过磅审核时间',
  sendAddress: '发货地址',
  receiveAddress: '收货地址',
  truckNo: '车牌号',
  orderSource: '订单来源',
  orderSourceMsg: '订单来源描述',
  transportCode: '运输代码',
  transportStatus: '运输状态',
  entranceTime: '进厂时间',
  departureTime: '出厂时间',
  recommendSort: '推荐排序',
  actualQueueTime: '实际排队时间',
  takeOrderWay: '接单方式',
  takeOrderWayMsg: '接单方式描述',
  appointmentTime: '预约时间',
  departEarlyTime: '提前发车时间',
  driverStatus: '司机状态',
  driverStatusMsg: '司机状态描述',
  electronicCodeChildType: '电签子单类型',
  electronicCodeChildTypeMsg: '电签子单类型描述',
  createTime: '创建时间',

  // --- 表格 B：货主计费 ---
  id: '记录ID',
  driverUserNo: '司机编号',
  goodsId: '货物ID',
  reportType: '报号类型',
  reportTypeMsg: '报号类型描述',
  invoiceType: '票据类型',
  invoiceTypeMsg: '票据类型描述',
  settlementNo: '结算单号',
  weight: '重量',
  lossWeight: '亏损重量',
  lossPrice: '亏损单价',
  lossFreight: '亏损运费',
  prepayFreight: '预付运费',
  prepayFreightFlag: '预付运费标记',
  loanFlag: '借款标记',
  loanFlagMsg: '借款标记描述',
  invoicingCompanyId: '开票公司ID',
  invoicingCompanyShorterName: '开票公司简称',
  platformFreightQuotationTaxType: '平台报价税率类型',
  platformFreightQuotationTaxTypeMsg: '平台报价税率类型描述',
  assistanceCosts: '协助费用',
  platformServiceFee: '平台服务费',
  platformServiceFeeRate: '平台服务费率',
  settlementFreight: '结算运费',
  shouldSettlementFreight: '应结运费',
  consumptionCardRate: '消费卡费率',
  consumptionCardAmount: '消费卡金额',
  settleTime: '结算时间',
  settlementPlatform: '结算平台',
  payErrorMsg: '支付错误信息',
  consumptionCardSettlementStatus: '消费卡结算状态',
  consumptionCardSettlementStatusMsg: '消费卡结算状态描述',
  ownerCompanyName: '货主公司名称',
};

// 字段显示名：「中文 (英文)」
function fieldLabel(key: string): string {
  const zh = FIELD_LABELS[key];
  return zh ? `${zh} (${key})` : key;
}

// ========== 智能识别「标识类」列（编号 / 单号 / No / ID 等） ==========
function isIdCol(h: string): boolean {
  const L = (h || '').toLowerCase();
  if (L === 'childno' || L === 'orderno' || L === 'id') return true;
  if (/(no|num|id)$/.test(L)) return true;
  if (/(编号|单号|编码|号码|单)$/.test(h || '')) return true;
  return false;
}
function isDateCol(h: string): boolean {
  const L = (h || '').toLowerCase();
  if (/(time|date)$/.test(L)) return true;
  if (/(时间|日期)$/.test(h || '')) return true;
  return false;
}

// 在两张表共同列里挑最像「关键列」的那个（优先编号/单号类，避免误选时间列）
function pickBestKeyCol(ha: string[], hb: string[]): number {
  const common = ha.filter((h) => hb.includes(h));
  if (common.length === 0) return -1;
  const rank = (h: string) => {
    if (isIdCol(h)) return 0;
    if (isDateCol(h)) return 4; // 时间列优先度最低
    return 2;
  };
  common.sort((a, b) => rank(a) - rank(b));
  return ha.indexOf(common[0]);
}

// 自动检测「计数列」：childNo 优先，其次其他编号/单号类列，否则 -1
function autoDetectCountCol(headers: string[]): number {
  let i = headers.indexOf('childNo');
  if (i < 0) i = headers.findIndex((h) => isIdCol(h) && h !== 'childNo');
  return i;
}

// 数值保留最多 2 位小数
function formatNum(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r);
}

// ========== 工具函数 ==========
function localDate(d: Date = new Date()): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

function defaultRange() {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const s = localDate(y);
  return { start: s, end: s };
}

function uid() {
  return 'tb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 判断是否为「承运云自动拉取」生成的表（避免与用户导入的表混淆）
function isCloudTable(t: TableFile): boolean {
  return t.name.startsWith('运单 (') || t.name.startsWith('货主计费 (');
}

function recordsToSheet(name: string, records: any[]): SheetData | null {
  if (!records || records.length === 0) return null;
  const headers: string[] = Object.keys(records[0]);
  const rows = records.map((r) => headers.map((h) => (r[h] == null ? '' : String(r[h]))));
  return { name, rows: [headers, ...rows] };
}

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

// ========== 运单数对比结果类型（与逐行对比区分） ==========
interface CountCompareResult {
  kind: 'count';
  totalA: number;
  totalB: number;
  both: number;
  onlyA: string[];
  onlyB: string[];
  countCol: string;
  tableAName: string;
  tableBName: string;
}

export function TablesPage() {
  const [tables, setTables] = useState<TableFile[]>([]);
  useEffect(() => {
    getTables().then(setTables);
  }, []);

  // ========== 数据源模式：承运云直连 / 导入文件对比 ==========
  const [srcMode, setSrcMode] = useState<'cloud' | 'import'>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY) ? 'cloud' : 'import';
    } catch {
      return 'import';
    }
  });

  // ========== Token 管理 ==========
  const [token, setToken] = useState<string>(() => {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  });
  const [tokenInput, setTokenInput] = useState<string>(() => {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
  });
  const [tokenSaved, setTokenSaved] = useState<boolean>(() => {
    try { return !!localStorage.getItem(TOKEN_KEY); } catch { return false; }
  });

  function saveToken() {
    const v = tokenInput.trim();
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* ignore */ }
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
  const [fetchSummary, setFetchSummary] = useState<{
    waybill: { rows: number; headers: string[] } | null;
    billing: { rows: number; headers: string[] } | null;
    waybillCount: number | null;
    billingCount: number | null;
    range: string;
  } | null>(null);

  // ========== 字段筛选（复用为「参与对比的字段」） ==========
  const [colFilter, setColFilter] = useState<Record<string, Set<string>>>({});

  // ========== 对比状态 ==========
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const [sheetA, setSheetA] = useState(0);
  const [sheetB, setSheetB] = useState(0);
  const [mode, setMode] = useState<CompareMode>('key');
  // 关键列下拉的选中值：数字字符串（真实列索引）或 COUNT_KEY（运单数对比模式）
  const [keyColOrMode, setKeyColOrMode] = useState<string>('0');
  // 计数对比依据的列（-1 = 自动识别），支持任意模块的编号/单号类列
  const [countColIdx, setCountColIdx] = useState<number>(-1);
  // 逐行对比分页（避免大表一次性渲染卡死）
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 300;
  const [onlyDiff, setOnlyDiff] = useState(false);
  // 两种对比结果分别存（互斥）
  const [result, setResult] = useState<CompareOutput | null>(null);
  const [countResult, setCountResult] = useState<CountCompareResult | null>(null);
  const [showOnlyAList, setShowOnlyAList] = useState(false);
  const [showOnlyBList, setShowOnlyBList] = useState(false);
  const [msg, setMsg] = useState('');

  // 自动选表 / 自动跑对比的护卫（保证只自动做一遍，避免和手动操作打架）
  const autoFetchedRef = useRef(false);
  const autoSetupRef = useRef(false);
  const autoRunRef = useRef(false);

  // ========== 项目投影(按字段筛选投影) ==========
  function projectSheet(t: TableFile | undefined, sheetIdx: number, allowed?: Set<string>): SheetData | null {
    if (!t) return null;
    const sheet = t.sheets[sheetIdx];
    if (!sheet) return null;
    const allCols = sheet.rows[0] || [];
    const keepIdx = allCols
      .map((h, i) => ({ h, i }))
      .filter(({ h, i }) => !allowed || allowed.size === 0 || allowed.has(h) || i === 0)
      .map(({ i }) => i);
    if (keepIdx.length === 0) return null;
    const proj = sheet.rows.map((r) => keepIdx.map((i) => r[i] ?? ''));
    return { name: sheet.name + '(已筛选)', rows: proj };
  }

  // ========== 导入文件（解析 + 入库，拖拽/点击通用） ==========
  async function handleFiles(files: File[]) {
    if (!files.length) return;
    setMsg('正在解析…');
    try {
      const parsed = await Promise.all(files.map(parseFile));
      const next = [...tables, ...parsed];
      setTables(next);
      saveTables(next);
      setMsg(`✅ 已导入 ${parsed.length} 个文件，当前共 ${next.length} 个表格。`);
    } catch (e: any) {
      setMsg(`❌ 解析失败：${e?.message || e}`);
    }
  }

  function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    handleFiles(files);
    e.target.value = '';
  }

  // 拖拽上传
  const [dragOver, setDragOver] = useState(false);
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) handleFiles(files);
  }

  function removeTable(id: string) {
    const next = tables.filter((t) => t.id !== id);
    setTables(next);
    saveTables(next);
    if (aId === id) setAId('');
    if (bId === id) setBId('');
    setResult(null);
    setCountResult(null);
    setColFilter((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  }

  // ========== 切换数据源模式（重置自动选/自动跑，避免残留上一次 A/B） ==========
  function switchMode(m: 'cloud' | 'import') {
    if (m === srcMode) return;
    setSrcMode(m);
    autoSetupRef.current = false;
    autoRunRef.current = false;
    setAId('');
    setBId('');
    setKeyColOrMode('0');
    setCountColIdx(-1);
    setPage(0);
    setResult(null);
    setCountResult(null);
    setMsg('');
  }

  // ========== 前端直连抓取（承运云） ==========
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
    setResult(null);
    setCountResult(null);
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
        const filtered = prev.filter((t) => !isCloudTable(t));
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

  // 挂载时若已存 Token 自动拉取一次（仅触发一次）
  useEffect(() => {
    if (autoFetchedRef.current) return;
    autoFetchedRef.current = true;
    if (token.trim()) fetchDirect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========== 自动选表：根据当前数据源模式挑两张表做 A/B ==========
  useEffect(() => {
    if (autoSetupRef.current) return;
    let a: TableFile | undefined;
    let b: TableFile | undefined;
    if (srcMode === 'cloud') {
      a = tables.find((t) => t.name.startsWith('运单 ('));
      b = tables.find((t) => t.name.startsWith('货主计费 ('));
    } else {
      const userTables = tables.filter((t) => !isCloudTable(t));
      if (userTables.length >= 2) {
        a = userTables[userTables.length - 2];
        b = userTables[userTables.length - 1];
      }
    }
    if (!a || !b) return;
    autoSetupRef.current = true;
    setAId(a.id);
    setBId(b.id);
    const ha = a.sheets[0]?.rows[0] || [];
    const hb = b.sheets[0]?.rows[0] || [];
    // 智能选关键列：优先编号/单号类共同列（支持任意模块数据，不限于 childNo）
    if (keyColOrMode !== COUNT_KEY) {
      const ki = pickBestKeyCol(ha, hb);
      if (ki >= 0) setKeyColOrMode(String(ki));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, srcMode]);

  // 进入计数对比模式时，自动识别计数列（childNo / 编号 / 单号类）
  useEffect(() => {
    if (keyColOrMode !== COUNT_KEY) return;
    if (countColIdx >= 0) return;
    const t = tables.find((x) => x.id === aId);
    const headers = t?.sheets[sheetA]?.rows[0] || [];
    setCountColIdx(autoDetectCountCol(headers));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyColOrMode, aId, sheetA, countColIdx]);

  // ========== 自动跑一次对比（A/B + 关键列都就绪后） ==========
  const runCompareRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!aId || !bId) return;
    if (autoRunRef.current) return;
    autoRunRef.current = true;
    const t = window.setTimeout(() => runCompareRef.current(), 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aId, bId, keyColOrMode]);

  // ========== 字段筛选 toggle ==========
  function toggleCol(tableId: string, col: string) {
    setColFilter((prev) => {
      const cur = new Set(prev[tableId] || []);
      if (cur.has(col)) cur.delete(col);
      else cur.add(col);
      return { ...prev, [tableId]: cur };
    });
    setResult(null);
    setCountResult(null);
  }

  function selectAllCols(tableId: string, cols: string[]) {
    setColFilter((prev) => ({ ...prev, [tableId]: new Set(cols) }));
    setResult(null);
    setCountResult(null);
  }

  function clearColFilter(tableId: string) {
    setColFilter((prev) => {
      const { [tableId]: _, ...rest } = prev;
      return rest;
    });
    setResult(null);
    setCountResult(null);
  }

  // ========== 跑对比(逐行 OR 运单数) ==========
  function runCompare() {
    const ta = tables.find((t) => t.id === aId);
    const tb = tables.find((t) => t.id === bId);
    if (!ta || !tb) {
      setMsg('请选择两个表格进行对比。');
      return;
    }
    const projA = projectSheet(ta, sheetA, colFilter[aId]);
    const projB = projectSheet(tb, sheetB, colFilter[bId]);
    if (!projA || !projB) {
      setMsg('表格为空或列筛选后无数据。');
      return;
    }

    // 模式：计数对比（按所选计数列去重，支持任意模块，不限于 childNo）
    if (keyColOrMode === COUNT_KEY) {
      const headersA = projA.rows[0] || [];
      let ci = countColIdx;
      if (ci < 0) ci = autoDetectCountCol(headersA);
      if (ci < 0) ci = 0;
      const countName = headersA[ci] || `第${ci + 1}列`;
      const idxA = headersA.indexOf(countName);
      const headersB = projB.rows[0] || [];
      const idxB = headersB.indexOf(countName);
      if (idxA < 0 || idxB < 0) {
        setMsg(`❌ 计数对比需要两表都包含「${countName}」列，请检查字段筛选或表格来源，或换一个计数列。`);
        setResult(null);
        setCountResult(null);
        return;
      }
      const setA = new Set<string>();
      const setB = new Set<string>();
      for (let i = 1; i < projA.rows.length; i++) {
        const v = (projA.rows[i][idxA] || '').trim();
        if (v) setA.add(v);
      }
      for (let i = 1; i < projB.rows.length; i++) {
        const v = (projB.rows[i][idxB] || '').trim();
        if (v) setB.add(v);
      }
      const onlyA: string[] = [];
      const onlyB: string[] = [];
      let both = 0;
      setA.forEach((k) => { if (setB.has(k)) both++; else onlyA.push(k); });
      setB.forEach((k) => { if (!setA.has(k)) onlyB.push(k); });
      onlyA.sort();
      onlyB.sort();
      setResult(null);
      setCountResult({
        kind: 'count',
        totalA: setA.size,
        totalB: setB.size,
        both,
        onlyA,
        onlyB,
        countCol: countName,
        tableAName: ta.name,
        tableBName: tb.name,
      });
      setShowOnlyAList(false);
      setShowOnlyBList(false);
      setPage(0);
      setMsg('');
      return;
    }

    // 模式：逐行对比（按所选关键列匹配）
    const keyCol = parseInt(keyColOrMode, 10);
    if (isNaN(keyCol) || keyCol < 0) {
      setMsg('请选择关键列。');
      return;
    }
    const out = compareTables(projA, projB, { mode, keyCol });
    setResult(out);
    setCountResult(null);
    setMsg('');
  }
  runCompareRef.current = runCompare; // 始终指向最新闭包，供自动跑使用

  // ========== 导出对比结果为 CSV（带 BOM，Excel 打开中文不乱码） ==========
  function downloadCSV(filename: string, lines: string[][]) {
    const esc = (s: unknown) => `"${String(s == null ? '' : s).replace(/"/g, '""')}"`;
    const csv = lines.map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportResult() {
    if (countResult) {
      const lines: string[][] = [['仅在A有', `仅在B有（计数列：${countResult.countCol}）`]];
      const max = Math.max(countResult.onlyA.length, countResult.onlyB.length);
      for (let i = 0; i < max; i++) {
        lines.push([countResult.onlyA[i] || '', countResult.onlyB[i] || '']);
      }
      downloadCSV(`计数对比_${countResult.countCol}.csv`, lines);
      return;
    }
    if (result) {
      const head = ['关键列/行', ...result.headers.flatMap((h) => [`${fieldLabel(h)} (A)`, `${fieldLabel(h)} (B)`, '状态'])];
      const lines: string[][] = [head];
      for (const r of result.rows) {
        const m = new Map(r.cells.map((c) => [c.col, c]));
        const row: string[] = [r.key];
        for (const h of result.headers) {
          const c = m.get(h);
          row.push(c ? c.a : '', c ? c.b : '', c ? c.status : '');
        }
        lines.push(row);
      }
      downloadCSV('逐行对比结果.csv', lines);
    }
  }

  // ========== 派生数据（用 useMemo 缓存，避免每次 render 重算导致下拉卡顿） ==========
  const ta = tables.find((t) => t.id === aId);
  const tb = tables.find((t) => t.id === bId);
  const allowedA = colFilter[aId];
  const allowedB = colFilter[bId];
  // 关键：每点一下下拉/勾字段都会触发 render；不 memo 会导致 projectSheet 每次都重建 1862 行的数组
  const projA = useMemo(
    () => projectSheet(ta, sheetA, allowedA),
    [ta, sheetA, allowedA]
  );
  // 关键列下拉显示用的列头：如果"已筛选"后保留某列就用之，否则用全量列头
  const headersForKeyDropdown = useMemo(() => {
    return projA?.rows[0] ?? ta?.sheets[sheetA]?.rows[0] ?? [];
  }, [projA, ta, sheetA]);

  // ========== 字段筛选渲染（每行 checkbox label 用中文别名） ==========
  function renderColChips(tableId: string, headers: string[], allowed?: Set<string>) {
    return headers.map((h, i) => (
      <label key={i} className="col-chip">
        <input
          type="checkbox"
          checked={!allowed || allowed.size === 0 || allowed.has(h)}
          onChange={() => toggleCol(tableId, h)}
        />
        <span title={h}>{fieldLabel(h) || `第${i + 1}列`}</span>
      </label>
    ));
  }

  // ========== 逐行对比结果：仅看差异 + 每行 cells 用 Map O(1) 查 ==========
  const visibleRows: RowDiff[] = useMemo(() => {
    if (!result) return [];
    if (!onlyDiff) return result.rows;
    return result.rows.filter((r) => r.cells.some((c) => c.status !== 'same'));
  }, [result, onlyDiff]);

  // 切换结果/筛选时回到第一页
  useEffect(() => { setPage(0); }, [result, onlyDiff]);

  // 分页：大表只渲染当前页，避免一次性渲染上万行卡死
  const pagedRows: RowDiff[] = useMemo(() => {
    const startIdx = page * PAGE_SIZE;
    return visibleRows.slice(startIdx, startIdx + PAGE_SIZE);
  }, [visibleRows, page]);
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));

  return (
    <div className="page">
      <div className="page-head">
        <h2>表格对比</h2>
        <div className="src-tabs">
          <button
            className={srcMode === 'cloud' ? 'tab active' : 'tab'}
            onClick={() => switchMode('cloud')}
          >
            承运云直连
          </button>
          <button
            className={srcMode === 'import' ? 'tab active' : 'tab'}
            onClick={() => switchMode('import')}
          >
            导入文件对比
          </button>
        </div>
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

      {/* ========== 承运云直连模式 ========== */}
      {srcMode === 'cloud' && (
        <>
          {/* Token 设置面板 */}
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

          {/* 数据获取面板 */}
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
              </div>
            )}
          </div>
        </>
      )}

      {/* ========== 导入文件对比模式 ========== */}
      {srcMode === 'import' && (
        <div className="auto-fetch-panel">
          <h3>📥 导入文件对比</h3>
          <p className="muted small">
            拖拽或选择任意 <b>CSV / Excel</b> 文件（可多选）。导入后会自动选最近两张表为「表格 A / B」，
            自动选两表第一个共同列作关键列，并自动跑一次对比。你想要对比哪些字段，可在下方
            <b>「字段筛选」</b>里勾选（勾选 = 参与对比）。
          </p>

          <div
            className={dragOver ? 'drop-zone drag' : 'drop-zone'}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => {
              const inp = document.getElementById('import-file-input') as HTMLInputElement | null;
              inp?.click();
            }}
          >
            <div className="drop-icon">⬆️</div>
            <div>把 CSV / Excel 文件拖到这里，或 <b>点击选择</b></div>
            <div className="muted small">支持 .csv .xlsx .xls，可一次选多个</div>
            <input
              id="import-file-input"
              type="file"
              accept=".xlsx,.xls,.csv"
              multiple
              style={{ display: 'none' }}
              onChange={onFiles}
            />
          </div>

          {/* 已加载表格列表（导入模式可见，可删除） */}
          <h3 style={{ marginTop: 16 }}>已加载表格</h3>
          <div className="table-list">
            {tables.length === 0 && <p className="muted">还没有表格，拖拽或点击上方区域导入文件。</p>}
            {tables.map((t) => {
              const cols = t.sheets[0]?.rows[0] || [];
              const sel = colFilter[t.id];
              return (
                <div className="table-chip" key={t.id}>
                  <span>{t.name} {isCloudTable(t) && <span className="muted">(承运云)</span>}</span>
                  <span className="muted">
                    {t.sheets.length} 个 sheet · {cols.length} 列
                    {sel && sel.size > 0 && sel.size < cols.length && ` · 已筛 ${sel.size}`}
                  </span>
                  <button className="icon-btn" onClick={() => removeTable(t.id)}>×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========== 对比设置（两种模式通用） ========== */}
      {tables.length >= 2 && (
        <div className="compare-panel">
          <h3>对比设置 {aId && bId && <span className="muted small">（已自动选好两表，默认按关键列匹配）</span>}</h3>
          <div className="cmp-row">
            <label>
              表格 A
              <select value={aId} onChange={(e) => { setAId(e.target.value); setResult(null); setCountResult(null); setCountColIdx(-1); autoRunRef.current = false; }}>
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
                onChange={(e) => { setSheetA(Number(e.target.value)); setResult(null); setCountResult(null); setCountColIdx(-1); setPage(0); }}
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

          {aId && (ta?.sheets[sheetA]?.rows[0]?.length ?? 0) > 0 && (
            <div className="col-filter">
              <div className="col-filter-head">
                <strong>表格 A · 参与对比的字段</strong>
                <span className="muted small">（{allowedA?.size || 0} / {ta?.sheets[sheetA]?.rows[0]?.length || 0} 已选 · 不选 = 全选）</span>
                <button className="btn-link" onClick={() => selectAllCols(aId, ta?.sheets[sheetA]?.rows[0] || [])}>全选</button>
              </div>
              <div className="col-chip-list">
                {renderColChips(aId, ta?.sheets[sheetA]?.rows[0] || [], allowedA)}
              </div>
            </div>
          )}

          <div className="cmp-row">
            <label>
              表格 B
              <select value={bId} onChange={(e) => { setBId(e.target.value); setResult(null); setCountResult(null); autoRunRef.current = false; }}>
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
                onChange={(e) => { setSheetB(Number(e.target.value)); setResult(null); setCountResult(null); }}
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

          {bId && (tb?.sheets[sheetB]?.rows[0]?.length ?? 0) > 0 && (
            <div className="col-filter">
              <div className="col-filter-head">
                <strong>表格 B · 参与对比的字段</strong>
                <span className="muted small">（{allowedB?.size || 0} / {tb?.sheets[sheetB]?.rows[0]?.length || 0} 已选 · 不选 = 全选）</span>
                <button className="btn-link" onClick={() => selectAllCols(bId, tb?.sheets[sheetB]?.rows[0] || [])}>全选</button>
              </div>
              <div className="col-chip-list">
                {renderColChips(bId, tb?.sheets[sheetB]?.rows[0] || [], allowedB)}
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
                <select value={keyColOrMode} onChange={(e) => setKeyColOrMode(e.target.value)}>
                  <option value={COUNT_KEY}>📊 计数对比（按所选计数列去重）</option>
                  {headersForKeyDropdown.map((h: string, i: number) => (
                    <option key={i} value={String(i)}>{fieldLabel(h) || `第${i + 1}列`}</option>
                  ))}
                </select>
              </label>
            )}
            {keyColOrMode === COUNT_KEY && (
              <label>
                计数列
                <select value={String(countColIdx)} onChange={(e) => setCountColIdx(Number(e.target.value))}>
                  {(() => {
                    const autoIdx = autoDetectCountCol(headersForKeyDropdown);
                    const autoName = autoIdx >= 0 ? fieldLabel(headersForKeyDropdown[autoIdx]) : '首列';
                    return <option value="-1">自动（{autoName}）</option>;
                  })()}
                  {headersForKeyDropdown.map((h: string, i: number) => (
                    <option key={i} value={String(i)}>{fieldLabel(h) || `第${i + 1}列`}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <button className="btn-primary" onClick={runCompare}>开始对比</button>
        </div>
      )}

      {/* ========== 对比结果：运单数对比模式 ========== */}
      {countResult && (
        <div className="result-panel">
          <div className="result-summary">
            <span className="sum-changed">共有 {countResult.both}</span>
            <span className="sum-onlya">仅 A 有 {countResult.onlyA.length}</span>
            <span className="sum-onlyb">仅 B 有 {countResult.onlyB.length}</span>
            <button className="btn-sm export-btn" onClick={exportResult}>⬇ 导出 CSV</button>
          </div>
          <div className="wb-key-stats result">
            📊 <strong>计数对比（按 {countResult.countCol} 去重）</strong>：
            A「{countResult.tableAName}」<b>{countResult.totalA}</b> 条 ·
            B「{countResult.tableBName}」<b>{countResult.totalB}</b> 条
            <span className={countResult.totalA === countResult.totalB ? 'wb-match' : 'wb-diff'}>
              （差异 {Math.abs(countResult.totalA - countResult.totalB)} 条）
            </span>
          </div>

          <div className="count-lists">
            <div className="count-list-block">
              <button
                className="btn-link"
                onClick={() => setShowOnlyAList((v) => !v)}
              >
                {showOnlyAList ? '▼' : '▶'} 仅 A 有（{countResult.onlyA.length} 条运单号）
              </button>
              {showOnlyAList && (
                <div className="count-list-body">
                  {countResult.onlyA.length === 0
                    ? <span className="muted">（无）</span>
                    : countResult.onlyA.map((k) => (
                        <span key={k} className="count-chip onlya">{k}</span>
                      ))}
                </div>
              )}
            </div>
            <div className="count-list-block">
              <button
                className="btn-link"
                onClick={() => setShowOnlyBList((v) => !v)}
              >
                {showOnlyBList ? '▼' : '▶'} 仅 B 有（{countResult.onlyB.length} 条运单号）
              </button>
              {showOnlyBList && (
                <div className="count-list-body">
                  {countResult.onlyB.length === 0
                    ? <span className="muted">（无）</span>
                    : countResult.onlyB.map((k) => (
                        <span key={k} className="count-chip onlyb">{k}</span>
                      ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========== 对比结果：逐行对比模式 ========== */}
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
            <button className="btn-sm export-btn" onClick={exportResult}>⬇ 导出 CSV</button>
          </div>

          <div className="diff-table-wrap">
            <table className="diff-table">
              <thead>
                <tr>
                  <th className="key-col">{result.mode === 'key' ? '关键列' : '行'}</th>
                  {result.headers.map((h) => (
                    <th key={h} title={h}>{fieldLabel(h) || h || '—'}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((r) => {
                  // 把 cells 转 Map，每格 O(1) 查（原来是 .find，O(cells)，3000 行 × 50 列 巨慢）
                  const cellMap = new Map<string, typeof r.cells[number]>();
                  for (const c of r.cells) cellMap.set(c.col, c);
                  return (
                    <tr key={r.key}>
                      <td className="key-col">{r.key}</td>
                      {result.headers.map((h) => {
                        const cell = cellMap.get(h);
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
                            {cell.numDelta != null && (
                              <div className={'delta ' + (cell.numDelta > 0 ? 'up' : cell.numDelta < 0 ? 'down' : '')}>
                                Δ {cell.numDelta > 0 ? '+' : ''}{formatNum(cell.numDelta)}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="pager">
              <button className="btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← 上一页</button>
              <span className="muted">
                第 {page + 1} / {totalPages} 页 · 显示 {page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, visibleRows.length)} 行 / 共 {visibleRows.length} 行
              </span>
              <button className="btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>下一页 →</button>
            </div>
          )}

          <p className="legend">
            <span className="lg c-changed">红：不一致</span>
            <span className="lg c-onlya">黄：仅 A 有（B 缺失）</span>
            <span className="lg c-onlyb">绿：仅 B 有（新增）</span>
            <span className="lg delta-note">Δ：数值类列 A→B 的增减</span>
          </p>
        </div>
      )}
    </div>
  );
}
