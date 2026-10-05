// 测试脚本：不走 dsh，直接起宠物窗口，流式输出一段固定 markdown 并朗读总结
// 用法：node_modules/.bin/electron test-ui.js   （40 秒后自动关闭，或 Ctrl+C）
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execFileSync } = require('child_process')

// 和 main.js 一样的 spd-say 后备朗读
const SAY_LANG = (() => {
  try { return /^\s*\d+\s+cmn\s/m.test(execFileSync('espeak-ng', ['--voices'], { encoding: 'utf8', timeout: 3000 })) ? 'cmn' : '' } catch { return '' }
})()
let sayProc = null, sayStarted = false
ipcMain.on('speech:say', (_e, text, cfg = {}) => {
  const t = String(text || '').slice(0, 300)
  if (!t) return
  const args = [
    '-r', String(Math.round(((cfg.rate || 1) - 1) * 100)),
    '-p', String(Math.round(((cfg.pitch || 1) - 1) * 100)),
    '-m', 'none',
    ...(SAY_LANG ? ['-l', SAY_LANG] : []),
    t,
  ]
  sayProc = spawn('spd-say', args)
  sayStarted = true
  console.log(`[语音] spd-say 开始朗读（语言 ${SAY_LANG || '默认'}）：${t}`)
  sayProc.on('exit', (code) => { console.log(`[语音] spd-say 结束，退出码 ${code}`); sayProc = null })
  sayProc.on('error', (e) => { console.log(`[语音] spd-say 起不来：${e.message}`); sayProc = null })
})
ipcMain.on('speech:stop', () => { if (sayProc) { sayProc.kill(); sayProc = null } })

const ROOT = __dirname
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'))
const CANVAS = CONFIG.canvas || { width: 397, height: 481 }
const PET_W = CONFIG.petSize || 220
const SPRITE_H = Math.round(PET_W * CANVAS.height / CANVAS.width)
const CHAT_W = CONFIG.chatWidth || 360
const CHAT_H = CONFIG.chatHeight || 470
const WIN_W = CHAT_W + 10 + PET_W
const WIN_H = Math.max(CHAT_H, SPRITE_H) + 36

const DEFAULT_STYLE = {
  fontSize: 14, textColor: '#2B2540', textOpacity: 1,
  bubbleColor: '#FFFDF8', userColor: '#E4E7F7', bubbleOpacity: 0.82,
  panelColor: '#FFF8F0', panelOpacity: 0.22, showTags: false,
}

// 她要"说"的完整一段话：情绪标签 + 各种 markdown + 行内/行间公式 + 朗读总结
const FULL_TEXT = `[开心] 这是一次渲染测试，各种格式都来一点：

## 标题和列表

- **粗体**和*斜体*
- \`行内代码\`
- 第二个列表项

\`\`\`js
const neko = '小白'
console.log(neko)
\`\`\`

行内公式 $a^2+b^2=c^2$，再来个行间公式：

$$x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$$

〔朗读〕这是一次渲染测试，如果你听到这句话，说明小白的嗓子已经接好了。`

// 平铺合成器（niri 等）下透明无边框窗口可能不显示，用 OPAQUE=1 换成普通窗口
const OPAQUE = !!process.env.OPAQUE

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIN_W, height: WIN_H, show: false,
    transparent: !OPAQUE, frame: OPAQUE, resizable: !!OPAQUE, hasShadow: false,
    backgroundColor: OPAQUE ? '#FFF8F0' : '#00000000',
    alwaysOnTop: !OPAQUE,
    webPreferences: {
      preload: path.join(ROOT, 'preload-pet.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,
    },
  })
  win.loadFile(path.join(ROOT, 'pet.html'))
  win.once('ready-to-show', () => win.showInactive())

  const send = (ch, data) => win.webContents.send(ch, data)

  win.webContents.on('did-finish-load', async () => {
    send('pet:init', {
      canvas: CANVAS,
      idleMs: 45000,
      calm: { core: '平静', tag: '平静', main: { type: 'image', src: 'assets/placeholder.svg' }, talk: null },
      rendererScripts: [],
      layout: { side: 'left', chatW: CHAT_W, chatH: CHAT_H, petW: PET_W, spriteH: SPRITE_H, top: 36 },
      style: { ...DEFAULT_STYLE },
      defaultStyle: DEFAULT_STYLE,
      chatOpen: true,
      bubbleSeconds: 10,
      watchSeconds: 0,
      dormant: false,
      speech: { enabled: true, ...(CONFIG.speech || {}) },
    })

    // 语音系统自检：能不能拿到声音列表（拿不到说明 speech-dispatcher 没接上）
    const voices = await win.webContents.executeJavaScript(
      `new Promise(r => { const v = speechSynthesis.getVoices(); v.length ? r(v.map(x => x.lang + ':' + x.name)) : speechSynthesis.onvoiceschanged = () => r(speechSynthesis.getVoices().map(x => x.lang + ':' + x.name)); setTimeout(() => r([]), 3000) })`
    )
    console.log(`[语音] Chromium 语音列表 ${voices.length} 个（Linux 上是 0 也正常，会走 spd-say 后备）`)

    // 模拟一轮对话：流式输出 → 整句到齐（渲染 markdown）→ 回合结束（朗读）
    await new Promise(r => setTimeout(r, 800))
    send('chat:conn', true)
    send('chat:event', { type: 'turn-start', turn: 1, origin: 'user' })
    const chunks = FULL_TEXT.match(/[\s\S]{1,24}/g) || []
    for (const c of chunks) {
      send('chat:event', { type: 'delta', turn: 1, step: 1, text: c })
      await new Promise(r => setTimeout(r, 120))
    }
    send('chat:event', { type: 'message', turn: 1, step: 1, text: FULL_TEXT })
    await new Promise(r => setTimeout(r, 600))
    send('chat:event', { type: 'turn-end', silent: false })

    // 朗读有没有真的开始
    await new Promise(r => setTimeout(r, 1500))
    const synthSpeaking = await win.webContents.executeJavaScript(`'speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)`)
    const mdOk = await win.webContents.executeJavaScript(`!!document.querySelector('#log .b.her.md mjx-container svg') && !!document.querySelector('#log .b.her.md pre code')`)
    console.log(mdOk ? '[界面] markdown 和公式渲染 OK' : '[界面] markdown/公式没渲染出来，看窗口里的实际效果')
    console.log(synthSpeaking || sayStarted ? '[语音] 朗读已触发' : '[语音] 朗读没触发，检查 speechCfg 和 spd-say')

    // 渲染结果截个图，窗口不显示也能确认内容
    const img = await win.webContents.capturePage()
    fs.writeFileSync('/tmp/neko-ui-test.png', img.toPNG())
    console.log('[界面] 截图存在 /tmp/neko-ui-test.png')
  })

  setTimeout(() => app.quit(), 40000)
  app.on('window-all-closed', () => app.quit())
})
