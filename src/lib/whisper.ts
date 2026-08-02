// 浏览器本地 Whisper 转写（免费、离线、无需 API Key）
// 通过 CDN 动态加载 transformers.js，避免打包体积膨胀；模型首次使用从 HuggingFace CDN 下载并缓存。

export interface WhisperStatus {
  phase: 'model' | 'transcribe';
  message: string;
  progress?: number; // 0-100
}

// 动态从 CDN 加载 transformers.js（vite 会将其视为外部依赖，不打包进产物）
async function getTransformers(): Promise<any> {
  // @ts-ignore - 运行时从 CDN 加载，非编译期依赖
  return import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1');
}

let pipelineCache: any = null;
let modelCacheKey = '';

// 把音频 Blob 解码为 16kHz 单声道 Float32Array（Whisper 需要）
async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const arr = await blob.arrayBuffer();
  const AC: any =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) throw new Error('当前浏览器不支持 Web Audio，无法本地转写，请改用云端引擎。');
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(arr);
    const channel = buf.getChannelData(0); // 取第一声道
    return resample(channel, buf.sampleRate, 16000);
  } finally {
    if (ctx.close) ctx.close();
  }
}

// 线性插值重采样
function resample(input: Float32Array, inputRate: number, outputRate = 16000): Float32Array {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const newLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = idx - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

export async function transcribeLocal(
  blob: Blob,
  model: string,
  onStatus?: (s: WhisperStatus) => void
): Promise<string> {
  if (!blob || blob.size === 0) throw new Error('音频为空，请重新录制或选择文件。');

  const tf = await getTransformers();
  if (!pipelineCache || modelCacheKey !== model) {
    onStatus?.({
      phase: 'model',
      message: '正在加载本地语音识别模型…（首次约 140MB，请稍候，之后会缓存）',
      progress: 0,
    });
    pipelineCache = await tf.pipeline('automatic-speech-recognition', model, {
      progress_callback: (p: any) => {
        if (!p) return;
        if (p.status === 'progress' && typeof p.progress === 'number') {
          onStatus?.({
            phase: 'model',
            message: `模型加载中 ${Math.round(p.progress)}%`,
            progress: p.progress,
          });
        } else if (p.status === 'ready' || p.status === 'done') {
          onStatus?.({ phase: 'model', message: '模型就绪', progress: 100 });
        }
      },
    });
    modelCacheKey = model;
  } else {
    onStatus?.({ phase: 'model', message: '模型已就绪（已缓存）', progress: 100 });
  }

  onStatus?.({ phase: 'transcribe', message: '正在转写…' });
  const audio = await decodeToMono16k(blob);
  const output = await pipelineCache(audio, {
    sampling_rate: 16000,
    return_timestamps: false,
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const text = typeof output === 'string' ? output : (output?.text ?? '');
  onStatus?.({ phase: 'transcribe', message: '转写完成' });
  return text.trim();
}
