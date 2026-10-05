const { contextBridge, ipcRenderer } = require('electron')

const ALLOWED = [
  'pet:init', 'pet:emotion', 'pet:status', 'pet:layout',
  'chat:event', 'chat:history', 'chat:conn', 'chat:toggle', 'chat:style',
  'watch:state', 'watch:flash', 'pet:dormant', 'speech:set',
]

contextBridge.exposeInMainWorld('pet', {
  hit: (on) => ipcRenderer.send('pet:hit', !!on),
  drag: (dx, dy) => ipcRenderer.send('pet:drag', { dx, dy }),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  menu: () => ipcRenderer.send('pet:menu'),
  emotion: (tag) => ipcRenderer.send('pet:emotion', tag),
  wake: () => ipcRenderer.send('pet:wake'),
  chatOpen: (open) => ipcRenderer.send('chat:open', open),
  saveStyle: (style) => ipcRenderer.send('style:save', style),
  send: (text) => ipcRenderer.invoke('chat:send', text),
  approve: (id, decision) => ipcRenderer.invoke('chat:approval', { id, decision }),
  cancel: () => ipcRenderer.invoke('chat:cancel'),
  say: (text, cfg) => ipcRenderer.send('speech:say', text, cfg),
  sayStop: () => ipcRenderer.send('speech:stop'),
  on: (channel, cb) => { if (ALLOWED.includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data)) },
})
