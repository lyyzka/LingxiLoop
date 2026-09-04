import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { CAPABILITY_DOMAINS, CARD_TYPES, COURSES } from './courseData'

const visibleValues = (value: unknown): string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(visibleValues)
  if (value && typeof value === 'object') return Object.values(value).flatMap(visibleValues)
  return []
}

describe('双角色课程内容', () => {
  it('保持两个彼此隔离且不可发送消息的课程作用域', () => {
    expect(COURSES).toHaveLength(2)
    expect(COURSES.map(({ role }) => role).sort()).toEqual(['learner', 'teacher'])
    expect(new Set(COURSES.map(({ workspace }) => workspace.id)).size).toBe(2)
    for (const course of COURSES) {
      expect(course.space.projectId).toBe(course.workspace.id)
      expect(course.course.projectId).toBe(course.workspace.id)
      expect(course.conversations.every(({ readOnly }) => readOnly)).toBe(true)
      expect(course.objectives.every(({ projectId }) => projectId === course.workspace.id)).toBe(true)
      expect(course.activities.every(({ projectId }) => projectId === course.workspace.id)).toBe(true)
      expect(course.missions.every(({ projectId }) => projectId === course.workspace.id)).toBe(true)
      expect(course.canvases.every(({ conversationId }) => course.conversations.some(({ id }) => id === conversationId))).toBe(true)
    }
    const [teacherIds, learnerIds] = COURSES.map((course) => new Set([
      course.workspace.id, ...course.conversations.map(({ id }) => id), ...course.canvases.map(({ id }) => id), ...course.documents.map(({ id }) => id),
    ]))
    expect([...teacherIds!].some((id) => learnerIds!.has(id))).toBe(false)
  })

  it('覆盖 14 个能力域、110 个唯一操作和 17 类结果呈现', () => {
    const operationIds = CAPABILITY_DOMAINS.flatMap(({ operations }) => operations.map(({ id }) => id))
    expect(CAPABILITY_DOMAINS).toHaveLength(14)
    expect(operationIds).toHaveLength(110)
    expect(new Set(operationIds).size).toBe(110)
    expect(operationIds).toContain('files.delete')
    const mappedDomains = new Set(['chat', 'files', 'canvas', 'calendar', 'research', 'email', 'knowledge', 'presentations', 'learning', 'polls', 'teacher'])
    for (const course of COURSES) {
      const messages = course.conversations.flatMap(({ messages }) => messages)
      const calls = course.conversations.flatMap(({ messages }) => messages.flatMap((message) => (
        message.type === 'host' ? message.calls : []
      )))
      const covered = calls
        .map(({ name }) => name)
        .filter((name) => name.startsWith('course-capability:'))
        .map((name) => name.slice('course-capability:'.length))
      expect([...new Set(covered)].sort(), `${course.role} 对话能力不完整`).toEqual([...operationIds].sort())
      for (const { id } of CAPABILITY_DOMAINS) {
        expect(messages.some((message) => message.id === `${course.role}-capability-${id}-result`), `${course.role}/${id} 卡片映射错误`)
          .toBe(mappedDomains.has(id))
      }
    }
    const usedCards = new Set(COURSES.flatMap((course) => course.conversations.flatMap((conversation) => conversation.messages.flatMap((message) => message.cards ?? []))))
    if (COURSES.some(({ agentActivity }) => agentActivity.runStatus === 'running')) usedCards.add('agent-status')
    expect([...usedCards].sort()).toEqual([...CARD_TYPES].sort())
  })

  it('完整呈现教师八阶段和学生两阶段流程', () => {
    const teacher = COURSES.find(({ role }) => role === 'teacher')!
    const learner = COURSES.find(({ role }) => role === 'learner')!
    expect(teacher.journey.map(({ title }) => title)).toEqual([
      '创建课程', '邀请学生并准备资料', '形成学习任务', '学生协作学习', '生成证据与风险判断', '教师收到摘要并干预', '完成任务并获得反馈', '查看干预结果',
    ])
    expect(learner.journey.map(({ title }) => title)).toEqual(['收到老师发布的任务', '在学习室完成项目'])
  })

  it('所有知识引用均使用消息转换器支持的来源标记', () => {
    const copy = visibleValues(COURSES).join('\n')
    expect([...copy.matchAll(/#cite-([^),\s]+)/g)].map(([, marker]) => marker)).toEqual(
      expect.arrayContaining(['S1']),
    )
    expect(copy).not.toMatch(/#cite-(?!S\d+)/)
  })

  it('所有学习评价卡片都带有可渲染的评分明细', () => {
    const evaluationCalls = COURSES.flatMap(({ conversations }) => conversations.flatMap(({ messages }) => (
      messages.flatMap((message) => message.type === 'host'
        ? message.calls.filter(({ name }) => name === 'learning.propose_evaluation')
        : [])
    )))
    expect(evaluationCalls.length).toBeGreaterThan(0)
    expect(evaluationCalls.every(({ args }) => Array.isArray(args.rubricResults))).toBe(true)
  })

  it('用户可见内容不含出戏措辞', () => {
    const forbidden = ['静态', '示例', '样例', '演示模式', '调试', '审查', 'mock', 'fixture', 'Host Bridge', 'IPython']
    const copy = visibleValues({ courses: COURSES, capabilities: CAPABILITY_DOMAINS }).join('\n')
    for (const word of forbidden) expect(copy, `发现禁用措辞：${word}`).not.toContain(word)
  })

  it('保留原生布局、课程切换和会话导航', () => {
    const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')
    const css = readFileSync(new URL('./course.css', import.meta.url), 'utf8')
    const vite = readFileSync(new URL('./vite.config.ts', import.meta.url), 'utf8')
    expect(main).not.toContain('<header')
    expect(main).not.toContain('<select')
    expect(main).not.toContain('智能助教能力')
    expect(main).not.toContain('CapabilitiesPanel')
    expect(main).not.toContain('course-side-nav')
    expect(main).not.toContain('course-overlay')
    expect(main).not.toContain('PanelContent')
    expect(main).not.toContain('captureProductNavigation')
    expect(main).toContain("'切换到学生视角'")
    expect(main).toContain("'切换到教师视角'")
    expect(main).toContain("applyCourse(nextCourse, 'conversations')")
    expect(main).toContain('data-course-role-switch')
    const conversationsPane = readFileSync(new URL('../src/features/conversations/components/ConversationsPane.tsx', import.meta.url), 'utf8')
    expect(conversationsPane).toContain('select(conversation.id)')
    expect(main).toContain('openCanvasPeek')
    expect(css).not.toContain('[data-workspace-titlebar]')
    expect(vite).toContain('port: 5192')
    expect(vite).toContain('strictPort: true')
  })
})
