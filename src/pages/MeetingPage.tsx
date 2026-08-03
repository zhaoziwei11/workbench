import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Meeting, Chapter } from '../types';
import { getMeetings, saveMeetings, getSettings, saveSettings, upsertTask, uid } from '../lib/store';
import { todayStr } from '../lib/date';
import { AudioRecorder } from '../lib/audio';
import { transcribeAudio, generateMinutes } from '../lib/transcribe';

interface Draft {
  title: string;
  transcript: string;
  summary: string;
  chapters: Chapter[];
  actionItems?: string[]; // 会议级行动项 / 待办
  audioPath?: string;
  audioBlob?: Blob;
}

const MAX_RECORD_SECONDS = 3 * 60 * 60; // 最长 3 小时自动停止，避免无限录制

// 尝试获取系统/会议声音流（仅桌面版 Electron 有效，失败则降级为仅麦克风）
async function getSystemAudioStream(): Promise<MediaStream | null> {
  try {
    const api = (window as any).electronAPI;
    const sourceId = api?.getSystemAudioSourceId ? await api.getSystemAudioSourceId() : null;
    if (!sourceId) return null;
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId },
      } as any,
    });
  } catch {
    return null;
  }
}

export function MeetingPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  useEffect(() => {
    getMeetings().then(setMeetings);
  }, []);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [mixSystem, setMixSystem] = useState(false); // 同时录制系统/会议声音
  const [elapsed, setElapsed] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [asrEngine, setAsrEngine] = useState<'local' | 'cloud'>(getSettings().asrEngine || 'local');
  const [whisperStatus, setWhisperStatus] = useState('');
  const recorderRef = useRef<AudioRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // 实时音量波形绘制
  function drawWave() {
    const canvas = canvasRef.current;
    const analyser = recorderRef.current?.getAnalyser();
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      analyser.getByteFrequencyData(buf);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const bars = 32;
      const step = Math.floor(buf.length / bars);
      const bw = canvas.width / bars;
      for (let i = 0; i < bars; i++) {
        const v = buf[i * step] / 255;
        const h = v * canvas.height;
        ctx.fillStyle = '#2563eb';
        ctx.fillRect(i * bw, canvas.height - h, Math.max(1, bw - 1), h);
      }
      if (!recorderRef.current?.isRecording && !recorderRef.current?.isPaused) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    loop();
  }

  async function startRec() {
    setError('');
    setNotice('');
    try {
      const recorder = new AudioRecorder();
      let sysStream: MediaStream | null = null;
      if (mixSystem) {
        sysStream = await getSystemAudioStream();
        if (!sysStream) setNotice('未能获取系统声音，将仅录制麦克风。');
      }
      await recorder.start(sysStream ? { systemStream: sysStream } : undefined);
      recorderRef.current = recorder;
      setRecording(true);
      setPaused(false);
      elapsedRef.current = 0;
      setElapsed(0);
      setDraft({
        title: `会议 ${todayStr()}`,
        transcript: '',
        summary: '',
        chapters: [],
        actionItems: [],
      });
      timerRef.current = window.setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
        if (elapsedRef.current >= MAX_RECORD_SECONDS) stopRec();
      }, 1000);
      drawWave();
    } catch (e: any) {
      setError('无法访问麦克风：' + (e?.message || e));
    }
  }

  async function stopRec() {
    if (!recorderRef.current) return;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const blob = await recorderRef.current.stop();
    if (timerRef.current) window.clearInterval(timerRef.current);
    setRecording(false);
    setPaused(false);
    // 保存音频到磁盘（Electron）或下载（浏览器）
    let audioPath: string | undefined;
    try {
      const api = (window as any).electronAPI;
      if (api?.saveFile) {
        const r = await api.saveFile(`会议录音_${todayStr()}.webm`, await blob.arrayBuffer());
        if (!r.canceled) audioPath = r.filePath;
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `会议录音_${todayStr()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      /* 忽略保存失败 */
    }
    setDraft((d) => (d ? { ...d, audioBlob: blob, audioPath } : d));
  }

  // 上传音频文件：选文件即建立一份新的草稿（无需先录音）
  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (!file) return;
    setError('');
    setDraft({
      title: file.name.replace(/\.[^.]+$/, ''),
      transcript: '',
      summary: '',
      chapters: [],
      audioBlob: file,
      audioPath: file.name,
    });
  }

  function switchEngine(e: 'local' | 'cloud') {
    setAsrEngine(e);
    const s = getSettings();
    saveSettings({ ...s, asrEngine: e });
  }

  async function doTranscribe() {
    if (!draft?.audioBlob) return;
    setBusy(asrEngine === 'local' ? '正在本地转写…' : '正在转写…');
    setError('');
    setWhisperStatus('');
    try {
      const text = await transcribeAudio(draft.audioBlob, getSettings(), {
        onStatus: (msg) => setWhisperStatus(msg),
      });
      setDraft((d) => (d ? { ...d, transcript: text } : d));
    } catch (e: any) {
      setError(e?.message || '转写失败');
    } finally {
      setBusy('');
      setWhisperStatus('');
    }
  }

  // 一键：先转写，再生成结构化纪要
  async function doAll() {
    if (!draft?.audioBlob) return;
    setBusy(asrEngine === 'local' ? '正在本地转写并生成纪要…' : '正在转写并生成纪要…');
    setError('');
    setWhisperStatus('');
    try {
      const text = await transcribeAudio(draft.audioBlob, getSettings(), {
        onStatus: (msg) => setWhisperStatus(msg),
      });
      setDraft((d) => (d ? { ...d, transcript: text } : d));
      if (text) {
        const { summary, chapters, actionItems } = await generateMinutes(text, getSettings());
        setDraft((d) => (d ? { ...d, summary, chapters, actionItems } : d));
      }
    } catch (e: any) {
      setError(e?.message || '处理失败');
    } finally {
      setBusy('');
      setWhisperStatus('');
    }
  }

  async function doMinutes() {
    if (!draft?.transcript) return;
    setBusy('正在生成纪要…');
    setError('');
    try {
      const { summary, chapters, actionItems } = await generateMinutes(draft.transcript, getSettings());
      setDraft((d) => (d ? { ...d, summary, chapters, actionItems } : d));
    } catch (e: any) {
      setError(e?.message || '生成纪要失败');
    } finally {
      setBusy('');
    }
  }

  function saveMeeting() {
    if (!draft) return;
    const m: Meeting = {
      id: uid(),
      title: draft.title || `会议 ${todayStr()}`,
      date: todayStr(),
      audioPath: draft.audioPath,
      transcript: draft.transcript,
      summary: draft.summary,
      chapters: draft.chapters,
      actionItems: draft.actionItems,
      createdAt: Date.now(),
    };
    const next = [m, ...meetings];
    setMeetings(next);
    saveMeetings(next);
    setDraft(null);
  }

  // 一键：把纪要里的行动项 / 待办抽取为「任务」页的条目
  async function extractTasks() {
    const items = (draft?.actionItems ?? []).map((x) => x.trim()).filter(Boolean);
    if (items.length === 0) {
      setNotice('');
      setError('纪要里没有识别到待办项。可手动在下方补充行动项，或重新生成纪要。');
      return;
    }
    setError('');
    setBusy('正在把待办加入任务…');
    try {
      const stamp = Date.now();
      let count = 0;
      for (const item of items) {
        await upsertTask({
          id: uid(),
          title: item,
          content: `来自会议《${draft?.title || '未命名'}》的待办（${todayStr()}）`,
          priority: 'medium',
          date: todayStr(),
          steps: [],
          createdAt: stamp,
          updatedAt: stamp,
        });
        count++;
      }
      setNotice(`已把 ${count} 条待办加入「任务」页 ✅`);
    } catch (e: any) {
      setError(e?.message || '抽取失败');
    } finally {
      setBusy('');
    }
  }

  function updateChapter(id: string, patch: Partial<Chapter>) {
    setDraft((d) =>
      d ? { ...d, chapters: d.chapters.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : d
    );
  }

  function addChapter() {
    setDraft((d) =>
      d ? { ...d, chapters: [...d.chapters, { id: uid(), title: '', content: '' }] } : d
    );
  }

  function deleteChapter(id: string) {
    setDraft((d) => (d ? { ...d, chapters: d.chapters.filter((c) => c.id !== id) } : d));
  }

  function moveChapter(id: string, dir: -1 | 1) {
    setDraft((d) => {
      if (!d) return d;
      const idx = d.chapters.findIndex((c) => c.id === id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= d.chapters.length) return d;
      const next = [...d.chapters];
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...d, chapters: next };
    });
  }

  // 载入历史会议；桌面版会尝试读取已保存的录音文件，使其可「重新转写」
  async function loadMeeting(m: Meeting) {
    const next: Draft = {
      title: m.title,
      transcript: m.transcript,
      summary: m.summary,
      chapters: m.chapters,
      actionItems: m.actionItems,
      audioPath: m.audioPath,
    };
    try {
      const api = (window as any).electronAPI;
      if (m.audioPath && api?.readFile) {
        const buf = await api.readFile(m.audioPath);
        if (buf) next.audioBlob = new Blob([buf as ArrayBuffer], { type: 'audio/webm' });
      }
    } catch {
      /* 浏览器或无文件时忽略 */
    }
    setDraft(next);
  }

  // 删除整条历史会议（含其录音文件）；删除前确认，录音移入回收站可找回
  async function deleteMeeting(m: Meeting) {
    const hasAudio = !!m.audioPath;
    const ok = window.confirm(
      `确定删除会议《${m.title}》吗？${hasAudio ? '对应的录音文件将移入回收站（可找回）。' : ''}此操作不可撤销。`
    );
    if (!ok) return; // 取消 = 保留
    const next = meetings.filter((x) => x.id !== m.id);
    setMeetings(next);
    await saveMeetings(next);
    if (hasAudio) {
      try {
        const api = (window as any).electronAPI;
        if (api?.deleteFile) await api.deleteFile(m.audioPath!);
      } catch {
        /* 文件删除失败不影响会议记录清理 */
      }
    }
    setNotice(`已删除会议《${m.title}》${hasAudio ? '，录音已移入回收站' : ''} ✅`);
  }

  // 删除当前草稿里的录音（文件移入回收站），仅清掉音频，不删除会议正文
  async function deleteDraftAudio() {
    const path = draft?.audioPath;
    const ok = window.confirm('确定删除当前录音吗？文件将移入回收站（可找回）。');
    if (!ok) return;
    setDraft((d) => (d ? { ...d, audioBlob: undefined, audioPath: undefined } : d));
    if (path) {
      try {
        const api = (window as any).electronAPI;
        if (api?.deleteFile) await api.deleteFile(path);
      } catch {
        /* 忽略删除失败 */
      }
    }
    setNotice('已删除当前录音（文件已移入回收站） ✅');
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="page">
      <div className="page-head">
        <h2>会议录音与纪要</h2>
        {!recording ? (
          <>
            <button className="btn-primary" onClick={startRec}>
              🎙️ 开始录音
            </button>
            <label className="mix-toggle" title="仅桌面版(Windows/Mac)有效：开启后同时录制系统/会议声音">
              <input
                type="checkbox"
                checked={mixSystem}
                onChange={(e) => setMixSystem(e.target.checked)}
              />
              同时录制系统声音
            </label>
          </>
        ) : (
          <>
            <button className="btn-danger" onClick={stopRec}>
              ■ 停止（{mm}:{ss}）
            </button>
            {!paused ? (
              <button
                className="btn-sm"
                onClick={() => {
                  recorderRef.current?.pause();
                  setPaused(true);
                }}
              >
                ⏸ 暂停
              </button>
            ) : (
              <button
                className="btn-sm"
                onClick={() => {
                  recorderRef.current?.resume();
                  setPaused(false);
                }}
              >
                ▶ 继续
              </button>
            )}
            <canvas ref={canvasRef} width={260} height={36} className="waveform" title="实时音量" />
          </>
        )}
        <button className="btn-sm" onClick={() => fileRef.current?.click()}>
          📁 上传音频转写
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />

      {draft && (
        <div className="meeting-draft">
          <label className="field">
            <span>会议标题</span>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>

          <div className="asr-engine-row">
            <span className="muted">转写引擎</span>
            <div className="pri-group">
              <button
                className={'pri-btn' + (asrEngine === 'local' ? ' on' : '')}
                onClick={() => switchEngine('local')}
                title="浏览器本地 Whisper：免费、离线、无需 API Key（首次需下载模型）"
              >
                🆓 本地免费
              </button>
              <button
                className={'pri-btn' + (asrEngine === 'cloud' ? ' on' : '')}
                onClick={() => switchEngine('cloud')}
                title="云端 API：需到「设置」填写转写 Key"
              >
                ☁️ 云端 API
              </button>
            </div>
            {asrEngine === 'local' && (
              <span className="muted whisper-note">本地模式无需 Key，首次转写会从本站下载模型（约 120MB，之后缓存）；即使公司网络屏蔽公网 CDN 也能离线使用</span>
            )}
            {asrEngine === 'cloud' && !getSettings().asrApiKey && (
              <span className="muted whisper-note">云端模式需在「设置 → 语音转写(ASR)」填写 API Key</span>
            )}
          </div>
          {whisperStatus && <p className="notice">{whisperStatus}</p>}

          <div className="rec-actions">
            <button className="btn-sm" disabled={!draft.audioBlob || !!busy} onClick={doTranscribe}>
              转写为文字
            </button>
            <button
              className="btn-sm"
              disabled={!draft.transcript || !!busy}
              onClick={doMinutes}
            >
              生成结构化纪要
            </button>
            <button
              className="btn-sm"
              disabled={!draft.audioBlob || !!busy}
              onClick={doAll}
              title="先转写为文字，再生成结构化纪要"
            >
              ⚡ 转写并生成纪要
            </button>
            <button className="btn-primary" onClick={saveMeeting}>
              保存会议
            </button>
            <button
              className="btn-sm"
              disabled={!draft.actionItems || draft.actionItems.length === 0 || !!busy}
              onClick={extractTasks}
              title="把纪要识别出的行动项一键加入「任务」页"
            >
              📋 抽取待办到任务
            </button>
            {busy && <span className="muted">{busy}</span>}
          </div>
          {draft.audioPath && (
            <p className="muted audio-src">
              音频来源：{draft.audioPath}
              {draft.audioBlob ? '（可重新转写 / 生成纪要）' : '（桌面版将自动读取以重新转写）'}
              <button className="btn-sm mc-del-inline" onClick={deleteDraftAudio} title="删除当前录音（移入回收站）">
                删除录音
              </button>
            </p>
          )}

          <div className="action-items">
            <div className="ai-head">
              <strong>行动项 / 待办</strong>
              <span className="muted">（生成纪要后自动识别，可编辑，点「抽取待办到任务」加入任务页）</span>
            </div>
            {(draft.actionItems ?? []).length === 0 && (
              <p className="muted">暂无行动项。生成纪要后将自动列出会议中的待办事项。</p>
            )}
            {(draft.actionItems ?? []).map((item, i) => (
              <div className="ai-row" key={i}>
                <span className="ai-idx">{i + 1}</span>
                <textarea
                  rows={1}
                  value={item}
                  onChange={(e) =>
                    setDraft((d) => {
                      if (!d) return d;
                      const next = [...(d.actionItems ?? [])];
                      next[i] = e.target.value;
                      return { ...d, actionItems: next };
                    })
                  }
                />
                <button
                  className="ai-del"
                  title="删除该项"
                  onClick={() =>
                    setDraft((d) => {
                      if (!d) return d;
                      const next = (d.actionItems ?? []).filter((_, j) => j !== i);
                      return { ...d, actionItems: next };
                    })
                  }
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="btn-sm ai-add"
              onClick={() =>
                setDraft((d) => (d ? { ...d, actionItems: [...(d.actionItems ?? []), ''] } : d))
              }
            >
              ＋ 手动添加行动项
            </button>
          </div>

          <div className="meeting-grid">
            <div>
              <h3>转写文本</h3>
              <textarea
                className="transcript"
                value={draft.transcript}
                placeholder="点击「转写为文字」后自动填充，也可手动粘贴/编辑"
                onChange={(e) => setDraft({ ...draft, transcript: e.target.value })}
                rows={14}
              />
            </div>
            <div>
              <h3>结构化纪要</h3>
              <label className="field">
                <span>总体摘要</span>
                <textarea
                  rows={3}
                  value={draft.summary}
                  onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                />
              </label>
              <div className="chapter-dir">
                <div className="cd-head">
                  <strong>章节目录</strong>
                  <button className="btn-sm" onClick={addChapter}>
                    ＋ 新增章节
                  </button>
                </div>
                {draft.chapters.length === 0 && <p className="muted">暂无章节，生成纪要后自动划分。</p>}
                {draft.chapters.map((c, i) => (
                  <div className="chapter-item" key={c.id}>
                    <div className="ci-head">
                      <input
                        className="chapter-title"
                        value={c.title}
                        placeholder={`议题 ${i + 1}`}
                        onChange={(e) => updateChapter(c.id, { title: e.target.value })}
                      />
                      <div className="ci-ops">
                        <button
                          className="ci-btn"
                          disabled={i === 0}
                          title="上移"
                          onClick={() => moveChapter(c.id, -1)}
                        >
                          ↑
                        </button>
                        <button
                          className="ci-btn"
                          disabled={i === draft.chapters.length - 1}
                          title="下移"
                          onClick={() => moveChapter(c.id, 1)}
                        >
                          ↓
                        </button>
                        <button
                          className="ci-btn ci-del"
                          title="删除章节"
                          onClick={() => deleteChapter(c.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <textarea
                      rows={3}
                      value={c.content}
                      placeholder="该章节要点"
                      onChange={(e) => updateChapter(c.id, { content: e.target.value })}
                    />
                    <span className="muted">议题 {i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <h3>历史会议</h3>
      <div className="meeting-list">
        {meetings.length === 0 && <p className="muted">还没有保存的会议。</p>}
        {meetings.map((m) => (
          <div className="meeting-card" key={m.id} onClick={() => loadMeeting(m)}>
            <div className="mc-title">{m.title}</div>
            <div className="muted">
              {m.date} · {m.chapters.length} 个章节
              {m.audioPath ? ' · 有录音' : ''}
            </div>
            {m.summary && <div className="mc-sum">{m.summary}</div>}
            <button
              className="mc-del"
              title="删除会议及其录音"
              onClick={(e) => {
                e.stopPropagation();
                deleteMeeting(m);
              }}
            >
              🗑 删除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
