const { contextBridge, ipcRenderer } = require('electron');

// 在渲染进程通过 window.electronAPI 安全访问有限的原生能力
contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (defaultName, buffer) =>
    ipcRenderer.invoke('save-file', { defaultName, buffer }),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  // 删除已保存的录音文件（移入回收站，失败回退永久删除）；非桌面版无此方法
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  // 获取系统/会议声音源 id（渲染进程再用 getUserMedia 采集）；非桌面版返回 null
  getSystemAudioSourceId: () => ipcRenderer.invoke('get-system-audio-source'),
  isElectron: true,
});
