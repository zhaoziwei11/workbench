# 个人工作台（Workbench）

一个覆盖四类日常办公场景的工作台，**支持手机与电脑安装、两端数据云端同步、保持一致**：

1. **每日工作管理** —— 按日期查看当日 / 历史任务，任务可展开看详情，支持分步记录操作步骤与进展、逐步更新完成状态、标记优先级。
2. **多表格导入与对比** —— 批量导入 Excel / CSV，支持「按关键列匹配」和「按位置逐格」两种对比模式，自动标出**不一致 / 缺失项（仅 A 有）/ 新增项（仅 B 有）**并高亮可视化。
3. **任务添加与自动日报** —— 随时新增任务（名称 / 内容 / 优先级），并根据当天所有任务的完成情况和步骤进展，**一键自动汇总生成 Markdown 日报**，可复制或导出。
4. **会议录音与纪要** —— 一键启动麦克风录音，结束后调用云端大模型 API（OpenAI 兼容 Whisper）转写为文字，并自动划分章节 / 议题生成结构化纪要与目录。

## 技术栈

- 桌面 / Web：**Electron** + Vite + React + TypeScript
- 移动端：**Expo / React Native**（与 Web 端共享同一套云端数据）
- 云端同步：**Supabase**（Postgres + Auth 邮箱密码 + 行级安全 RLS）
- SheetJS（`xlsx`）解析 Excel / CSV
- `MediaRecorder` 进行麦克风录音
- 云端大模型 API（OpenAI / DeepSeek / 通义千问等兼容接口）做转写与纪要

> **数据策略：本地优先 + 云端后台同步。** 未配置 / 未登录时退化为纯本地（localStorage / AsyncStorage）；登录后本地即时读写、后台推送到 Supabase，换设备登录自动拉取，两端保持一致。转写 API Key 含密钥，刻意不上云，仅存本机。

## 运行方式（电脑端 / Web）

```bash
# 1. 安装依赖（Electron 二进制慢时见下方「Electron 二进制下载慢」）
npm install

# 2-a. 纯前端开发预览（浏览器，localhost:5173）
npm run dev

# 2-b. 构建渲染层并启动桌面应用
npm run start          # = vite build && electron .

# 或者分开执行：
npm run build          # 仅构建前端（tsc 类型检查 + vite 打包）
npm run electron       # 启动桌面应用（需先 build）
```

> 首次 `npm install` 会下载 Electron 运行时（约 100MB+），请耐心等待。

### Electron 二进制下载慢 / 卡住怎么办

`electron` 包的 postinstall 会从 GitHub Release 下载运行时，在国内网络下可能非常慢甚至卡死。两种解法：

1. **使用国内镜像**（推荐）：
   ```bash
   ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ npm install
   # 或仅补下二进制：
   ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/ node node_modules/electron/install.js
   ```
2. **先做前端开发验证**：跳过二进制也能跑起前端（`npm run dev` 在浏览器 localhost:5173 完整可用），桌面启动等二进制就绪后再 `npm run electron`。

> 本项目代码已通过 `tsc` 类型检查与 `vite build` 构建验证；构建不依赖 Electron 二进制。
> ⚠️ 注意：在部分环境 `vite build` 清空 `dist` 时会被「安全删除（移到回收站）」拦截，若报错请先手动 `rm -rf dist` 再重新 `npm run build`（仅项目内构建产物，安全）。

## 启用云端同步（手机 + 电脑数据一致）

默认数据保存在本机，不联网。要两端同步，需接入 Supabase：

1. 打开 https://app.supabase.com 新建项目（选离你近的区域）。
2. 在 Supabase 控制台 **SQL Editor** 粘贴并运行 `supabase/schema.sql`（建表 + 行级安全策略）。
3. 拿到凭证：项目 **Project Settings → API** 中的 **Project URL** 和 **anon public key**。
4. 把凭证配置到两端：
   - 电脑 / Web 端：把 `.env.example` 复制为 `.env`，填入 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`。
   - 手机端：填入 `mobile/app.json` 的 `expo.extra.supabaseUrl` / `supabaseAnonKey`。
5. 在应用登录页用**邮箱注册 / 登录**，两端登录同一账号即可自动同步。

> 未配置时应用仍可纯本地使用（登录页提供「仅本地使用」入口）。RLS 保证每个用户只能读写自己的数据，anon key 公开但靠策略隔离。

## 移动端（Expo / React Native）

`mobile/` 是与 Web 端共享同一套云端数据的原生 App 工程，含任务 / 日报 / 会议 / 表格 / 设置五大模块，登录同一账号即与电脑端数据一致。

```bash
cd mobile
npm install
npm start          # 启动 Expo dev server
```

- **真机预览**：手机安装 **Expo Go**，扫描终端显示的二维码即可运行（无需 Android / iOS 工具链）。
- **出生产包**：
  - Android：`npx expo prebuild && npx expo run:android`（需 Android Studio / SDK）
  - iOS：`npx expo prebuild && npx expo run:ios`（需 Mac + Xcode）
- 类型检查：`npm run typecheck`

> 本机为 Windows，无法在此打出 iOS 包；表格导入与会议录音建议在电脑端操作，手机端以「查看 / 同步」为主。

## 使用前配置（会议转写必需）

打开左侧「设置」页：

- 选择服务商预设（OpenAI / DeepSeek / 通义千问）或「自定义」
- 填入对应 **API Key** 与模型名
- 转写使用 `/v1/audio/transcriptions`（Whisper 接口）
- 纪要使用 `/v1/chat/completions`（要求返回 JSON）

未配置 API Key 时，会议录音仍可录制与保存，转写 / 纪要会回退为本地启发式分段（按段落拆分），不影响其他模块使用。

## 目录结构

```
workbench/
├─ supabase/
│  └─ schema.sql        # Supabase 表结构 + 行级安全（RLS）
├─ electron/
│  ├─ main.cjs          # Electron 主进程（CommonJS，窗口 + 保存文件 IPC）
│  └─ preload.cjs       # 暴露安全的原生能力给渲染层
├─ src/
│  ├─ main.tsx          # 渲染层入口
│  ├─ App.tsx           # 登录路由 + 页面导航 + 任务状态
│  ├─ styles.css
│  ├─ vite-env.d.ts
│  ├─ types.ts
│  ├─ lib/
│  │  ├─ cloud.ts       # Supabase 客户端 + 鉴权 + 后台同步推送
│  │  ├─ store.ts       # 本地持久化（localStorage）+ 云端同步
│  │  ├─ date.ts
│  │  ├─ tables.ts      # 表格解析 + 对比算法
│  │  ├─ report.ts      # 日报生成
│  │  ├─ transcribe.ts  # 云端转写 + 纪要
│  │  └─ audio.ts       # 录音封装
│  ├─ components/       # Layout / Modal / TaskCard
│  └─ pages/            # 五个功能页面 + AuthPage（登录）
├─ .env.example         # Supabase 凭证样例（复制为 .env 启用同步）
├─ package.json
├─ vite.config.ts
└─ tsconfig*.json
mobile/                 # Expo 原生 App 工程（共享云端数据）
├─ app.json             # expo.extra 存 Supabase 凭证
├─ src/
│  ├─ App.tsx           # 导航 + 登录路由
│  ├─ screens.tsx       # 六个页面
│  ├─ theme.ts
│  └─ lib/              # cloud / store(AsyncStorage) / types / date / report
└─ package.json
```

## 已知边界 / 后续可扩展

- 录音目前采集**麦克风**音；若需采集系统 / 会议声音，需改用 `desktopCapturer` 并做音频混流（建议在电脑端实现）。
- 表格导入目前在电脑端体验最佳；手机端以查看已同步表格为主。
- 云端同步为「最后写入获胜」的简单冲突策略，未做字段级合并；如需更严谨的并发控制可后续引入 CRDT / 版本向量。
- 数据层当前为本地 + Supabase 双写，后续可接入实时订阅（Supabase Realtime）实现秒级互相同步。
