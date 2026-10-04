// neko-bridge：小白桌宠和 dsh 之间的桥
//
// 只用 dsh 文档里公开的接口：
//   ctx.agentLoop.create / resume   建小白专属的会话
//   agent.followup                  把消息交给她
//   'session/event'                 听她说了什么、调了什么工具、这一轮有没有说完
//   'approval/request'              把需要批准的事转到桌宠上让你点
// 对桌宠开一个只在本机能连的小接口（127.0.0.1，带随机令牌，拒绝一切浏览器请求）。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const name = 'neko-bridge'
export const inject = ['tools']

// 用真实路径：通过 dsh plugin add 链接进 dsh 时，也能找回仓库里的原位置
const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))
const RUNTIME_FILE = path.join(here, 'runtime.json')
const STATE_FILE = path.join(here, 'state.json')
const CHATLOG_FILE = path.join(here, 'chatlog.jsonl')
const LOG_FILE = path.join(here, 'bridge.log')
const BACKUP_DIR = path.join(here, 'backups')

// ---------- 小工具 ----------

const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }
const writeJson = (p, v) => { try { fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8') } catch {} }
const CFG = () => readJson(path.join(here, 'config.json'), {})

// ---------- 路径：不写死盘符 ----------
// 仓库根目录：桌宠拉起 dsh 时会传 NEKO_HOME；没有就按 插件目录/../.. 算
const REPO = process.env.NEKO_HOME ? path.resolve(process.env.NEKO_HOME) : path.resolve(here, '..', '..')
// 配置里的路径可以写绝对路径，也可以写相对仓库根目录的路径，留空用默认
const fromRepo = (p, dflt) => { const v = String(p ?? '').trim(); return v ? (path.isAbsolute(v) ? v : path.resolve(REPO, v)) : dflt }
const wsDir = () => fromRepo(CFG().workspace, process.env.NEKO_WORKSPACE ? path.resolve(process.env.NEKO_WORKSPACE) : path.join(REPO, 'neko'))
const memDir = () => fromRepo(CFG().memoryDir, path.join(wsDir(), 'memory'))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const errText = (e) => String(e?.message ?? e).slice(0, 300)

const pad = (n) => String(n).padStart(2, '0')
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const stamp = (d = new Date()) => `${dateKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const nowText = () => { const d = new Date(); return `${stamp(d)} 星期${WEEK[d.getDay()]}` }
function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  return s < 60 ? `${s} 秒` : `${Math.round(s / 60)} 分钟`
}

function fileLog(line) {
  try {
    const st = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE) : null
    if (st && st.size > 512 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old')
    fs.appendFileSync(LOG_FILE, `${new Date().toLocaleString('zh-CN', { hour12: false })}  ${line}\n`, 'utf8')
  } catch {}
}

function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('')
}

function safeParse(s) { try { return typeof s === 'string' ? JSON.parse(s) : (s ?? {}) } catch { return {} } }

// ---------- 拿宿主自己那份 defineTool（和 neko-eyes 同一套办法）----------

function entryOf(pkgDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
  let e = pkg.exports
  if (e && typeof e === 'object' && !Array.isArray(e) && '.' in e) e = e['.']
  const pick = (x) => typeof x === 'string' ? x : (x && (pick(x.import) || pick(x.node) || pick(x.default)))
  return path.join(pkgDir, pick(e) || pkg.module || pkg.main || 'index.js')
}
function findUp(startDir, rel) {
  let dir = startDir
  for (let i = 0; i < 12 && dir; i++) {
    const p = path.join(dir, rel)
    if (fs.existsSync(path.join(p, 'package.json'))) return p
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}
async function getDefineTool() {
  try {
    const m = await import('@deepseek-ai/dsh-tools')
    if (typeof m.defineTool === 'function') return { fn: m.defineTool, via: '直接解析' }
  } catch {}
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  for (const s of [process.argv[1] && path.dirname(process.argv[1]), path.join(dshHome, 'profiles', 'web')].filter(Boolean)) {
    try {
      const dir = findUp(s, path.join('node_modules', '@deepseek-ai', 'dsh-tools'))
      if (!dir) continue
      const m = await import(pathToFileURL(entryOf(dir)).href)
      if (typeof m.defineTool === 'function') return { fn: m.defineTool, via: dir }
    } catch {}
  }
  return { fn: (d) => d, via: '没找到，按普通对象注册' }
}

// ---------- 记忆备份 ----------

function backup(file, content) {
  try {
    if (!content) return
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    const name = `${Date.now()}_${path.basename(file)}`
    fs.writeFileSync(path.join(BACKUP_DIR, name), content, 'utf8')
    const all = fs.readdirSync(BACKUP_DIR).sort()
    for (const old of all.slice(0, Math.max(0, all.length - 200))) fs.unlinkSync(path.join(BACKUP_DIR, old))
  } catch {}
}

// 桥给她的工具清单。改了这里、改了人设或规矩文件，旧会话就不续了，开个新的
const BRIDGE_TOOLS = ['remember', 'recall_memory', 'think_deeply', 'check_thinking', 'cancel_thinking']
function compositionSig(workspace) {
  const ws = workspace || wsDir()
  const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
  const agents = read(path.join(ws, 'AGENTS.md'))
  const persona = (agents.match(/当前人设[：:]\s*(\S+)/) || [])[1] || 'xiaobai'
  const material = [
    BRIDGE_TOOLS.join(','),
    persona,
    read(path.join(ws, 'persona', `${persona}.md`)),
    read(path.join(ws, 'rules', 'memory-rules.md')),
  ].join('\n\u0000\n')
  return createHash('sha1').update(material).digest('hex').slice(0, 12)
}

const SECRET_RE = /(密码|口令|验证码|password|passwd|\bsk-[A-Za-z0-9]{8,}|\b\d{15,19}\b)/i

// =====================================================================

// 记忆文件不存在时，从 neko/memory-templates 复制一份带说明的空模板
function seedMemory() {
  try {
    const dir = memDir()
    fs.mkdirSync(dir, { recursive: true })
    for (const n of ['profile', 'relationship', 'events']) {
      const f = path.join(dir, `${n}.md`)
      if (fs.existsSync(f)) continue
      const tpl = path.join(wsDir(), 'memory-templates', `${n}.md`)
      if (fs.existsSync(tpl)) fs.copyFileSync(tpl, f)
    }
  } catch {}
}

export async function apply(ctx) {
  seedMemory()
  const bus = (globalThis.__nekoBus ??= {})
  const log = (m) => { fileLog(m); try { ctx.logger.info('[neko-bridge] ' + m) } catch {} }
  const warn = (m) => { fileLog('！' + m); try { ctx.logger.warn('[neko-bridge] ' + m) } catch {} }

  const clients = new Set()
  const broadcast = (ev) => {
    const line = `data: ${JSON.stringify(ev)}\n\n`
    for (const res of clients) { try { res.write(line) } catch {} }
  }

  let disposed = false
  let agent = null
  let agentStatus = 'idle'
  let freshSession = false
  let ensuring = null
  let chatOpts = {}                  // 聊天会话用的模型参数，后台思考照着建
  let chatPresetId                   // 聊天会话套的预设（创造模式之类）
  let lastUserText = ''              // 你最近说的那句话，自动转交后台时用
  let lastToolKey = ''               // 上次记下的她能用的工具清单
  const jobs = new Map()             // 后台思考：编号 → 这件事
  const jobsBySession = new Map()    // 后台思考：会话 id → 这件事
  let screenNote = null
  let thinkingSent = false
  const timing = { t0: 0, think0: 0, think1: 0, text0: 0, reasoned: false }
  const secs = (ms) => (ms / 1000).toFixed(1)
  let replyParts = []
  const sentIds = new Map()          // 我们发出去的消息 → 来源：user 你说的 / proactive 屏幕动态 / system 叫醒下班
  const originQueue = []             // 还没开始处理的消息来源，按发出顺序
  let turnOrigin = 'user'            // 当前这一轮是谁引起的
  let dormantSince = null            // 打盹开始的时间
  let lastUserAt = 0                 // 你上次发消息的时间
  let lastProactiveAt = 0            // 上次因为屏幕动态叫她的时间
  const autoLooks = []               // 她主动看屏幕的时间记录
  const pendingApprovals = new Map()

  const touchSeen = () => { const st = readJson(STATE_FILE, {}); st.lastSeen = Date.now(); writeJson(STATE_FILE, st) }

  // ---------- 聊天记录（给桌宠翻历史，也给下次醒来接话）----------

  function appendLog(entry) {
    try { fs.appendFileSync(CHATLOG_FILE, JSON.stringify(entry) + '\n', 'utf8') } catch {}
  }
  function readLog(limit = 200) {
    try {
      const lines = fs.readFileSync(CHATLOG_FILE, 'utf8').split('\n').filter(Boolean)
      return lines.slice(-limit).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    } catch { return [] }
  }

  // ---------- 消息 ----------

  const message = (text, source) => ({ id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source })
  const fromUser = (text) => message(text, { kind: 'user' })
  const fromBridge = (text) => message(text, { kind: 'plugin', plugin: 'neko-bridge' })

  function deliver(msg, origin = 'user') {
    if (!agent) throw new Error('小白的会话还没准备好')
    sentIds.set(msg.id, origin)
    if (sentIds.size > 500) sentIds.delete(sentIds.keys().next().value)
    originQueue.push(origin)
    agent.followup(msg)
  }

  // 她回〔安静〕或者只回了个表情标签，就当她选择不说话
  const isSilent = (text) => !String(text || '').replace(/\[[\u4e00-\u9fa5]{1,4}\]/g, '').replace(/〔安静〕/g, '').trim()

  function proactiveCfg() {
    const cfg = CFG()
    const levels = {
      occasional: { minNotable: 2, minGapMin: 10, quietAfterUserMin: 3 },
      active: { minNotable: 1, minGapMin: 3, quietAfterUserMin: 1 },
      ...(cfg.proactiveLevels || {}),
    }
    return levels[cfg.proactive || 'occasional'] || null
  }

  // 后台瞄到的画面够不够格叫醒她想一想要不要说话
  function maybeProactive(notable) {
    const lvl = proactiveCfg()
    if (!lvl || dormantSince || !agent || agentStatus === 'running') return
    const now = Date.now()
    if (!(notable >= lvl.minNotable)) return
    if (now - lastProactiveAt < lvl.minGapMin * 60000) return
    if (now - lastUserAt < lvl.quietAfterUserMin * 60000) return
    lastProactiveAt = now
    const sinceUser = lastUserAt ? `对方上次说话是 ${ago(lastUserAt)}前` : '对方今天还没跟你说过话'
    deliver(fromBridge(
      `【屏幕动态】${screenNote.summary}（现在 ${nowText()}，${sinceUser}）\n` +
      '你自己决定：没什么值得说的就只回〔安静〕；觉得有意思、该提醒、或者想关心一下，就自然地搭一句；' +
      '真需要看清细节才用 look_at_screen，别看太勤。'
    ), 'proactive')
    log(`屏幕动态叫她看看（显著度 ${notable}）：${screenNote.summary}`)
  }

  function contextPrefix(detail) {
    const parts = [`现在 ${nowText()}`]
    if (detail) {
      parts.push(`你刚针对这句话看了一眼屏幕：${detail}`)
    } else if (screenNote?.summary && (CFG().imageMode || 'both') !== 'image') {
      const fresh = (CFG().screenFreshSec || 120) * 1000
      if (Date.now() - screenNote.at < fresh) parts.push(`屏幕（${ago(screenNote.at)}前瞄到）：${screenNote.summary}`)
    }
    return `〔${parts.join('｜')}〕\n`
  }

  // ---------- 小白专属会话 ----------

  async function waitService(name, ms = 60000) {
    const t0 = Date.now()
    while (!disposed && Date.now() - t0 < ms) {
      try { const s = ctx.get(name); if (s) return s } catch {}
      await sleep(500)
    }
    return undefined
  }

  async function pickPreset(presets, wanted) {
    if (wanted) return wanted
    if (!presets || typeof presets.list !== 'function') return undefined
    try {
      const list = await presets.list()
      const hit = (list || []).find(p => /creator|创造|创作/i.test(`${p?.id ?? ''} ${p?.name ?? ''} ${p?.title ?? ''}`))
      return hit?.id ?? presets.defaultId ?? undefined
    } catch (e) { warn('读预设列表失败：' + errText(e)); return undefined }
  }

  async function ensureAgent() {
    if (agent || disposed) return agent
    if (ensuring) return ensuring
    ensuring = (async () => {
      const cfg = CFG()
      const agentLoop = await waitService('agentLoop')
      if (!agentLoop) { warn('找不到 agentLoop 服务，没法给小白开会话'); return null }
      const presets = ctx.get('agentPresets')
      const defModel = ctx.get('agentDefaultModel')

      let sel = {}
      try { sel = defModel?.currentSelection?.() || {} } catch {}
      const agentOptions = {}
      if (cfg.provider || sel.provider) agentOptions.provider = cfg.provider || sel.provider
      if (cfg.model || sel.model) agentOptions.model = cfg.model || sel.model
      // 不传的话 DeepSeek 默认开着思考、强度最高，闲聊也要先想一大段；聊天用不着，默认关掉
      const reasoning = cfg.chatReasoning ?? 'off'
      if (reasoning) agentOptions.reasoningEffort = reasoning

      const presetId = await pickPreset(presets, cfg.preset)
      const setup = (presets && presetId) ? async (agentCtx) => { await presets.mount(agentCtx, presetId) } : null

      const st = readJson(STATE_FILE, {})
      const today = dateKey()
      let a = null

      // 同一天就接着用同一个会话，前后文是连着的。
      // 但工具或人设规矩变过，就开新的：旧会话里她可能一直记着“没有这个工具”，规矩也是旧的
      const sig = compositionSig(wsDir())
      if (st.sessionId && st.date === today && st.sig !== sig) {
        log(`工具或人设规矩更新过（${st.sig || '旧版本'} → ${sig}），不续今天的旧会话，开个新的`)
      }
      if (st.sessionId && st.date === today && st.sig === sig && typeof agentLoop.resume === 'function') {
        try {
          const opts = { resumeSessionId: st.sessionId, agentOptions }
          if (setup) opts.setup = setup
          let rawResume = await agentLoop.resume(ctx, opts)
          a = rawResume?.agent ?? rawResume
          if (a && typeof a.followup === 'function') { freshSession = false; log(`接着今天的会话 ${a.id}`) }
          else { warn('resume() 返回的不是 Agent：keys=' + Object.keys(rawResume ?? {}).join(',')); a = null }
        } catch (e) { warn('续不上今天的会话，新开一个：' + errText(e)) }
      }

      if (!a) {
        const id = `neko-${today}-${Date.now().toString(36)}`
        // create() 在某些版本是异步的，或返回 AgentHandle 而不是 Agent，统一处理
        let rawCreate
        try {
          rawCreate = agentLoop.create(id, agentOptions, { cwd: wsDir() })
          if (rawCreate && typeof rawCreate.then === 'function') rawCreate = await rawCreate
        } catch (e) {
          if (!('reasoningEffort' in agentOptions)) throw e
          warn('这个版本建会话时不认思考强度参数，去掉再试：' + errText(e))
          delete agentOptions.reasoningEffort
          rawCreate = agentLoop.create(id, agentOptions, { cwd: wsDir() })
          if (rawCreate && typeof rawCreate.then === 'function') rawCreate = await rawCreate
        }
        a = rawCreate?.agent ?? rawCreate

        // 还是没有 followup，用 createAgent 路径再试一次
        if (!a || typeof a.followup !== 'function') {
          warn(`create() 返回的不是 Agent（keys: ${Object.keys(rawCreate ?? {}).join(', ')}），尝试 createAgent...`)
          if (typeof agentLoop.createAgent === 'function') {
            const setupOpt = setup ? { setup } : {}
            const h = await agentLoop.createAgent(ctx, { id, agentOptions, meta: { cwd: wsDir() }, ...setupOpt })
            a = h?.agent ?? h
          }
        }

        // 最后防线：从 agents 注册表里查
        if (!a || typeof a.followup !== 'function') {
          warn(`两条路都没拿到可用的 Agent。diagnostic: type=${typeof rawCreate} keys=${Object.keys(rawCreate ?? {}).join(',')}`)
          const agentsSvc = ctx.get('agents')
          if (agentsSvc) a = agentsSvc.get?.(id) ?? a
        }

        if (!a || typeof a.followup !== 'function') { warn('放弃本次创建，下次重试'); return null }

        if (presets && presetId && a.ctx && typeof presets.recompose === 'function') {
          try { await presets.recompose(a.ctx, presetId) } catch (e) { warn('套用预设失败（不影响使用）：' + errText(e)) }
        }
        freshSession = true
        writeJson(STATE_FILE, { ...readJson(STATE_FILE, {}), sessionId: a.id, date: today, sig })
        log(`新开了会话 ${a.id}`)
      }

      log(`预设：${presetId || '（没指定）'}，模型：${agentOptions.provider || '?'} / ${agentOptions.model || '?'}，深度思考：${agentOptions.reasoningEffort ?? '没设（DeepSeek 默认会开着）'}`)
      chatOpts = { ...agentOptions }
      chatPresetId = presetId
      agent = a
      agentStatus = a.status || 'idle'
      broadcast({ type: 'ready', sessionId: a.id, fresh: freshSession })
      return a
    })().catch((e) => { warn('开会话失败：' + errText(e)); return null }).finally(() => { ensuring = null })
    return ensuring
  }

  // ---------- 听她的动静 ----------

  ctx.on('agent/status', (payload) => {
    if (!agent || payload?.agent?.id !== agent.id) return
    agentStatus = payload.status
    broadcast({ type: 'status', status: payload.status })
  })

  ctx.on('agent/disposed', (payload) => {
    if (!agent || payload?.agent?.id !== agent.id) return
    agent = null
    broadcast({ type: 'status', status: 'gone' })
    if (!disposed && clients.size) setTimeout(() => { ensureAgent() }, 3000)
  })

  ctx.on('session/event', (session, event) => {
    if (!session || !event) return
    const job = jobsBySession.get(session.id)
    if (job) { onThinkerEvent(job, event); return }
    if (!agent || session.id !== agent.id) return
    const d = event.data || {}
    switch (event.type) {
      case 'request/header': {
        const tools = d.header?.tools ?? d.tools
        if (!Array.isArray(tools)) break
        const names = tools.map(t => t?.name).filter(Boolean)
        const key = names.slice().sort().join(',')
        if (key === lastToolKey) break
        lastToolKey = key
        const missing = BRIDGE_TOOLS.filter(n => !names.includes(n))
        log(`她这一轮能用的工具 ${names.length} 个${missing.length ? `，缺：${missing.join('、')}` : '，桥给的工具都在'}`)
        if (missing.length) warn('有工具没进她的工具列表：' + missing.join('、') + '。全部工具：' + names.join('、'))
        break
      }
      case 'turn/start':
        replyParts = []
        thinkingSent = false
        turnOrigin = originQueue.includes('user') ? 'user' : (originQueue[0] ?? 'user')
        originQueue.length = 0
        broadcast({ type: 'turn-start', turn: d.turn, origin: turnOrigin })
        Object.assign(timing, { t0: Date.now(), think0: 0, think1: 0, text0: 0, reasoned: false })
        turnState.lastDeltaAt = 0
        turnState.thinkCalled = false
        startTurnWatch()
        break
      case 'assistant/chunk': {
        const c = d.chunk
        const now = Date.now()
        if (c?.type === 'text-delta' && c.text) {
          if (!timing.text0) timing.text0 = now
          turnState.lastDeltaAt = now
          broadcast({ type: 'delta', turn: d.turn, step: d.step, text: c.text })
        } else if (c?.type === 'reasoning-delta') {
          if (!timing.think0) timing.think0 = now
          timing.think1 = now
          timing.reasoned = true
          if (!thinkingSent) { thinkingSent = true; broadcast({ type: 'thinking', turn: d.turn }) }
        }
        break
      }
      case 'assistant/message': {
        const text = textOf(d.message?.content).trim()
        if (Array.isArray(d.message?.content) && d.message.content.some(b => /reason|think/i.test(String(b?.type)))) timing.reasoned = true
        if (text && !timing.text0) timing.text0 = Date.now()
        if (text) turnState.lastDeltaAt = Date.now()
        if (text) { replyParts.push(text); broadcast({ type: 'message', turn: d.turn, step: d.step, text }) }
        break
      }
      case 'tool/call':
        if (d.name === 'think_deeply') turnState.thinkCalled = true
        if (!['remember', 'think_deeply', 'check_thinking', 'cancel_thinking'].includes(d.name)) broadcast({ type: 'tool', name: d.name, args: safeParse(d.arguments) })
        break
      case 'turn/end': {
        clearInterval(turnWatch)
        const reply = replyParts.join('\n\n').trim()
        const silent = isSilent(reply)
        if (reply && !silent) appendLog({ role: 'assistant', text: reply, at: Date.now(), ...(turnOrigin === 'proactive' ? { proactive: true } : {}) })
        replyParts = []
        broadcast({ type: 'turn-end', turn: d.turn, reason: d.reason?.kind ?? null, origin: turnOrigin, silent })
        touchSeen()
        if (timing.t0) {
          const now = Date.now()
          const first = timing.text0 ? `第一句话用了 ${secs(timing.text0 - timing.t0)} 秒` : (silent ? '选择了不说话' : '没出文字')
          const think = timing.think0 ? `，其中深度思考 ${secs((timing.think1 || now) - timing.think0)} 秒` : (timing.reasoned ? '，带了深度思考' : '，没有深度思考')
          log(`回合 ${d.turn}（${turnOrigin}）：${first}${think}，整轮 ${secs(now - timing.t0)} 秒`)
          if (timing.reasoned && turnOrigin === 'user' && (CFG().chatReasoning ?? 'off') === 'off') {
            warn('聊天会话还在深度思考，思考强度没设上。可以在 dsh 界面里打开小白的会话，把思考强度改成关闭')
          }
        }
        if (d.reason?.kind === 'error') warn('这一轮出错了：' + (() => { try { return JSON.stringify(d.reason).slice(0, 300) } catch { return String(d.reason) } })())
        break
      }
      case 'user/message': {
        if (sentIds.has(d.id) || d.source?.kind !== 'user') break
        const t = textOf(d.content).trim()
        if (t) { appendLog({ role: 'user', text: t, at: Date.now(), via: 'dsh' }); broadcast({ type: 'user', text: t }) }
        break
      }
    }
  })

  // ---------- 她主动要看屏幕：neko-eyes 叫桥，桥转给桌宠截图 ----------

  const pendingLooks = new Map()
  bus.lookScreen = (question, timeoutMs = 30000) => new Promise((resolve, reject) => {
    if (!clients.size) return reject(new Error('小白桌宠没连着，看不了屏幕'))
    if (dormantSince) return reject(new Error('你在打盹，不看屏幕'))
    // 你让她看的不限；她自己因为屏幕动态想看的，有冷却和每小时上限
    if (turnOrigin === 'proactive') {
      const lim = { maxPerHour: 6, minGapMin: 3, ...(CFG().autoLook || {}) }
      const now = Date.now()
      while (autoLooks.length && now - autoLooks[0] > 3600000) autoLooks.shift()
      const last = autoLooks[autoLooks.length - 1] || 0
      if (now - last < lim.minGapMin * 60000) return reject(new Error(`刚看过没多久，${Math.ceil((lim.minGapMin * 60000 - (now - last)) / 60000)} 分钟后才能再主动看`))
      if (autoLooks.length >= lim.maxPerHour) return reject(new Error('这一小时主动看屏幕的次数用完了，靠后台那句描述就好'))
      autoLooks.push(now)
    }
    const id = randomUUID()
    const timer = setTimeout(() => { pendingLooks.delete(id); reject(new Error('桌宠那边没及时看完')) }, timeoutMs)
    pendingLooks.set(id, (err, text) => { clearTimeout(timer); pendingLooks.delete(id); err ? reject(err) : resolve(text) })
    broadcast({ type: 'look-request', id, question: String(question || '').slice(0, 300) })
  })

  // ---------- 审批：她的会话要批准的事，转给桌宠让你点 ----------

  const idOf = (req) => [req?.agent?.id, req?.session?.id, req?.sessionId, req?.agentId, req?.request?.sessionId]
    .find(v => typeof v === 'string' && v)

  function toolLabel(tool, args = {}) {
    const n = String(tool || '')
    if (n === 'remember') return `写记忆（${args.category ?? '?'}）：${args.text ?? ''}`
    if (/web_?fetch|browse|http/i.test(n)) return `打开网页：${args.url ?? args.href ?? ''}`
    if (/look_at_screen|screen/i.test(n)) return `看一眼你的屏幕${args.question ? '：' + args.question : ''}`
    const p = args.path ?? args.file_path ?? args.file ?? args.target
    if (p) return `${n}：${p}`
    return n
  }

  function describeApproval(req) {
    const parts = []
    const ask = bus.lastAsk && Date.now() - bus.lastAsk.at < 5000 ? bus.lastAsk : null
    if (ask) parts.push(toolLabel(ask.tool, ask.args))
    const pick = (o) => ['title', 'summary', 'description', 'message', 'reason'].map(k => o?.[k]).find(v => typeof v === 'string' && v.trim())
    const t = pick(req) || pick(req?.request)
    if (t) parts.push(t)
    if (!parts.length) parts.push('她要做一件需要你点头的事')
    return parts.join('｜').slice(0, 400)
  }

  ctx.on('approval/request', async (req, next) => {
    try {
      if (!clients.size || !agent) return next()
      const sid = idOf(req)
      const fromJob = sid ? jobsBySession.get(sid) : null
      if (sid && sid !== agent.id && !fromJob) return next()
      if (!sid && agentStatus !== 'running' && !runningJobs().length) return next()
      const id = randomUUID()
      const summary = (fromJob ? `后台思考 #${fromJob.id} 想：` : '') + describeApproval(req)
      log(`转审批：${summary}`)
      broadcast({ type: 'approval', id, summary })
      return await new Promise((resolve) => {
        const done = (outcome) => {
          if (!pendingApprovals.has(id)) return
          pendingApprovals.delete(id)
          broadcast({ type: 'approval-done', id, outcome })
          resolve(outcome)
        }
        pendingApprovals.set(id, done)
        setTimeout(() => done('cancelled'), (CFG().approvalTimeoutSec || 180) * 1000)
        try { req?.signal?.addEventListener?.('abort', () => done('cancelled'), { once: true }) } catch {}
      })
    } catch (e) {
      warn('转审批出错，交回 dsh 界面：' + errText(e))
      return next()
    }
  }, true)

  // ---------- 后台思考：大问题交给另一个开着深度思考的会话，想完再递回来 ----------

  const thinkerCfg = () => ({ maxConcurrent: 3, reasoning: 'high', model: '', timeoutMin: 10, escalateAfterSec: 20, ...(CFG().thinker || {}) })
  const runningJobs = () => [...jobs.values()].filter(j => j.status === 'running')
  const THOUGHTS_DIR = path.join(here, 'thoughts')
  let jobSeq = 0
  let turnWatch = null
  const turnState = { lastDeltaAt: 0, thinkCalled: false }

  async function spawnThinker() {
    const agentLoop = ctx.get('agentLoop')
    if (!agentLoop) throw new Error('找不到 agentLoop 服务')
    const th = thinkerCfg()
    const opts = {}
    if (chatOpts.provider) opts.provider = chatOpts.provider
    if (th.model || chatOpts.model) opts.model = th.model || chatOpts.model
    if (th.reasoning) opts.reasoningEffort = th.reasoning
    const id = `neko-think-${dateKey()}-${Date.now().toString(36)}`
    const cwd = wsDir()
    const make = async (o) => {
      let r = agentLoop.create(id, o, { cwd })
      if (r && typeof r.then === 'function') r = await r
      return r?.agent ?? r
    }
    let a
    try { a = await make(opts) } catch (e) {
      if (!('reasoningEffort' in opts)) throw e
      delete opts.reasoningEffort
      a = await make(opts)
    }
    if (!a || typeof a.followup !== 'function') throw new Error('没建起后台会话')
    const presets = ctx.get('agentPresets')
    if (presets && chatPresetId && a.ctx && typeof presets.recompose === 'function') {
      try { await presets.recompose(a.ctx, chatPresetId) } catch (e) { warn('后台会话套用预设失败：' + errText(e)) }
    }
    return a
  }

  async function startJob({ task, title, auto = false }) {
    const th = thinkerCfg()
    if (runningJobs().length >= th.maxConcurrent) throw new Error(`后台已经有 ${th.maxConcurrent} 件事在想了`)
    const n = ++jobSeq
    const job = {
      id: n, title: String(title || task).replace(/\s+/g, ' ').trim().slice(0, 30), task, auto,
      status: 'running', startedAt: Date.now(), texts: [], tools: [], agent: null, timer: null,
    }
    jobs.set(n, job)
    try { job.agent = await spawnThinker() } catch (e) { jobs.delete(n); throw e }
    jobsBySession.set(job.agent.id, job)
    const recent = readLog(8).map(e => `${e.role === 'user' ? '对方' : '小白'}：${String(e.text).replace(/\s+/g, ' ').slice(0, 120)}`).join('\n')
    const brief = [
      `【后台思考任务 #${n}】`,
      '你现在在后台帮忙把一个问题想清楚，结果会交给小白转述。不用人设口吻，不用表情标签和口癖，不要调用 think_deeply、remember。需要时可以搜索网页、读工作区里的文件。',
      '想完后先写结论，再写关键理由或步骤，最后写不确定的地方。一般 800 字以内，任务本身要求写长东西就照任务来。',
      recent ? `\n最近的聊天（背景）：\n${recent}` : '',
      `\n任务：\n${task}`,
    ].join('\n')
    job.agent.followup(fromBridge(brief))
    job.timer = setTimeout(() => {
      if (job.status !== 'running') return
      try { job.agent.cancel({ kind: 'user' }) } catch {}
      finishJob(job, 'timeout')
    }, th.timeoutMin * 60000)
    broadcast({ type: 'think-start', id: n, title: job.title, auto, running: runningJobs().length })
    log(`后台思考 #${n} 开始：${job.title}${auto ? '（自动转交）' : ''}`)
    return job
  }

  function onThinkerEvent(job, event) {
    const d = event.data || {}
    if (event.type === 'assistant/message') {
      const t = textOf(d.message?.content).trim()
      if (t) job.texts.push(t)
    } else if (event.type === 'tool/call') {
      job.tools.push(d.name)
    } else if (event.type === 'turn/end') {
      finishJob(job, d.reason?.kind || 'completed')
    }
  }

  function finishJob(job, reason) {
    if (job.status !== 'running') return
    clearTimeout(job.timer)
    const result = job.texts[job.texts.length - 1] || ''
    const ok = reason === 'completed' && !!result
    job.status = ok ? 'done' : (job.cancelRequested ? 'cancelled' : 'failed')
    job.result = result
    job.reason = reason
    job.endedAt = Date.now()
    if (job.agent?.id) jobsBySession.delete(job.agent.id)
    try { job.agent?.dispose?.() } catch {}
    if (result) {
      try {
        fs.mkdirSync(THOUGHTS_DIR, { recursive: true })
        fs.writeFileSync(path.join(THOUGHTS_DIR, `${dateKey()}-${job.id}.md`), `# ${job.title}\n\n## 任务\n${job.task}\n\n## 结果\n${result}\n`, 'utf8')
      } catch {}
    }
    broadcast({ type: 'think-done', id: job.id, title: job.title, ok, status: job.status, result: ok ? result.slice(0, 8000) : '', running: runningJobs().length })
    log(`后台思考 #${job.id} ${ok ? '想完了' : job.status === 'cancelled' ? '撤掉了' : '没想完（' + reason + '）'}，用了 ${((job.endedAt - job.startedAt) / 60000).toFixed(1)} 分钟`)
    const keys = [...jobs.keys()]
    for (const k of keys.slice(0, Math.max(0, keys.length - 12))) if (jobs.get(k)?.status !== 'running') jobs.delete(k)
    if (job.status === 'cancelled' || !agent) return
    const msg = ok
      ? `【后台思考完成 #${job.id}：${job.title}】\n${result.slice(0, 3000)}\n\n用你自己的话讲给对方听，先说结论，一两段就好，对方想看细节再展开。完整内容对方在对话框里也能看到。`
      : `【后台思考没成 #${job.id}：${job.title}】原因：${reason === 'timeout' ? '想太久超时了' : reason}。跟对方说一声，问问要不要换个问法再试。`
    try { deliver(fromBridge(msg), 'thinker') } catch (e) { warn('把结果递回去失败：' + errText(e)) }
  }

  // 你说完一句，她这一轮拖太久还没答完（又不是正在往外说），就整个转给后台
  function startTurnWatch() {
    clearInterval(turnWatch)
    const T = thinkerCfg().escalateAfterSec
    if (!(T > 0) || turnOrigin !== 'user') return
    turnWatch = setInterval(() => {
      if (agentStatus !== 'running' || turnState.thinkCalled) { clearInterval(turnWatch); return }
      const now = Date.now()
      if (now - timing.t0 < T * 1000) return
      if (turnState.lastDeltaAt && now - turnState.lastDeltaAt < 3000) return
      clearInterval(turnWatch)
      escalate()
    }, 1000)
  }

  async function escalate() {
    const th = thinkerCfg()
    if (runningJobs().length >= th.maxConcurrent || !lastUserText || !agent) return
    log(`这一轮超过 ${th.escalateAfterSec} 秒还没答完，自动转给后台`)
    try { agent.cancel({ kind: 'user' }) } catch (e) { warn('停不下这一轮：' + errText(e)); return }
    try {
      const job = await startJob({ task: `对方的原话：${lastUserText}`, title: lastUserText, auto: true })
      broadcast({ type: 'think-escalated', id: job.id })
      deliver(fromBridge(`【系统通知】刚才那个问题你琢磨得有点久，已经自动转给后台去想了（#${job.id}）。跟对方说一声你在想，结果回来之前别自己下结论。`), 'system')
    } catch (e) { warn('自动转交失败：' + errText(e)) }
  }

  // ---------- remember：她自己决定往记忆库里记什么 ----------

  try {
    const { fn: defineTool, via } = await getDefineTool()
    log(`defineTool 来源：${via}`)
    ctx.tools.register(defineTool({
      name: 'remember',
      description: '把值得长期记住的一件事写进本地记忆库。你自己判断什么值得记，不用等对方说“记一下”。一次只记一件事，一句话写完。',
      parameters: {
        category: {
          type: 'string',
          enum: ['profile', 'relationship', 'events'],
          required: true,
          description: 'profile：对方稳定的事实和偏好；relationship：你们之间的称呼、梗、约定；events：发生过、以后可能提起的事',
        },
        text: {
          type: 'string',
          required: true,
          description: '要记的那一句，中性陈述，不用写日期（会自动加）',
        },
        replaces: {
          type: 'string',
          description: '如果这是在更正旧记录，填旧记录里的一小段原文，那一行会被换掉',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        const cat = ['profile', 'relationship', 'events'].includes(args?.category) ? args.category : 'events'
        const text = String(args?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
        if (!text) return '没写内容，没记。'
        if (SECRET_RE.test(text)) return '这条看起来像密码、验证码、卡号之类，按规矩不记。'
        const file = path.join(memDir(), `${cat}.md`)
        let content = ''
        try { content = fs.readFileSync(file, 'utf8') } catch {}
        backup(file, content)
        const line = `- ${dateKey()} ${text}`
        const lines = content.split(/\r?\n/)
        const old = String(args?.replaces ?? '').trim()
        try {
          if (old) {
            const i = lines.findIndex(l => l.includes(old))
            if (i >= 0) {
              lines[i] = line
              fs.writeFileSync(file, lines.join('\n'), 'utf8')
              broadcast({ type: 'remembered', category: cat, text, replaced: true })
              log(`改记忆 ${cat}：${text}`)
              return `已更正：${line}`
            }
          }
          if (lines.some(l => l.replace(/^-\s*\d{4}-\d{2}-\d{2}\s*/, '').trim() === text)) return '这条已经记过了。'
          const base = content.replace(/\s*$/, '')
          fs.writeFileSync(file, (base ? base + '\n' : '') + line + '\n', 'utf8')
          broadcast({ type: 'remembered', category: cat, text, replaced: false })
          log(`记忆 ${cat}：${text}`)
          return `记下了：${line}`
        } catch (e) {
          return `没记成：${errText(e)}`
        }
      },
    }))
    log('remember 工具已注册')

    // ---------- recall_memory：要用的时候自己去翻记忆库 ----------
    ctx.tools.register(defineTool({
      name: 'recall_memory',
      description: '翻本地记忆库。想不起对方的事、你们之间的称呼和约定、以前发生过什么的时候用。按关键词查，多个关键词用空格隔开，命中任意一个就算；不填关键词就把那一类按时间倒序拿出来。',
      parameters: {
        query: { type: 'string', description: '关键词，比如“作息 熬夜”“生日”。不填就是不筛选' },
        category: { type: 'string', enum: ['all', 'profile', 'relationship', 'events'], description: '只翻哪一类，默认 all' },
        limit: { type: 'number', description: '最多返回几条，默认 20，最多 60' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        const dir = memDir()
        const cats = ['profile', 'relationship', 'events']
        const want = cats.includes(args?.category) ? [args.category] : cats
        const keys = String(args?.query ?? '').split(/[\s,，、]+/).map(k => k.trim()).filter(Boolean)
        const limit = Math.max(1, Math.min(60, Number(args?.limit) || 20))
        const label = { profile: '关于对方', relationship: '你们之间', events: '发生过的事' }
        const out = []
        let total = 0
        for (const c of want) {
          let t = ''
          try { t = fs.readFileSync(path.join(dir, `${c}.md`), 'utf8') } catch {}
          let lines = t.split(/\r?\n/).filter(l => /^\s*-\s/.test(l)).map(l => l.trim())
          if (keys.length) lines = lines.filter(l => keys.some(k => l.includes(k)))
          lines = lines.reverse().slice(0, limit)        // 新的在前
          total += lines.length
          if (lines.length) out.push(`## ${label[c]}\n${lines.join('\n')}`)
        }
        broadcast({ type: 'recalled', query: keys.join(' '), count: total })
        if (!out.length) return keys.length ? `记忆库里没找到跟“${keys.join(' ')}”有关的记录。` : '记忆库还是空的。'
        return out.join('\n\n')
      },
    }))
    log('recall_memory 工具已注册')

    const textOut = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }

    ctx.tools.register(defineTool({
      name: 'think_deeply',
      description: '把需要好好想的问题交给后台：要查很多资料、推好几步、算东西、写长东西、比较几个方案的时候用。马上返回，不用等；想完会自动把结果递给你。交出去之后先跟对方说一声你在想，然后照常聊。',
      parameters: {
        task: { type: 'string', required: true, description: '交给后台的完整任务：对方原话、你知道的相关背景、想要什么样的结果。写到一个没看过聊天的人也能直接开工' },
        title: { type: 'string', description: '十个字以内的小标题，显示在对话框里' },
      },
      output: textOut,
      async execute(args) {
        const task = String(args?.task ?? '').trim()
        if (!task) return '没写任务内容，没交出去。'
        try {
          const job = await startJob({ task: task.slice(0, 6000), title: args?.title || task })
          return `已经交给后台了（#${job.id}），想好会自动告诉你。现在先跟对方说一声你在想，结果回来之前别自己下结论。`
        } catch (e) {
          const list = runningJobs().map(j => `#${j.id} ${j.title}`).join('、')
          return `没交出去：${errText(e)}${list ? `。正在想的有：${list}。可以先等一件想完，或者用 cancel_thinking 撤掉一件` : ''}`
        }
      },
    }))

    ctx.tools.register(defineTool({
      name: 'check_thinking',
      description: '看后台思考的进度。对方问“想好了没”的时候用。不填编号就看全部。',
      parameters: { id: { type: 'number', description: '编号，不填就看全部' } },
      output: textOut,
      async execute(args) {
        const fmt = (j) => {
          const secs = Math.round(((j.endedAt || Date.now()) - j.startedAt) / 1000)
          if (j.status === 'running') {
            const last = j.texts[j.texts.length - 1]
            const tools = [...new Set(j.tools)].join('、')
            return `#${j.id} ${j.title}：还在想，已经 ${secs} 秒${tools ? `，用过 ${tools}` : ''}${last ? `。目前写到：${last.slice(0, 200)}` : ''}`
          }
          if (j.status === 'done') return `#${j.id} ${j.title}：想完了，结果已经递给你。开头是：${j.result.slice(0, 300)}`
          return `#${j.id} ${j.title}：${j.status === 'cancelled' ? '撤掉了' : '没想完（' + j.reason + '）'}`
        }
        const id = Number(args?.id)
        if (id) { const j = jobs.get(id); return j ? fmt(j) : `没有 #${id} 这件事。` }
        const all = [...jobs.values()]
        return all.length ? all.map(fmt).join('\n') : '后台现在没在想任何事。'
      },
    }))

    ctx.tools.register(defineTool({
      name: 'cancel_thinking',
      description: '撤掉一件正在后台想的事。对方说不用想了、换个问题的时候用。',
      parameters: { id: { type: 'number', required: true, description: '要撤掉的编号' } },
      output: textOut,
      async execute(args) {
        const j = jobs.get(Number(args?.id))
        if (!j || j.status !== 'running') return '没有这件正在想的事。'
        j.cancelRequested = true
        try { j.agent?.cancel({ kind: 'user' }) } catch {}
        finishJob(j, 'cancelled')
        return `#${j.id} 撤掉了。`
      },
    }))
    log('后台思考工具已注册')
  } catch (e) {
    warn('remember 工具注册失败：' + errText(e))
  }

  // ---------- 给桌宠的本机小接口 ----------

  const token = randomBytes(24).toString('hex')

  const reply = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  }
  // 超过上限时不掐连接（掐了对方只会看到 socket hang up），读完丢掉再回 413
  const readBody = (req, limit = 64 * 1024) => new Promise((resolve, reject) => {
    let size = 0, over = false
    const chunks = []
    req.on('data', (c) => { size += c.length; if (size > limit) over = true; else chunks.push(c) })
    req.on('end', () => {
      if (over) return resolve({ __tooLarge: true, size })
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch { resolve({}) }
    })
    req.on('error', reject)
  })

  async function waitIdleAfterRunning(ms) {
    const t0 = Date.now()
    let sawRunning = agentStatus === 'running'
    while (Date.now() - t0 < ms) {
      if (agentStatus === 'running') sawRunning = true
      if (sawRunning && agentStatus === 'idle') return true
      await sleep(200)
    }
    return false
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.origin) return reply(res, 403, { error: '不接受浏览器请求' })
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(String(req.headers.host || ''))) return reply(res, 403, { error: 'host 不对' })
      if (req.headers['x-neko-token'] !== token) return reply(res, 401, { error: '令牌不对' })

      const url = new URL(req.url, 'http://127.0.0.1')

      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        res.write(`data: ${JSON.stringify({ type: 'hello', agentReady: !!agent, sessionId: agent?.id ?? null, status: agentStatus })}\n\n`)
        clients.add(res)
        const ka = setInterval(() => { try { res.write(': ka\n\n') } catch {} }, 15000)
        req.on('close', () => { clients.delete(res); clearInterval(ka) })
        ensureAgent()
        return
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        return reply(res, 200, { ok: true, agentReady: !!agent, sessionId: agent?.id ?? null, status: agentStatus })
      }
      if (req.method === 'GET' && url.pathname === '/history') {
        return reply(res, 200, readLog(Math.min(1000, Number(url.searchParams.get('limit')) || 200)))
      }
      if (req.method !== 'POST') return reply(res, 404, { error: 'not found' })

      const body = await readBody(req, 1024 * 1024)
      if (body.__tooLarge) return reply(res, 413, { error: `请求太大（${Math.round(body.size / 1024)} KB）` })

      switch (url.pathname) {
        case '/send': {
          const raw = String(body.text ?? '').slice(0, 4000).trim()
          if (!raw) return reply(res, 400, { error: '空消息' })
          if (!(await ensureAgent())) return reply(res, 409, { error: '小白的会话还没准备好' })
          const detail = String(body.screenDetail ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200)
          const _msg = fromUser(contextPrefix(detail) + raw)
          lastUserAt = Date.now()
          lastUserText = raw
          deliver(_msg, 'user')
          appendLog({ role: 'user', text: raw, at: Date.now() })
          return reply(res, 200, { ok: true })
        }

        case '/notify': {
          if (!(await ensureAgent())) return reply(res, 409, { error: '小白的会话还没准备好' })
          const st = readJson(STATE_FILE, {})
          if (body.kind === 'wake') {
            const parts = [`现在是 ${nowText()}`]
            if (body.fromNap && dormantSince) parts.push(`你刚打了个盹，睡了 ${ago(dormantSince)}`)
            else if (!st.lastWake) parts.push('这是你第一次被叫醒')
            else if (st.lastSleep && st.lastSleep >= st.lastWake) parts.push(`上次下班是 ${stamp(new Date(st.lastSleep))}`)
            else parts.push(`上次没有正常下班，最后一次有动静是 ${stamp(new Date(st.lastSeen || st.lastWake))}`)
            dormantSince = null
            const screen = String(body.screen ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
            if (screen) parts.push(`刚瞄了一眼屏幕：${screen}`)

            let extra = ''
            if (freshSession && !body.fromNap) {
              // 新开的会话里她什么都不记得，给一次核心档案；更多的让她自己用 recall_memory 翻
              const dir = memDir()
              const core = ['profile', 'relationship'].map(n => {
                let t = ''
                try { t = fs.readFileSync(path.join(dir, `${n}.md`), 'utf8') } catch {}
                const lines = t.split(/\r?\n/).filter(l => /^\s*-\s/.test(l)).slice(-30)
                return lines.length ? `${n === 'profile' ? '关于对方' : '你们之间'}：\n${lines.join('\n')}` : ''
              }).filter(Boolean)
              if (core.length) extra += '\n\n核心档案（以前的事想不起来就用 recall_memory 翻）：\n' + core.join('\n\n')
              const lines = readLog(6).map(e => `${e.role === 'user' ? '对方' : '你'}：${String(e.text).replace(/\s+/g, ' ').slice(0, 80)}`)
              if (lines.length) extra += '\n\n上次最后聊的几句：\n' + lines.join('\n')
              freshSession = false
            }
            deliver(fromBridge(`【系统通知】你被叫醒了。${parts.join('。')}。${extra}\n用一两句话打个招呼就好，不用复述这条通知。`), 'system')
            writeJson(STATE_FILE, { ...st, lastWake: Date.now(), lastSeen: Date.now() })
            log(body.fromNap ? '打盹后叫醒' : '叫醒')
            return reply(res, 200, { ok: true })
          }
          if (body.kind === 'sleep') {
            deliver(fromBridge(`【系统通知】现在是 ${nowText()}，你要下班了，马上会被关掉。跟对方道个别，一两句就好。今天要是有值得长期记住的事还没记，现在用 remember 记下来。`), 'system')
            writeJson(STATE_FILE, { ...readJson(STATE_FILE, {}), lastSleep: Date.now(), lastSeen: Date.now() })
            log('下班')
            const done = await waitIdleAfterRunning(Math.min(60000, Number(body.waitMs) || 25000))
            return reply(res, 200, { ok: true, finished: done })
          }
          return reply(res, 400, { error: '不认识的通知' })
        }

        case '/screen': {
          const s = String(body.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
          if (s) {
            screenNote = { summary: s, at: Date.now() }
            const notable = Number(body.notable)
            if (Number.isFinite(notable)) maybeProactive(notable)
          }
          return reply(res, 200, { ok: true })
        }

        case '/presence': {
          if (body.dormant === true && !dormantSince) { dormantSince = Date.now(); log('打盹') }
          if (body.dormant === false && dormantSince && !body.keepNap) dormantSince = null
          return reply(res, 200, { ok: true, dormant: !!dormantSince })
        }

        case '/approval': {
          const done = pendingApprovals.get(String(body.id ?? ''))
          if (!done) return reply(res, 404, { error: '这个审批已经不在了' })
          done(body.decision === 'allow' ? 'allowed-once' : 'rejected')
          return reply(res, 200, { ok: true })
        }

        case '/look-result': {
          const done = pendingLooks.get(String(body.id ?? ''))
          if (!done) return reply(res, 404, { error: '这个看屏幕请求已经不在了' })
          if (body.error) done(new Error(String(body.error)))
          else done(null, String(body.text ?? '').trim() || '（什么也没看出来）')
          return reply(res, 200, { ok: true })
        }

        case '/cancel': {
          try { agent?.cancel({ kind: 'user' }) } catch (e) { return reply(res, 500, { error: errText(e) }) }
          return reply(res, 200, { ok: true })
        }
      }
      return reply(res, 404, { error: 'not found' })
    } catch (e) {
      try { reply(res, 500, { error: errText(e) }) } catch {}
    }
  })

  ctx.effect(() => {
    server.listen(Number(CFG().port) || 0, '127.0.0.1', () => {
      const port = server.address().port
      writeJson(RUNTIME_FILE, { port, token, pid: process.pid, startedAt: Date.now() })
      log(`桥已开在 127.0.0.1:${port}`)
    })
    server.on('error', (e) => warn('桥开不起来：' + errText(e)))
    return () => {
      disposed = true
      for (const res of clients) { try { res.end() } catch {} }
      clients.clear()
      for (const done of pendingApprovals.values()) { try { done('cancelled') } catch {} }
      for (const done of pendingLooks.values()) { try { done(new Error('dsh 在关')) } catch {} }
      for (const j of jobs.values()) { if (j.status === 'running') { clearTimeout(j.timer); try { j.agent?.cancel({ kind: 'user' }) } catch {} } }
      clearInterval(turnWatch)
      if (bus.lookScreen) delete bus.lookScreen
      try { server.close() } catch {}
      try { fs.unlinkSync(RUNTIME_FILE) } catch {}
    }
  }, 'neko-bridge.server')
}
