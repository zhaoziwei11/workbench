import { useState } from 'react';
import { signOut, isCloudConfigured, getCurrentUser } from '../lib/cloud';
import type { Settings } from '../types';
import { getSettings, saveSettings } from '../lib/store';

// 纪要（Chat）服务商预设
const CHAT_PRESETS: Record<string, { baseUrl: string; chatModel: string; label: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', chatModel: 'gpt-4o-mini', label: 'OpenAI' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', chatModel: 'deepseek-chat', label: 'DeepSeek（仅纪要，无语音识别）' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', chatModel: 'qwen-plus', label: '通义千问（仅纪要，无语音识别）' },
};

// 语音转写（ASR）服务商预设：只有真正支持 /audio/transcriptions 的才列在这里
const ASR_PRESETS: Record<string, { baseUrl: string; model: string; label: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', label: 'OpenAI Whisper（推荐）' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'paraformer', label: '通义 Paraformer' },
  custom: { baseUrl: '', model: '', label: '自定义' },
};

export function SettingsPage() {
  const [s, setS] = useState<Settings>(() => getSettings());
  const [saved, setSaved] = useState(false);

  function applyChatPreset(key: string) {
    const p = CHAT_PRESETS[key];
    if (!p) return;
    setS({
      ...s,
      provider: key as Settings['provider'],
      baseUrl: p.baseUrl,
      chatModel: p.chatModel,
    });
  }

  function applyAsrPreset(key: string) {
    const p = ASR_PRESETS[key];
    if (!p) return;
    setS({
      ...s,
      asrProvider: (key === 'openai' || key === 'qwen' ? key : 'custom') as Settings['asrProvider'],
      asrBaseUrl: p.baseUrl,
      asrModel: p.model,
    });
  }

  function save() {
    saveSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>设置</h2>
        <button className="btn-primary" onClick={save}>
          {saved ? '已保存 ✓' : '保存设置'}
        </button>
      </div>

      <div className="settings-form">
        {/* —— 纪要（Chat）服务商 —— */}
        <h3 className="settings-section">一、纪要 / 对话服务商</h3>
        <div className="field">
          <span>服务商预设</span>
          <div className="pri-group">
            {Object.entries(CHAT_PRESETS).map(([k, p]) => (
              <button
                key={k}
                className={'pri-btn' + (s.provider === k ? ' on' : '')}
                onClick={() => applyChatPreset(k)}
              >
                {p.label}
              </button>
            ))}
            <button
              className={'pri-btn' + (s.provider === 'custom' ? ' on' : '')}
              onClick={() => setS({ ...s, provider: 'custom' })}
            >
              自定义
            </button>
          </div>
        </div>

        <label className="field">
          <span>API Base URL</span>
          <input
            value={s.baseUrl}
            onChange={(e) => setS({ ...s, baseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
          />
        </label>

        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            value={s.apiKey}
            onChange={(e) => setS({ ...s, apiKey: e.target.value })}
            placeholder="sk-..."
          />
        </label>

        <label className="field">
          <span>纪要模型（Chat）</span>
          <input value={s.chatModel} onChange={(e) => setS({ ...s, chatModel: e.target.value })} />
        </label>

        {/* —— 语音转写（ASR）服务商（独立） —— */}
        <h3 className="settings-section">二、语音转写（ASR）服务商</h3>
        <p className="muted">
          语音转写需要服务商提供 OpenAI 兼容的 <code>/audio/transcriptions</code> 接口。
          DeepSeek、通义千问（对话）不提供语音识别，请用 OpenAI Whisper 或通义 Paraformer 等。
          留空则自动回退使用上方「纪要服务商」的 Key 与地址。
        </p>
        <div className="field">
          <span>转写服务商预设</span>
          <div className="pri-group">
            {Object.entries(ASR_PRESETS).map(([k, p]) => (
              <button
                key={k}
                className={'pri-btn' + (s.asrProvider === k ? ' on' : '')}
                onClick={() => applyAsrPreset(k)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>转写 API Base URL</span>
          <input
            value={s.asrBaseUrl}
            onChange={(e) => setS({ ...s, asrBaseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
          />
        </label>

        <label className="field">
          <span>转写 API Key</span>
          <input
            type="password"
            value={s.asrApiKey}
            onChange={(e) => setS({ ...s, asrApiKey: e.target.value })}
            placeholder="sk-...（可与纪要 Key 不同）"
          />
        </label>

        <label className="field">
          <span>转写模型</span>
          <input
            value={s.asrModel}
            onChange={(e) => setS({ ...s, asrModel: e.target.value })}
            placeholder="whisper-1 / paraformer"
          />
        </label>

        <p className="muted">
          说明：API Key 仅保存在本机（localStorage），不会上传到任何第三方。麦克风录音在浏览器 /
          Electron 中均需授权；上传音频支持 mp3 / m4a / wav / webm / ogg 等常见格式。
        </p>
        {isCloudConfigured && getCurrentUser() && (
          <div className="field-row account-row">
            <span>已登录：{getCurrentUser()?.email}</span>
            <button className="btn-danger" onClick={() => signOut()}>
              退出登录
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
