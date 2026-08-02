import * as XLSX from 'xlsx';
import type {
  TableFile,
  SheetData,
  CompareOutput,
  CompareMode,
  CellDiff,
  RowDiff,
} from '../types';
import { uid } from './store';

// 解析上传的文件（xlsx / xls / csv）为 TableFile
export async function parseFile(file: File): Promise<TableFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheets: SheetData[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    // 统一为字符串
    const clean = rows.map((r) => r.map((c) => (c == null ? '' : String(c))));
    return { name, rows: clean };
  });
  return {
    id: uid(),
    name: file.name,
    sheets,
    importedAt: Date.now(),
  };
}

function norm(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

// 是否为「数值」（支持千分位逗号与正负号），用于智能比对
function isNumeric(s: string): boolean {
  if (s == null || s === '') return false;
  const t = s.replace(/,/g, '').trim();
  if (t === '') return false;
  if (!/^-?\d*\.?\d+$/.test(t)) return false;
  return isFinite(Number(t));
}
function toNum(s: string): number {
  return Number(s.replace(/,/g, '').trim());
}

interface CompareOpts {
  mode: CompareMode;
  keyCol: number; // key 模式下用作匹配列的索引
}

// 对比两张表（取各自第一个 sheet 的数据）
export function compareTables(
  a: SheetData,
  b: SheetData,
  opts: CompareOpts
): CompareOutput {
  if (opts.mode === 'position') return compareByPosition(a, b);
  return compareByKey(a, b, opts.keyCol);
}

function compareByKey(a: SheetData, b: SheetData, keyCol: number): CompareOutput {
  const ha = a.rows[0] ?? [];
  const hb = b.rows[0] ?? [];
  const headers = Array.from(new Set([...ha, ...hb]));
  const columnsOnlyA = ha.filter((c) => !hb.includes(c));
  const columnsOnlyB = hb.filter((c) => !ha.includes(c));

  const mapA = new Map<string, string[]>();
  const mapB = new Map<string, string[]>();
  for (let i = 1; i < a.rows.length; i++) {
    const r = a.rows[i];
    const k = norm(r[keyCol]);
    if (k) mapA.set(k, r);
  }
  for (let i = 1; i < b.rows.length; i++) {
    const r = b.rows[i];
    const k = norm(r[keyCol]);
    if (k) mapB.set(k, r);
  }

  const keys = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));
  const rows: RowDiff[] = [];
  let changed = 0,
    onlyA = 0,
    onlyB = 0;

  for (const key of keys) {
    const ra = mapA.get(key);
    const rb = mapB.get(key);
    const cells: CellDiff[] = [];
    if (ra && !rb) {
      onlyA++;
      for (const col of ha) {
        cells.push({ col, a: norm(ra[ha.indexOf(col)]), b: '', status: 'onlyA' });
      }
      for (const col of columnsOnlyB) {
        cells.push({ col, a: '', b: norm((rb ?? [])[0]), status: 'onlyB' });
      }
    } else if (!ra && rb) {
      onlyB++;
      for (const col of columnsOnlyA) {
        cells.push({ col, a: '', b: '', status: 'onlyA' });
      }
      for (const col of hb) {
        cells.push({ col, a: '', b: norm(rb[hb.indexOf(col)]), status: 'onlyB' });
      }
    } else if (ra && rb) {
      const idxA = (col: string) => ha.indexOf(col);
      const idxB = (col: string) => hb.indexOf(col);
      for (const col of headers) {
        const va = idxA(col) >= 0 ? norm(ra[idxA(col)]) : '';
        const vb = idxB(col) >= 0 ? norm(rb[idxB(col)]) : '';
        if (va === vb) {
          cells.push({ col, a: va, b: vb, status: 'same' });
        } else if (isNumeric(va) && isNumeric(vb) && toNum(va) === toNum(vb)) {
          // 数值相等（如 100.00 与 100）视为一致
          cells.push({ col, a: va, b: vb, status: 'same' });
        } else {
          changed++;
          const cell: CellDiff = { col, a: va, b: vb, status: 'changed' };
          if (isNumeric(va) && isNumeric(vb)) cell.numDelta = toNum(vb) - toNum(va);
          cells.push(cell);
        }
      }
    }
    rows.push({ key, cells });
  }

  rows.sort((x, y) => {
    if (x.cells.some((c) => c.status === 'onlyB') && !y.cells.some((c) => c.status === 'onlyB'))
      return 1;
    if (!x.cells.some((c) => c.status === 'onlyB') && y.cells.some((c) => c.status === 'onlyB'))
      return -1;
    return 0;
  });

  return {
    headers,
    mode: 'key',
    summary: { changed, onlyA, onlyB, columnsOnlyA, columnsOnlyB },
    rows,
  };
}

function compareByPosition(a: SheetData, b: SheetData): CompareOutput {
  const ha = a.rows[0] ?? [];
  const hb = b.rows[0] ?? [];
  const headers = Array.from(new Set([...ha, ...hb]));
  const columnsOnlyA = ha.filter((c) => !hb.includes(c));
  const columnsOnlyB = hb.filter((c) => !ha.includes(c));
  const maxRows = Math.max(a.rows.length, b.rows.length);

  const rows: RowDiff[] = [];
  let changed = 0,
    onlyA = 0,
    onlyB = 0;

  for (let i = 1; i < maxRows; i++) {
    const ra = a.rows[i];
    const rb = b.rows[i];
    const cells: CellDiff[] = [];
    const key = `第 ${i} 行`;
    if (ra && !rb) {
      onlyA++;
      for (const col of ha)
        cells.push({ col, a: norm(ra[ha.indexOf(col)]), b: '', status: 'onlyA' });
      for (const col of columnsOnlyB) cells.push({ col, a: '', b: '', status: 'onlyB' });
    } else if (!ra && rb) {
      onlyB++;
      for (const col of columnsOnlyA) cells.push({ col, a: '', b: '', status: 'onlyA' });
      for (const col of hb)
        cells.push({ col, a: '', b: norm(rb[hb.indexOf(col)]), status: 'onlyB' });
    } else if (ra && rb) {
      for (const col of headers) {
        const ia = ha.indexOf(col);
        const ib = hb.indexOf(col);
        const va = ia >= 0 ? norm(ra[ia]) : '';
        const vb = ib >= 0 ? norm(rb[ib]) : '';
        if (va === vb) {
          cells.push({ col, a: va, b: vb, status: 'same' });
        } else if (isNumeric(va) && isNumeric(vb) && toNum(va) === toNum(vb)) {
          cells.push({ col, a: va, b: vb, status: 'same' });
        } else {
          changed++;
          const cell: CellDiff = { col, a: va, b: vb, status: 'changed' };
          if (isNumeric(va) && isNumeric(vb)) cell.numDelta = toNum(vb) - toNum(va);
          cells.push(cell);
        }
      }
    }
    rows.push({ key, cells });
  }

  return {
    headers,
    mode: 'position',
    summary: { changed, onlyA, onlyB, columnsOnlyA, columnsOnlyB },
    rows,
  };
}
