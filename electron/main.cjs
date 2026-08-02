const { app, BrowserWindow, dialog, ipcMain, desktopCapturer, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const distPath = path.join(__dirname, '..', 'dist', 'index.html');
const isDev = !fs.existsSync(distPath);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(distPath);
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 保存文件到磁盘（录音等）：暴露给渲染进程的 IPC
ipcMain.handle('save-file', async (_event, { defaultName, buffer }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'All Files', extensions: ['*'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return { canceled: false, filePath };
});

// 读取已保存的录音文件（用于历史会议「重新转写」）
ipcMain.handle('read-file', async (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
});

// 删除已保存的录音文件（历史会议「删除」时调用）
// 优先移入系统回收站（shell.trashItem），删除后仍可找回；回收站不可用再回退到永久删除。
ipcMain.handle('delete-file', async (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, reason: 'missing' };
  try {
    await shell.trashItem(filePath);
    return { ok: true, trashed: true };
  } catch (e) {
    // 回收站失败（如某些沙箱/网络盘），退回永久删除
    try {
      fs.rmSync(filePath, { force: true });
      return { ok: true, trashed: false };
    } catch (e2) {
      return { ok: false, reason: (e2 as any)?.message || 'delete-failed' };
    }
  }
});

// 获取系统/会议声音源 id（供渲染进程 getUserMedia 采集系统音频）
// 注意：需在 Electron 主进程调用 desktopCapturer；不同版本 API 略有差异，失败返回 null
ipcMain.handle('get-system-audio-source', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
    });
    // 优先取「整个屏幕」源，其次任意一个屏幕源
    const screen = sources.find((s) => s.id.startsWith('screen')) || sources[0];
    return screen ? screen.id : null;
  } catch {
    return null;
  }
});
