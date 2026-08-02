const { contextBridge, ipcRenderer } = require('electron');

// 在渲染进程通过 window.electronAPI 安全访问有限的原生能力
contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (defaultName, buffer) =>
    ipcRenderer.invoke('save-file', { defaultName, buffer }),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  isElectron: true,
});
