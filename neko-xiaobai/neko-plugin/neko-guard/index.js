import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'neko-guard'
export const inject = ['tools']

// 用真实路径：通过 dsh plugin add 链接进 dsh 时，也能找回仓库里的原位置
const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)))
// 仓库根目录：桌宠拉起 dsh 时会传 NEKO_HOME；没有就按 插件目录/../.. 算
const REPO = process.env.NEKO_HOME ? path.resolve(process.env.NEKO_HOME) : path.resolve(here, '..', '..')
// policy.json 里的路径可以写相对仓库根目录的，也可以写绝对路径
const fromRepo = (p) => path.isAbsolute(String(p)) ? String(p) : path.resolve(REPO, String(p))
const policyFile = path.join(here, 'policy.json')
const BACKUP_DIR = path.join(here, 'backups')

let cache = { mtime: -1, policy: null }

function loadPolicy() {
  const st = fs.statSync(policyFile)
  if (st.mtimeMs !== cache.mtime) {
    cache = { mtime: st.mtimeMs, policy: JSON.parse(fs.readFileSync(policyFile, 'utf8')) }
  }
  return cache.policy
}

function norm(p) {
  return path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase()
}

function inside(child, parent) {
  const c = norm(child)
  const p = norm(parent)
  if (c === p) return true
  const rel = path.relative(p, c)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

const PATH_KEYS = new Set([
  'path', 'file_path', 'filepath', 'file', 'filename',
  'target', 'target_path', 'source', 'src',
  'destination', 'dest', 'dir', 'directory', 'folder',
  'cwd', 'root', 'paths', 'files'
])

function collectPaths(value, out = [], depth = 0) {
  if (depth > 4 || value == null) return out
  if (Array.isArray(value)) {
    for (const v of value) collectPaths(v, out, depth + 1)
    return out
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (PATH_KEYS.has(k.toLowerCase())) {
        if (typeof v === 'string') out.push(v)
        else collectPaths(v, out, depth + 1)
      }
    }
  }
  return out
}

// 写记忆之前先存一份，写坏了能翻回来（只留最近 200 份）
function backup(file) {
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    fs.copyFileSync(file, path.join(BACKUP_DIR, `${Date.now()}_${path.basename(file)}`))
    const all = fs.readdirSync(BACKUP_DIR).sort()
    for (const old of all.slice(0, Math.max(0, all.length - 200))) fs.unlinkSync(path.join(BACKUP_DIR, old))
  } catch {}
}

const RE_MEMORY_TOOL = /^remember$/i
const RE_RECALL_TOOL = /^recall_memory$/i
const RE_THINK_TOOL = /^(think_deeply|check_thinking|cancel_thinking)$/i
const RE_SCREEN = /(look_at_screen|screen_?shot|capture_?screen)/i
const RE_NET_SEARCH = /(web_?search|search_?web)/i
const RE_NET_FETCH = /(web_?fetch|fetch_?url|url_?fetch|browse|browser|http)/i
const RE_DENY = /(bash|shell|exec|command|terminal|spawn|process|kill|delete|remove|unlink|rename|move|download|network|install|npm|pnpm|git)/i
const RE_WRITE = /(write|edit|patch|create|append|insert|replace|mkdir|touch|save|apply)/i
const RE_READ = /(read|view|cat|open|list|ls|glob|grep|search|find|stat|tree|head|tail)/i

function deny(reason) { return { kind: 'deny', reason: 'neko-guard: ' + reason } }

export function apply(ctx) {
  const bus = (globalThis.__nekoBus ??= {})

  ctx.on('tools/pre-execute', async (exec, next) => {
    let policy
    try {
      policy = loadPolicy()
    } catch (err) {
      return deny('policy.json 读不出来，为安全起见全部拦下。')
    }

    const toolName = String(
      exec?.tool?.name ?? exec?.toolName ?? exec?.name ?? exec?.call?.name ?? ''
    )
    const args = exec?.args ?? exec?.arguments ?? exec?.call?.args ?? exec?.input ?? {}

    if (policy.debug) {
      try {
        ctx.logger.info('[neko-guard] tool=' + toolName + ' args=' + JSON.stringify(args).slice(0, 600))
      } catch {}
    }

    // 要问你的时候，把是什么事告诉桥，桌宠上的审批卡片才说得清楚
    const ask = () => { bus.lastAsk = { tool: toolName, args, at: Date.now() }; return { kind: 'ask' } }

    if (!toolName) return ask()

    // ---- 翻记忆只读，只能读记忆目录，直接放行 ----
    if (RE_RECALL_TOOL.test(toolName)) return next()
    // ---- 后台思考的三个工具：交出去、查进度、撤回，都放行 ----
    if (RE_THINK_TOOL.test(toolName)) return next()

    // ---- 记忆：policy.memoryWrite = auto 自己决定 / ask 每次问 / off 不许写 ----
    const mem = policy.memoryWrite ?? 'ask'
    if (RE_MEMORY_TOOL.test(toolName)) {
      if (mem === 'auto') return next()
      if (mem === 'ask') return ask()
      return deny('现在不许写记忆。')
    }

    // ---- 看屏幕：policy.screen = on / ask / off ----
    if (RE_SCREEN.test(toolName)) {
      const sc = policy.screen ?? 'off'
      if (sc === 'on') return next()
      if (sc === 'ask') return ask()
      return deny('看屏幕的权限关着。')
    }

    // ---- 联网：policy.network = off / search / ask / on ----
    const net = policy.network ?? 'off'
    if (RE_NET_SEARCH.test(toolName)) {
      return net === 'off' ? deny('联网已关闭。') : next()
    }
    if (RE_NET_FETCH.test(toolName)) {
      if (net === 'on') return next()
      if (net === 'ask') return ask()
      return deny(net === 'search' ? '现在只允许搜索，不允许打开具体网页。' : '联网已关闭。')
    }

    if (RE_DENY.test(toolName)) {
      return deny('这类动作（命令、删除、改名、安装）一律不允许。')
    }

    const targets = collectPaths(args)

    if (RE_WRITE.test(toolName)) {
      if (targets.length === 0) return deny('写操作没给出明确路径。')
      const ok = targets.every((t) => (policy.writable || []).some((w) => inside(t, fromRepo(w))))
      if (!ok) return deny('只允许写 memory 目录。')
      if (mem === 'off') return deny('现在不许写记忆。')
      targets.forEach(backup)
      return mem === 'auto' ? next() : ask()
    }

    if (RE_READ.test(toolName)) {
      if (targets.length === 0) return next()
      const ok = targets.every((t) => (policy.readable || []).some((r) => inside(t, fromRepo(r))))
      if (!ok) return deny('这个位置不在允许读取的清单里。')
      return next()
    }

    return policy.unknown === 'allow' ? next() : ask()
  })
}
