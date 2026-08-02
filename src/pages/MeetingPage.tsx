import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Meeting, Chapter } from '../types';
import { getMeetings, saveMeetings, getSettings, uid } from '../lib/store';
import { todayStr } from '../lib/date';
import { AudioRecorder } from '../lib/audio';
import { transcribeAudio, generateMinutes } from '../lib/transcribe';

interface Draft {
  title: string;
  transcript: string;
  summary: string;
  chapters: Chapter[];
  audioPath?: string;
  audioBlob?: Blob;
}

export function MeetingPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  useEffect(() => {
    getMeetings().then(setMeetings);
  }, []);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const recorderRef = useRef<AudioRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  async function startRec() {
    setError('');
    try {
      recorderRef.current = new AudioRecorder();
      await recorderRef.current.start();
      setRecording(true);
      setElapsed(0);
      setDraft({ title: `会议 ${todayStr()}`, transcript: '', summary: '', chapters: [] });
      timerRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e: any) {
      setError('无法访问麦克风：' + (e?.message || e));
    }
  }

  async function stopRec() {
    if (!recorderRef.current) return;
    const blob = await recorderRef.current.stop();
    if (timerRef.current) window.clearInterval(timerRef.current);
    setRecording(false);
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

  async function doTranscribe() {
    if (!draft?.audioBlob) return;
    setBusy('正在转写…');
    setError('');
    try {
      const text = await transcribeAudio(draft.audioBlob, getSettings());
      setDraft((d) => (d ? { ...d, transcript: text } : d));
    } catch (e: any) {
      setError(e?.message || '转写失败');
    } finally {
      setBusy('');
    }
  }

  // 一键：先转写，再生成结构化纪要
  async function doAll() {
    if (!draft?.audioBlob) return;
    setBusy('正在转写并生成纪要…');
    setError('');
    try {
      const text = await transcribeAudio(draft.audioBlob, getSettings());
      setDraft((d) => (d ? { ...d, transcript: text } : d));
      if (text) {
        const { summary, chapters } = await generateMinutes(text, getSettings());
        setDraft((d) => (d ? { ...d, summary, chapters } : d));
      }
    } catch (e: any) {
      setError(e?.message || '处理失败');
    } finally {
      setBusy('');
    }
  }

  async function doMinutes() {
    if (!draft?.transcript) return;
    setBusy('正在生成纪要…');
    setError('');
    try {
      const { summary, chapters } = await generateMinutes(draft.transcript, getSettings());
      setDraft((d) => (d ? { ...d, summary, chapters } : d));
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
      createdAt: Date.now(),
    };
    const next = [m, ...meetings];
    setMeetings(next);
    saveMeetings(next);
    setDraft(null);
  }

  function updateChapter(id: string, patch: Partial<Chapter>) {
    setDraft((d) =>
      d ? { ...d, chapters: d.chapters.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : d
    );
  }

  // 载入历史会议；桌面版会尝试读取已保存的录音文件，使其可「重新转写」
  async function loadMeeting(m: Meeting) {
    const next: Draft = {
      title: m.title,
      transcript: m.transcript,
      summary: m.summary,
      chapters: m.chapters,
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

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="page">
      <div className="page-head">
        <h2>会议录音与纪要</h2>
        {!recording ? (
          <button className="btn-primary" onClick={startRec}>
            🎙️ 开始录音
          </button>
        ) : (
          <button className="btn-danger" onClick={stopRec}>
            ■ 停止录音（{mm}:{ss}）
          </button>
        )}
        <button className="btn-sm" onClick={() => fileRef.current?.click()}>
          📁 上传音频转写
        </button>
      </div>

      {error && <p className="error">{error}</p>}

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
            {busy && <span className="muted">{busy}</span>}
          </div>
          {draft.audioPath && (
            <p className="muted">
              音频来源：{draft.audioPath}
              {draft.audioBlob ? '（可重新转写 / 生成纪要）' : '（桌面版将自动读取以重新转写）'}
            </p>
          )}

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
                <strong>章节目录</strong>
                {draft.chapters.length === 0 && <p className="muted">暂无章节，生成纪要后自动划分。</p>}
                {draft.chapters.map((c, i) => (
                  <div className="chapter-item" key={c.id}>
                    <input
                      className="chapter-title"
                      value={c.title}
                      onChange={(e) => updateChapter(c.id, { title: e.target.value })}
                    />
                    <textarea
                      rows={3}
                      value={c.content}
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
          </div>
        ))}
      </div>
    </div>
  );
}
