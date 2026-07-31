import type { Settings, Chapter } from '../types';
import { uid } from './store';

// 调用云端大模型 API 做语音转写（OpenAI 兼容 Whisper 接口）
export async function transcribeAudio(
  blob: Blob,
  settings: Settings
): Promise<string> {
  if (!settings.apiKey) throw new Error('未配置 API Key，请先到「设置」页填写。');
  const url = `${settings.baseUrl.replace(/\/$/, '')}/audio/transcriptions`;
  const form = new FormData();
  form.append('file', blob, 'meeting.webm');
  form.append('model', settings.whisperModel);
  form.append('response_format', 'json');

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`转写请求失败（${res.status}）：${text.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => ({}));
  return (data.text as string) || '';
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
    const parsed = JSON.parse(content);
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
