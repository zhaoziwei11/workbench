// 全局类型定义

export type Priority = 'high' | 'medium' | 'low';
export type StepStatus = 'pending' | 'done';

export interface Step {
  id: string;
  text: string;        // 步骤描述 / 具体操作
  note?: string;       // 进展备注
  status: StepStatus;
  updatedAt: number;
}

export interface Task {
  id: string;
  title: string;
  content: string;     // 任务内容 / 详情
  priority: Priority;
  date: string;        // 归属日期 YYYY-MM-DD
  steps: Step[];
  createdAt: number;
  updatedAt: number;
}

export interface SheetData {
  name: string;
  rows: string[][];    // 已解析的二维数据（含表头行）
}

export interface TableFile {
  id: string;
  name: string;
  sheets: SheetData[];
  importedAt: number;
}

export type CompareMode = 'key' | 'position';

export interface CellDiff {
  col: string;
  a: string;
  b: string;
  status: 'same' | 'changed' | 'onlyA' | 'onlyB';
}

export interface RowDiff {
  key: string;
  cells: CellDiff[];
}

export interface CompareOutput {
  headers: string[];
  summary: {
    changed: number;
    onlyA: number;
    onlyB: number;
    columnsOnlyA: string[];
    columnsOnlyB: string[];
  };
  rows: RowDiff[];
  mode: CompareMode;
}

export interface Chapter {
  id: string;
  title: string;
  content: string;     // 该章节文字 / 笔记
  start?: number;      // 起始秒（若可定位）
}

export interface Meeting {
  id: string;
  title: string;
  date: string;
  audioPath?: string;
  transcript: string;
  chapters: Chapter[];
  summary: string;
  createdAt: number;
}

export interface Settings {
  provider: 'openai' | 'custom';
  baseUrl: string;     // 例如 https://api.openai.com/v1
  apiKey: string;
  whisperModel: string;
  chatModel: string;
}
