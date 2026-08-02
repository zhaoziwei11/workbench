import type { Settings, Chapter } from '../types';
import { uid } from './store';

// 取出实际用于语音转写（ASR）的配置：优先使用独立的 asr* 字段，
// 未单独配置时回退到主配置（向后兼容旧数据）。
function asrConfig(s: Settings) {
  return {
    baseUrl: (s.asrBaseUrl || s.baseUrl || '').replace(/\/$/, ''),
    apiKey: s.asrApiKey || s.apiKey,
    model: s.asrModel || s.whisperModel || 'whisper-1',
  };
}

// 根据 Blob 的 MIME 推断上传接口需要的文件扩展名（OpenAI Whisper 要求已知扩展名）
function extFromMime(type: string): string {
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/oga': 'ogg',
    'audio/flac': 'flac',
  };
  return map[type] || 'webm';
}

const MAX_SIZE = 25 * 1024 * 1024; // OpenAI Whisper 接口限制 25MB

// 调用云端大模型 API 做语音转写（OpenAI 兼容 Whisper 接口 /audio/transcriptions）
export async function transcribeAudio(blob: Blob, settings: Settings): Promise<string> {
  const cfg = asrConfig(settings);
  if (!cfg.apiKey) {
    throw new Error('未配置转写 API Key，请到「设置 → 语音转写(ASR)」填写。');
  }
  if (blob.size === 0) {
    throw new Error('音频为空，请重新录制或选择文件。');
  }
  if (blob.size > MAX_SIZE) {
    throw new Error(
      `音频过大（${(blob.size / 1024 / 1024).toFixed(1)}MB），超过接口 25MB 上限。` +
        '请缩短录音、压缩或分段后重试。'
    );
  }
  const url = `${cfg.baseUrl}/audio/transcriptions`;
  const form = new FormData();
  form.append('file', blob, `meeting.${extFromMime(blob.type)}`);
  form.append('model', cfg.model);
  form.append('response_format', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 分钟超时兜底
  try {
    const res = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body: form,
      },
      controller.signal
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`转写请求失败（${res.status}）：${text.slice(0, 200)}`);
    }
    const data = await res.json().catch(() => ({}));
    return (data.text as string) || '';
  } finally {
    clearTimeout(timer);
  }
}

// 带一次重试的网络请求（仅在网络错误 / 超时 / 5xx 时重试）
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  retries = 1
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetch(url, { ...init, signal });
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 1000)); // 退避后重试
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error('转写网络请求失败：' + msg);
}

interface ChapterResult {
  summary: string;
  chapters: Chapter[];
}

// 基于转写文本生成结构化会议纪要（摘要 + 章节）
export async function generateMinutes(
  transcript: string,
  settings: Settings
): Promise<ChapterResult> {
  if (!settings.apiKey) {
    return heuristicMinutes(transcript);
  }
  const url = `${settings.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const prompt = `你是一名专业的会议纪要助手。请根据下面的会议转写文本，输出 JSON（不要多余解释），结构如下：
{
  "summary": "一段 100 字以内的会议总体摘要",
  "chapters": [ { "title": "章节/议题标题", "content": "该章节要点，2-4 条" } ]
}
要求：根据内容语义自动划分 3-6 个章节；content 用换行分隔要点。\n\n会议转写文本：\n${transcript}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.chatModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) return heuristicMinutes(transcript);
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '{}';
    const parsed = parseJsonSafe(content);
    if (!parsed) return heuristicMinutes(transcript);
    const chapters: Chapter[] = (parsed.chapters ?? []).map((c: any) => ({
      id: uid(),
      title: String(c.title ?? '未命名章节'),
      content: String(c.content ?? ''),
    }));
    return { summary: String(parsed.summary ?? ''), chapters };
  } catch {
    return heuristicMinutes(transcript);
  }
}

// 容错解析：剥离 ```json 围栏，或从文本中抽取第一个 {...} 块，
// 避免模型偶然带围栏/解释文字时静默降级到启发式。
function parseJsonSafe(raw: string): any {
  if (!raw) return null;
  const t = raw.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* 继续尝试剥离 */
  }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* ignore */
    }
  }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      /* ignore */
    }
  }
  return null;
}

// 无 API / 调用失败时的启发式兜底：按空行分段作为章节
function heuristicMinutes(transcript: string): ChapterResult {
  const paras = transcript
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chapters: Chapter[] = paras.slice(0, 8).map((p, i) => ({
    id: uid(),
    title: `章节 ${i + 1}`,
    content: p,
  }));
  const summary = paras[0]?.slice(0, 100) ?? '';
  return { summary, chapters };
}
