// 浏览器本地 Whisper 转写（免费、离线、无需 API Key）
// 所有运行资源（transformers.js / onnxruntime wasm / 模型）均自托管在站点同源的
// /whisper/ 目录下，不依赖任何外部 CDN（jsdelivr / huggingface 等在受限网络常被墙）。
// 只要能打开本页面（github.io），转写即可离线运行。

export interface WhisperStatus {
  phase: 'model' | 'transcribe';
  message: string;
  progress?: number;
}

// 计算站点根 URL（基于当前页面地址，兼容 /workbench/ 子路径与 file:// 本地）
function siteBase(): string {
  let base: string = './';
  try {
    // @ts-ignore - vite 注入
    base = import.meta.env.BASE_URL || './';
  } catch {
    base = './';
  }
  try {
    return new URL(base, location.href).href;
  } catch {
    return base;
  }
}

// 动态从站点同源加载自托管的 transformers.js（webpack bundle，已内联 onnxruntime-web）
async function getTransformers(): Promise<any> {
  const root = siteBase();
  const url = root + 'whisper/lib/transformers.js';
  const mod = await import(/* @vite-ignore */ url);
  const tf = mod.default ?? mod;
  // 把模型与 wasm 运行时指向同源自托管目录，彻底不走公网 hub
  if (tf.env) {
    tf.env.allowLocalModels = true;
    tf.env.localModelPath = root + 'whisper/models/';
    tf.env.backends.onnx.wasm.wasmPaths = root + 'whisper/ort/';
    tf.env.backends.onnx.wasm.numThreads = 1; // 单线程，避免 Worker 跨域/加载问题，稳定优先
    tf.env.useBrowserCache = false;
  }
  return tf;
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

  const root = siteBase();
  // model 形如 'Xenova/whisper-base'，映射到自托管目录 whisper/models/Xenova/whisper-base
  const modelPath = root + 'whisper/models/' + model;

  const tf = await getTransformers();
  if (!pipelineCache || modelCacheKey !== modelPath) {
    onStatus?.({
      phase: 'model',
      message: '正在加载本地语音识别模型…（首次从本站点下载，约 120MB，之后浏览器缓存）',
      progress: 0,
    });
    pipelineCache = await tf.pipeline('automatic-speech-recognition', modelPath, {
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
    modelCacheKey = modelPath;
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
