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
  /** 当 A/B 均为数值且不一致时，记录 B - A 的差值（用于显示 Δ） */
  numDelta?: number;
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
  actionItems?: string[]; // 该章节明确的待办 / 行动项
}

export interface Meeting {
  id: string;
  title: string;
  date: string;
  audioPath?: string;
  transcript: string;
  chapters: Chapter[];
  summary: string;
  actionItems?: string[]; // 会议级行动项 / 待办（跨章节合并，便于一键抽取到任务页）
  createdAt: number;
}

export interface Settings {
  provider: 'openai' | 'deepseek' | 'qwen' | 'custom';
  baseUrl: string;     // 例如 https://api.openai.com/v1
  apiKey: string;
  whisperModel: string;
  chatModel: string;
  // —— 语音转写（ASR）可独立配置，与纪要（Chat）解耦 ——
  // 只有支持 OpenAI 兼容 /audio/transcriptions 的服务商才能做转写（如 OpenAI Whisper、
  // 通义 Paraformer、本地 whisper.cpp 等）。DeepSeek / 通义千问(对话) 不提供 ASR，需单独填写。
  asrProvider: 'openai' | 'qwen' | 'custom';
  asrBaseUrl: string;  // 支持 /audio/transcriptions 的接口地址
  asrApiKey: string;
  asrModel: string;    // 如 whisper-1 / paraformer
}
