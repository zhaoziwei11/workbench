// 基于 MediaRecorder 的麦克风录音封装
// 支持：暂停/继续、分块(降低长录音丢失风险)、实时音量分析、与系统声音混流
export class AudioRecorder {
  private stream: MediaStream | null = null; // 麦克风
  private sysStream: MediaStream | null = null; // 系统/会议声音（可选）
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;

  private pickMime(): string {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'];
    for (const t of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return '';
  }

  // 获取实时音量分析器（用于波形/音量条），需先 start
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  async start(opts?: { systemStream?: MediaStream }): Promise<void> {
    this.sysStream = opts?.systemStream || null;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 最终用于录制的流：麦克风 +（可选）系统声音混流
    let recordStream: MediaStream = this.stream;
    if (this.sysStream) {
      try {
        const Ctx: typeof AudioContext =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        this.audioCtx = new Ctx();
        const dest = this.audioCtx.createMediaStreamDestination();
        this.audioCtx.createMediaStreamSource(this.stream).connect(dest);
        this.audioCtx.createMediaStreamSource(this.sysStream).connect(dest);
        recordStream = dest.stream;
      } catch {
        recordStream = this.stream; // 混流失败降级为仅麦克风
      }
    }

    const mime = this.pickMime();
    this.recorder = mime
      ? new MediaRecorder(recordStream, { mimeType: mime })
      : new MediaRecorder(recordStream);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    // 每 10s 切片一次：长会议若意外中断，已写入的分片仍在
    this.recorder.start(10000);

    // 音量分析（基于麦克风，仅用于可视化，不影响录制）
    try {
      const Ctx: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!this.audioCtx) this.audioCtx = new Ctx();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.audioCtx.createMediaStreamSource(this.stream).connect(this.analyser);
    } catch {
      /* 无波形也能正常录音 */
    }
  }

  pause(): void {
    if (this.recorder && this.recorder.state === 'recording') this.recorder.pause();
  }

  resume(): void {
    if (this.recorder && this.recorder.state === 'paused') this.recorder.resume();
  }

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  get isPaused(): boolean {
    return this.recorder?.state === 'paused';
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.recorder) {
        reject(new Error('录音未开始'));
        return;
      }
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, {
          type: this.recorder?.mimeType || 'audio/webm',
        });
        this.stream?.getTracks().forEach((t) => t.stop());
        this.sysStream?.getTracks().forEach((t) => t.stop());
        this.audioCtx?.close().catch(() => {});
        resolve(blob);
      };
      this.recorder.stop();
    });
  }
}
