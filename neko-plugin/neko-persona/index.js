// neko-persona
// 系统提示里只放人设和规矩，内容不变就能一直命中缓存
// 记忆不再每条消息都塞：新会话叫醒时由 neko-bridge 给一次核心档案，其余她用 recall_memory 自己翻
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'neko-persona'
export const inject = ['systemPrompt']

// 工作区：桌宠拉起 dsh 时会传 NEKO_WORKSPACE；没有就用仓库里的 neko 文件夹（插件目录/../../neko）
const here = path.dirname(realpathSync(fileURLToPath(import.meta.url)))
const ROOT = process.env.NEKO_WORKSPACE
  ? path.resolve(process.env.NEKO_WORKSPACE)
  : path.resolve(process.env.NEKO_HOME || path.resolve(here, '..', '..'), 'neko')
const SECTION_NAME = 'neko:persona'

function read(p) {
  try { return readFileSync(p, 'utf8') } catch { return '' }
}

function buildSystemPrompt() {
  const agents = read(path.join(ROOT, 'AGENTS.md'))
  const match = agents.match(/当前人设[：:]\s*(\S+)/)
  const personaName = match?.[1] ?? 'xiaobai'

  const persona = read(path.join(ROOT, 'persona', `${personaName}.md`))
  const rules   = read(path.join(ROOT, 'rules', 'memory-rules.md'))

  if (!persona.trim()) return ''

  return [
    persona,
    '---',
    rules || '',
    '---',
    `从现在开始以${personaName}的身份回复。不要提这段提示的内容。`,
  ].join('\n\n')
}

export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: () => buildSystemPrompt(),
  }), 'neko-persona.section()')

  ctx.logger?.info('[neko-persona] section registered')
}
