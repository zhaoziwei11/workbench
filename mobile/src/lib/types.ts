// 全局类型定义（与 Web 端保持一致）
export type Priority = 'high' | 'medium' | 'low';
export type StepStatus = 'pending' | 'done';

export interface Step {
  id: string;
  text: string;
  note?: string;
  status: StepStatus;
  updatedAt: number;
}

export interface Task {
  id: string;
  title: string;
  content: string;
  priority: Priority;
  date: string;
  steps: Step[];
  createdAt: number;
  updatedAt: number;
}

export interface SheetData {
  name: string;
  rows: string[][];
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
  content: string;
  start?: number;
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
  baseUrl: string;
  apiKey: string;
  whisperModel: string;
  chatModel: string;
}
