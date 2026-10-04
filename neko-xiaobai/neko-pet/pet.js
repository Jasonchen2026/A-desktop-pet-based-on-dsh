// 桌宠画面：小白的表情、她旁边的对话框、头边气泡、外观设置

const $ = (id) => document.getElementById(id)
const root = $('root'), chat = $('chat'), stage = $('stage'), sprite = $('sprite')
const statusEl = $('status'), dot = $('dot'), eye = $('eye')
const logEl = $('log'), input = $('input'), sendBtn = $('send')
const speech = $('speech'), stylePop = $('style-pop'), conn = $('conn'), mood = $('mood'), thinkb = $('thinkb')

// =====================================================================
// 一、表情渲染器（动态表情的接口，见仓库根目录的 README）
// =====================================================================

const renderers = {}
function registerRenderer(type, factory) { renderers[type] = factory }
window.NekoPet = { registerRenderer }
const settle = (p, ms = 800) => Promise.race([p || Promise.resolve(), new Promise(r => setTimeout(r, ms))])

registerRenderer('image', (layer, spec) => {
  const img = new Image(); img.alt = ''; img.draggable = false; img.src = spec.src
  layer.appendChild(img)
  return { ready: img.decode().catch(() => {}) }
})
registerRenderer('video', (layer, spec) => {
  const v = document.createElement('video')
  v.muted = true; v.playsInline = true; v.autoplay = true; v.loop = spec.loop !== false; v.src = spec.src
  layer.appendChild(v)
  const ready = new Promise(r => { v.addEventListener('canplay', r, { once: true }); v.addEventListener('error', r, { once: true }) })
  v.play().catch(() => {})
  return { ready, destroy() { v.pause(); v.removeAttribute('src'); v.load() } }
})
registerRenderer('frames', (layer, spec) => {
  const frames = spec.frames || []
  const img = new Image(); img.alt = ''; img.draggable = false
  layer.appendChild(img)
  frames.forEach(f => { const p = new Image(); p.src = f })
  let i = 0
  img.src = frames[0] || ''
  const timer = setInterval(() => {
    i++
    if (i >= frames.length) { if (spec.loop === false) { clearInterval(timer); return } i = 0 }
    img.src = frames[i]
  }, 1000 / (spec.fps || 12))
  return { ready: img.decode().catch(() => {}), destroy() { clearInterval(timer) } }
})
registerRenderer('sheet', (layer, spec) => {
  const cols = spec.cols || 1, rows = spec.rows || 1, count = spec.count || cols * rows
  layer.classList.add('sheet')
  layer.style.backgroundImage = `url("${spec.src}")`
  layer.style.backgroundSize = `${cols * 100}% ${rows * 100}%`
  let i = 0
  const place = () => {
    const c = i % cols, r = Math.floor(i / cols)
    layer.style.backgroundPosition = `${cols > 1 ? c / (cols - 1) * 100 : 0}% ${rows > 1 ? r / (rows - 1) * 100 : 0}%`
  }
  place()
  const timer = setInterval(() => {
    i++
    if (i >= count) { if (spec.loop === false) { clearInterval(timer); return } i = 0 }
    place()
  }, 1000 / (spec.fps || 12))
  const pre = new Image(); pre.src = spec.src
  return { ready: pre.decode().catch(() => {}), destroy() { clearInterval(timer) } }
})

let current = null, showSeq = 0
async function showSpec(spec, key) {
  if (!spec) return
  if (current && current.key === key) { showSeq++; return }
  const factory = renderers[spec.type]
  if (!factory) { console.warn('[小白] 没有这种渲染器：', spec.type); return }
  const seq = ++showSeq
  const layer = document.createElement('div')
  layer.className = 'layer'
  sprite.appendChild(layer)
  let handle = {}
  try { handle = factory(layer, spec) || {} } catch (e) { console.warn(e); layer.remove(); return }
  await settle(handle.ready)
  if (seq !== showSeq) { try { handle.destroy && handle.destroy() } catch {} layer.remove(); return }
  const prev = current
  current = { key, layer, handle }
  requestAnimationFrame(() => layer.classList.add('on'))
  if (prev) {
    prev.layer.classList.remove('on')
    setTimeout(() => { try { prev.handle.destroy && prev.handle.destroy() } catch {} prev.layer.remove() }, 220)
  }
}

let calm = null, expr = null, talking = false, idleMs = 45000, idleTimer = null, dormant = false
function renderExpr() {
  if (!expr) return
  const useTalk = talking && expr.talk
  sprite.classList.toggle('talking', talking && !expr.talk)
  showSpec(useTalk ? expr.talk : expr.main, expr.core + (useTalk ? ':talk' : ''))
}
function setExpression(payload) {
  if (dormant && payload.core !== '困') return
  expr = payload
  renderExpr()
  clearTimeout(idleTimer)
  if (!dormant && calm && payload.core !== calm.core) idleTimer = setTimeout(() => { expr = calm; renderExpr() }, idleMs)
}
let talkOff = null
function setTalking(on) {
  clearTimeout(talkOff)
  if (on) { if (!talking) { talking = true; renderExpr() } }
  else talkOff = setTimeout(() => { talking = false; renderExpr() }, 700)
}
function loadScript(src) {
  return new Promise((resolve) => {
    const s = document.createElement('script'); s.src = src
    s.onload = resolve; s.onerror = () => { console.warn('[小白] 扩展脚本加载失败：', src); resolve() }
    document.head.appendChild(s)
  })
}

// =====================================================================
// 二、外观
// =====================================================================

let style = {}, defaultStyle = {}, bubbleSeconds = 10

function rgba(hex, a) {
  const h = String(hex || '#000000').replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16) || 0
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
function applyStyle() {
  const r = document.documentElement.style
  r.setProperty('--fs', `${style.fontSize}px`)
  r.setProperty('--text', rgba(style.textColor, style.textOpacity))
  r.setProperty('--her-bg', rgba(style.bubbleColor, style.bubbleOpacity))
  r.setProperty('--me-bg', rgba(style.userColor, style.bubbleOpacity))
  r.setProperty('--panel-bg', rgba(style.panelColor, style.panelOpacity))
  document.querySelectorAll('[data-raw]').forEach(el => { el.textContent = display(el.dataset.raw) })
}

const STYLE_FIELDS = [
  ['fontSize', '字号', 'range', 12, 24, 1],
  ['textColor', '文字颜色', 'color'],
  ['textOpacity', '文字透明度', 'range', 0.3, 1, 0.05],
  ['bubbleColor', '她的气泡', 'color'],
  ['userColor', '你的气泡', 'color'],
  ['bubbleOpacity', '气泡透明度', 'range', 0.1, 1, 0.02],
  ['panelOpacity', '底板透明度', 'range', 0, 0.85, 0.02],
  ['showTags', '显示表情标签', 'checkbox'],
]
let saveTimer = null
function buildStylePop() {
  stylePop.innerHTML = ''
  for (const [key, label, type, min, max, step] of STYLE_FIELDS) {
    const row = document.createElement('label')
    const span = document.createElement('span'); span.textContent = label
    const el = document.createElement('input'); el.type = type
    if (type === 'range') { el.min = min; el.max = max; el.step = step; el.value = style[key] }
    else if (type === 'color') el.value = style[key]
    else el.checked = !!style[key]
    el.addEventListener('input', () => {
      style[key] = type === 'range' ? Number(el.value) : type === 'checkbox' ? el.checked : el.value
      applyStyle()
      clearTimeout(saveTimer); saveTimer = setTimeout(() => window.pet.saveStyle(style), 400)
    })
    row.append(span, el); stylePop.appendChild(row)
  }
  const foot = document.createElement('div'); foot.className = 'foot'
  const reset = document.createElement('button'); reset.className = 'plain'; reset.textContent = '恢复默认'
  reset.onclick = () => { style = { ...defaultStyle }; applyStyle(); window.pet.saveStyle(style); buildStylePop() }
  const done = document.createElement('button'); done.textContent = '好了'
  done.onclick = () => stylePop.classList.remove('open')
  foot.append(reset, done); stylePop.appendChild(foot)
}

// =====================================================================
// 三、对话框
// =====================================================================

const TAG_RE = /\[([\u4e00-\u9fa5]{1,4})\]/g
const display = (raw) => {
  const t = String(raw).replace(/〔安静〕/g, '')
  return (style.showTags ? t : t.replace(/\[[\u4e00-\u9fa5]{1,4}\]\s*/g, '')).trim()
}
// 她选择不说话的回合：去掉表情标签后只剩〔安静〕或者什么都没有
const looksSilent = (raw) => /^〔?安?静?〕?$/.test(String(raw).replace(/\[[\u4e00-\u9fa5]{1,4}\]/g, '').replace(/\s+/g, ''))

let connected = false, agentState = 'idle', pendingApprovals = 0, turnOrigin = 'user'
function setMood() {
  conn.className = !connected ? '' : (agentState === 'running' ? 'busy' : 'on')
  mood.textContent = !connected ? '小白（没连上）' : pendingApprovals ? '小白 · 等你点头' : agentState === 'running' ? '小白 · 在说话' : '小白'
  sendBtn.textContent = agentState === 'running' ? '停' : '发送'
  sendBtn.classList.toggle('stop', agentState === 'running')
}

function nearBottom() { return logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 60 }
function scrollDown(force) { if (force || nearBottom()) logEl.scrollTop = logEl.scrollHeight }

function addBubble(who, raw) {
  const stick = nearBottom()
  const row = document.createElement('div'); row.className = `row ${who}`
  const b = document.createElement('div'); b.className = `b ${who}`
  b.dataset.raw = raw; b.textContent = display(raw)
  row.appendChild(b); logEl.appendChild(row)
  scrollDown(stick)
  return b
}
function addNote(text) {
  const stick = nearBottom()
  const n = document.createElement('div'); n.className = 'note'; n.textContent = text
  logEl.appendChild(n); scrollDown(stick)
}
let typingRow = null
function showTyping() {
  if (typingRow) return
  typingRow = document.createElement('div'); typingRow.className = 'row her'
  const b = document.createElement('div'); b.className = 'b her typing'; b.innerHTML = '<i></i><i></i><i></i>'
  typingRow.appendChild(b); logEl.appendChild(typingRow); scrollDown()
}
function hideTyping() { if (typingRow) { typingRow.remove(); typingRow = null } }

function toolNote(name, args = {}) {
  const n = String(name || '')
  if (/web_?search/i.test(n)) return `🔍 搜索：${args.query ?? args.q ?? (Array.isArray(args.queries) ? args.queries.join('、') : '')}`
  if (/web_?fetch|browse/i.test(n)) return `🌐 打开网页：${args.url ?? ''}`
  if (/look_at_screen/i.test(n)) return '👀 仔细看了一眼你的屏幕'
  if (/read|view|cat/i.test(n)) return `📖 翻了翻：${args.path ?? args.file_path ?? n}`
  return `🔧 ${n}`
}

function addApproval(ev) {
  pendingApprovals++; setMood()
  const card = document.createElement('div'); card.className = 'card'; card.dataset.id = ev.id
  const t = document.createElement('div'); t.textContent = '小白想做这件事，要你点头：'
  const what = document.createElement('div'); what.className = 'what'; what.textContent = ev.summary
  const acts = document.createElement('div'); acts.className = 'acts'
  const yes = document.createElement('button'); yes.className = 'yes'; yes.textContent = '允许这一次'
  const no = document.createElement('button'); no.className = 'no'; no.textContent = '不行'
  const decide = async (d) => {
    yes.disabled = no.disabled = true
    const r = await window.pet.approve(ev.id, d)
    if (!r.ok) { yes.disabled = no.disabled = false; addNote(`没送到：${r.error}`) }
  }
  yes.onclick = () => decide('allow'); no.onclick = () => decide('deny')
  acts.append(yes, no); card.append(t, what, acts); logEl.appendChild(card)
  scrollDown(true)
  openChat(true)
}
function closeApproval(id, outcome) {
  const card = logEl.querySelector(`.card[data-id="${CSS.escape(id)}"]`)
  if (!card || card.classList.contains('done')) return
  pendingApprovals = Math.max(0, pendingApprovals - 1); setMood()
  card.classList.add('done')
  const r = document.createElement('div'); r.className = 'result'
  r.textContent = outcome === 'allowed-once' ? '你允许了这一次' : outcome === 'rejected' ? '你没让她做' : '超时作废了'
  card.appendChild(r)
}

// ---- 这一轮她说的话 ----
const turnBubbles = new Map()
let turnTexts = [], lastTag = null

function herText(key, text, replace) {
  let b = turnBubbles.get(key)
  if (!b) {
    if (!replace && !display(text)) return     // 只收到一个标签，先别建空气泡
    hideTyping()
    b = addBubble('her', '')
    turnBubbles.set(key, b)
  }
  const raw = replace ? text : (b.dataset.raw || '') + text
  b.dataset.raw = raw; b.textContent = display(raw)
  scrollDown()
  const tags = [...raw.matchAll(TAG_RE)]
  if (tags.length) { const tag = tags[tags.length - 1][1]; if (tag !== lastTag) { lastTag = tag; window.pet.emotion(tag) } }
}
// 流式片段可能只有半个标签，先攒着
const pendingDelta = new Map()
function onDelta(ev) {
  const key = `${ev.turn}:${ev.step}`
  const acc = (pendingDelta.get(key) || '') + ev.text
  if (!turnBubbles.has(key) && (/^\s*\[?[\u4e00-\u9fa5]{0,4}\]?\s*$/.test(acc) || looksSilent(acc))) { pendingDelta.set(key, acc); return }
  pendingDelta.delete(key)
  herText(key, acc, false)
}

function onEvent(ev) {
  switch (ev.type) {
    case 'hello':
      agentState = ev.status === 'running' ? 'running' : 'idle'; setMood(); break
    case 'ready':
      break
    case 'status':
      agentState = ev.status === 'running' ? 'running' : 'idle'; setMood()
      setTalking(agentState === 'running')
      if (agentState !== 'running') hideTyping()
      break
    case 'turn-start':
      turnBubbles.clear(); pendingDelta.clear(); turnTexts = []; lastTag = null
      turnOrigin = ev.origin || 'user'
      // 屏幕动态引起的回合她多半不开口，先别摆出“正在输入”
      if (turnOrigin !== 'proactive') { showTyping(); setTalking(true) }
      break
    case 'thinking':
      if (turnOrigin !== 'proactive') showTyping()
      break
    case 'delta':
      onDelta(ev); break
    case 'message': {
      const key = `${ev.turn}:${ev.step}`
      pendingDelta.delete(key)
      if (looksSilent(ev.text)) {
        const b = turnBubbles.get(key)
        if (b) { b.closest('.row')?.remove(); turnBubbles.delete(key) }
        break
      }
      herText(key, ev.text, true)
      turnTexts.push(ev.text)
      if (turnOrigin === 'proactive') setTalking(true)
      break
    }
    case 'tool':
      addNote(toolNote(ev.name, ev.args)); break
    case 'think-start':
      setThinking(ev.running)
      addNote(`💭 交给后台去想了：${ev.title}（#${ev.id}）`)
      break
    case 'think-escalated':
      addNote('⏱ 这个问题有点大，自动转给后台了')
      break
    case 'think-done':
      setThinking(ev.running)
      if (ev.ok) addThinkCard(ev)
      else if (ev.status !== 'cancelled') addNote(`⚠️ 后台没想完：${ev.title}（#${ev.id}）`)
      else addNote(`🗑 撤掉了：${ev.title}（#${ev.id}）`)
      break
    case 'recalled':
      addNote(`🔎 翻了翻记忆${ev.query ? '：' + ev.query : ''}（${ev.count} 条）`); break
    case 'remembered':
      addNote(`📝 ${ev.replaced ? '改了一条记忆' : '记下了'}：${ev.text}`); break
    case 'approval':
      addApproval(ev); break
    case 'approval-done':
      closeApproval(ev.id, ev.outcome); break
    case 'turn-end': {
      hideTyping(); setTalking(false)
      if (ev.silent) {
        for (const b of turnBubbles.values()) b.closest('.row')?.remove()
        turnBubbles.clear()
        break
      }
      const said = display(turnTexts.join('\n\n'))
      if (said && !chat.classList.contains('open')) { showSpeech(said); dot.classList.add('show') }
      if (ev.reason === 'error') addNote('她刚才卡住了，再说一遍试试')
      break
    }
    case 'user':
      addBubble('me', ev.text); break
    case 'local-notice':
      addNote(ev.text); break
  }
}

// ---- 后台思考 ----
function setThinking(n) {
  thinkb.textContent = `💭 ${n}`
  thinkb.classList.toggle('show', n > 0)
}
function addThinkCard(ev) {
  const stick = nearBottom()
  const card = document.createElement('div'); card.className = 'thinkcard'
  const head = document.createElement('div'); head.className = 'th'; head.textContent = `💡 后台想好了：${ev.title}（#${ev.id}）`
  const body = document.createElement('div'); body.className = 'tb'; body.textContent = ev.result
  card.append(head, body)
  if (String(ev.result).length > 90 || String(ev.result).split('\n').length > 3) {
    const more = document.createElement('button'); more.className = 'tm'; more.textContent = '展开全文'
    more.onclick = () => { card.classList.toggle('open'); more.textContent = card.classList.contains('open') ? '收起' : '展开全文' }
    card.appendChild(more)
  }
  logEl.appendChild(card); scrollDown(stick)
}

// ---- 发消息 ----
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 96) + 'px' }
async function send() {
  if (agentState === 'running' && !input.value.trim()) { await window.pet.cancel(); return }
  const text = input.value.trim()
  if (!text) return
  input.value = ''; autosize()
  const b = addBubble('me', text); scrollDown(true)
  const r = await window.pet.send(text)
  if (!r.ok) { b.classList.add('failed'); addNote(`没发出去：${r.error}`) }
}
sendBtn.addEventListener('click', send)
input.addEventListener('input', autosize)
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() }
})

// ---- 打开收起 ----
function openChat(open) {
  chat.classList.toggle('open', open)
  window.pet.chatOpen(open)
  if (open) { hideSpeech(); dot.classList.remove('show'); scrollDown(true); setTimeout(() => input.focus(), 50) }
  else stylePop.classList.remove('open')
}
$('btn-close').onclick = () => openChat(false)
$('btn-style').onclick = () => stylePop.classList.toggle('open')

let speechTimer = null
function showSpeech(text) {
  speech.textContent = text.length > 160 ? text.slice(0, 160) + '…' : text
  speech.classList.add('show')
  clearTimeout(speechTimer)
  speechTimer = setTimeout(hideSpeech, bubbleSeconds * 1000)
}
function hideSpeech() { speech.classList.remove('show') }
speech.onclick = () => openChat(true)

// =====================================================================
// 四、鼠标：透明处穿透、拖动、点击、右键
// =====================================================================

let lastHit = null, dragging = false
document.addEventListener('mousemove', (e) => {
  const hit = dragging || !!(e.target && e.target.closest && e.target.closest('.hit'))
  if (hit !== lastHit) { lastHit = hit; window.pet.hit(hit) }
})
document.addEventListener('mouseleave', () => { if (!dragging) { lastHit = false; window.pet.hit(false) } })

function draggable(el, onClick) {
  let last = null, travelled = 0
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return
    last = { x: e.screenX, y: e.screenY }; travelled = 0; dragging = true
    el.setPointerCapture(e.pointerId)
  })
  el.addEventListener('pointermove', (e) => {
    if (!last) return
    const dx = e.screenX - last.x, dy = e.screenY - last.y
    if (!dx && !dy) return
    travelled += Math.abs(dx) + Math.abs(dy)
    if (travelled > 4) { el.classList.add('dragging'); window.pet.drag(dx, dy) }
    last = { x: e.screenX, y: e.screenY }
  })
  el.addEventListener('pointerup', () => {
    if (!last) return
    if (travelled > 4) window.pet.dragEnd()
    else if (onClick) onClick()
    last = null; dragging = false; el.classList.remove('dragging')
  })
}
draggable(stage, () => { if (dormant) window.pet.wake(); else openChat(!chat.classList.contains('open')) })
draggable($('head'), null)
stage.addEventListener('contextmenu', (e) => { e.preventDefault(); window.pet.menu() })
$('head').addEventListener('contextmenu', (e) => { e.preventDefault(); window.pet.menu() })

// =====================================================================
// 五、主进程发来的消息
// =====================================================================

window.pet.on('pet:init', async (d) => {
  const L = d.layout, r = document.documentElement.style
  r.setProperty('--ar', `${d.canvas.width} / ${d.canvas.height}`)
  r.setProperty('--chat-w', `${L.chatW}px`); r.setProperty('--chat-h', `${L.chatH}px`)
  r.setProperty('--pet-w', `${L.petW}px`); r.setProperty('--sprite-h', `${L.spriteH}px`); r.setProperty('--top', `${L.top}px`)
  root.className = `side-${L.side}`
  style = { ...d.style }; defaultStyle = { ...d.defaultStyle }; bubbleSeconds = d.bubbleSeconds
  applyStyle(); buildStylePop()
  idleMs = d.idleMs; calm = d.calm
  eye.classList.toggle('show', d.watchSeconds > 0)
  for (const src of d.rendererScripts || []) await loadScript(src)
  setExpression(calm)
  if (d.dormant) applyDormant(true)
  if (d.chatOpen) openChat(true)
  setMood()
})
window.pet.on('pet:layout', ({ side }) => { root.className = `side-${side}`; root.classList.toggle('dormant', dormant) })

function applyDormant(on) {
  dormant = !!on
  root.classList.toggle('dormant', dormant)
  clearTimeout(idleTimer)
  if (dormant) {
    hideSpeech()
    stage.title = '她在打盹，点一下叫醒'
    window.pet.emotion('困')
  } else {
    stage.title = '左键聊天，按住拖动，右键菜单'
    if (calm) setExpression(calm)
  }
}
window.pet.on('pet:dormant', applyDormant)
window.pet.on('pet:emotion', (p) => setExpression(p))
window.pet.on('pet:status', ({ kind, text }) => {
  statusEl.textContent = text || ''
  statusEl.className = text ? 'show' + (kind === 'error' ? ' error' : '') : ''
})
window.pet.on('chat:conn', (on) => { connected = !!on; setMood() })
window.pet.on('chat:event', onEvent)
window.pet.on('chat:history', (list) => {
  if (!Array.isArray(list) || !list.length) return
  const frag = []
  for (const e of list) {
    const row = document.createElement('div'); row.className = `row ${e.role === 'user' ? 'me' : 'her'}`
    const b = document.createElement('div'); b.className = `b ${e.role === 'user' ? 'me' : 'her'}`
    b.dataset.raw = e.text; b.textContent = display(e.text)
    row.appendChild(b); frag.push(row)
  }
  const div = document.createElement('div'); div.className = 'divider'; div.textContent = '以上是之前聊的'
  logEl.prepend(...frag, div)
  scrollDown(true)
})
window.pet.on('chat:toggle', () => openChat(!chat.classList.contains('open')))
window.pet.on('chat:style', () => { openChat(true); stylePop.classList.add('open') })
window.pet.on('watch:state', ({ seconds }) => {
  eye.classList.toggle('show', seconds > 0)
  eye.title = seconds > 0 ? `每 ${seconds} 秒瞄一眼屏幕（画面没变不算）` : ''
})
window.pet.on('watch:flash', () => { eye.classList.add('flash'); setTimeout(() => eye.classList.remove('flash'), 350) })
