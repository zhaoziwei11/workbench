import { useState } from 'react';
import { signOut, isCloudConfigured, getCurrentUser } from '../lib/cloud';
import type { Settings } from '../types';
import { getSettings, saveSettings } from '../lib/store';

const PRESETS: Record<string, { baseUrl: string; whisperModel: string; chatModel: string; label: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', whisperModel: 'whisper-1', chatModel: 'gpt-4o-mini', label: 'OpenAI' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', whisperModel: 'whisper-1', chatModel: 'deepseek-chat', label: 'DeepSeek' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', whisperModel: 'whisper-1', chatModel: 'qwen-plus', label: '通义千问' },
};

export function SettingsPage() {
  const [s, setS] = useState<Settings>(() => getSettings());
  const [saved, setSaved] = useState(false);

  function applyPreset(key: string) {
    const p = PRESETS[key];
    if (!p) return;
    setS({ ...s, provider: key as Settings['provider'], baseUrl: p.baseUrl, whisperModel: p.whisperModel, chatModel: p.chatModel });
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
        <div className="field">
          <span>服务商预设</span>
          <div className="pri-group">
            {Object.entries(PRESETS).map(([k, p]) => (
              <button key={k} className={'pri-btn' + (s.provider === k ? ' on' : '')} onClick={() => applyPreset(k)}>
                {p.label}
              </button>
            ))}
            <button className={'pri-btn' + (s.provider === 'custom' ? ' on' : '')} onClick={() => setS({ ...s, provider: 'custom' })}>
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

        <div className="field-row">
          <label className="field">
            <span>转写模型（Whisper）</span>
            <input value={s.whisperModel} onChange={(e) => setS({ ...s, whisperModel: e.target.value })} />
          </label>
          <label className="field">
            <span>纪要模型（Chat）</span>
            <input value={s.chatModel} onChange={(e) => setS({ ...s, chatModel: e.target.value })} />
          </label>
        </div>

        <p className="muted">
          说明：API Key 仅保存在本机（localStorage），不会上传到任何第三方。转写使用 OpenAI 兼容的
          <code> /audio/transcriptions</code> 接口；纪要使用<code> /chat/completions</code> 接口并要求返回 JSON。
          国内兼容厂商（DeepSeek、通义千问等）可直接选用预设。麦克风录音在浏览器/Electron 中均需授权。
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
