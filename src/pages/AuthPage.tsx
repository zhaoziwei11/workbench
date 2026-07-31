import { useState } from 'react';
import { signIn, signUp, isCloudConfigured } from '../lib/cloud';

interface Props {
  onLocal?: () => void;
}

export function AuthPage({ onLocal }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!email.trim() || password.length < 6) {
      setError('请输入邮箱，密码至少 6 位。');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        const res = await signUp(email.trim(), password);
        if (!res.session) {
          setInfo('注册成功！若开启邮箱确认，请先查收验证邮件再登录。');
        }
        // 若 res.session 存在，onAuthChange 会自动进入工作台
      } else {
        await signIn(email.trim(), password);
      }
    } catch (e: any) {
      setError(e?.message || '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>个人工作台</h1>
        <p className="muted">登录后，手机与电脑的数据自动同步、保持一致。</p>

        <div className="auth-tabs">
          <button className={mode === 'signin' ? 'on' : ''} onClick={() => setMode('signin')}>
            登录
          </button>
          <button className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>
            注册
          </button>
        </div>

        <form onSubmit={submit}>
          <label className="field">
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
            />
          </label>

          {error && <p className="error">{error}</p>}
          {info && <p className="muted">{info}</p>}

          <button className="btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? '处理中…' : mode === 'signin' ? '登录' : '注册并登录'}
          </button>
        </form>

        {!isCloudConfigured && (
          <p className="muted warn">
            未检测到云端配置（缺少 .env 中的 Supabase 凭证），无法开启同步。请先配置后再登录。
          </p>
        )}
        {onLocal && (
          <button className="link-btn" onClick={onLocal}>
            仅本地使用（不启用云端同步）
          </button>
        )}
      </div>
    </div>
  );
}
