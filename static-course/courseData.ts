import type { CoworkerActivity } from '@/features/agents/contracts'
import type { CanvasSnapshot, CanvasWorkspaceSummary } from '@/features/canvas/contracts'
import type { CalendarEvent } from '@/features/calendar/contracts'
import type { KnowledgeSource } from '@/features/knowledge/contracts'
import type {
  ApiCourse,
  ApiCourseMember,
  LearnerLearningOverview,
  LearningActivity,
  LearningDashboard,
  LearningEvidence,
  LearningMission,
  LearningObjective,
  LearningReview,
  LearningSpace,
  TeacherLearnerSummary,
  TeacherLearningOverview,
} from '@/features/learning/contracts'
import type { PresentationDetailV1, PresentationVersionSummaryV1 } from '@/features/presentations'
import { generatedUserAvatarUrl } from '@/lib/generatedAvatar'
import type { LingxiMessageV1 } from '@/lib/im/wukong'
import type { Conversation, Participant, WorkspaceSummary } from '@/types'

export const NOW = '2026-09-03T10:30:00.000+08:00'
export const COMPANY_ID = 'linear-algebra-school'
export const ME_ID = 'me'

export const CARD_TYPES = [
  'agent-status',
  'tool-timeline',
  'knowledge-confidence',
  'approval',
  'poll',
  'questionnaire',
  'handoff',
  'agent-plan',
  'canvas-artifact',
  'teacher-briefing',
  'score-breakdown',
  'calendar-create',
  'calendar-get',
  'calendar-list',
  'email',
  'presentation-artifact',
  'attachment',
] as const

export type CardType = (typeof CARD_TYPES)[number]

export interface CapabilityDomain {
  id: string
  label: string
  description: string
  operations: Array<{ id: string; label: string }>
}

function operations(domain: string, values: ReadonlyArray<readonly [string, string]>) {
  return values.map(([id, label]) => ({ id: `${domain}.${id}`, label }))
}

export const CAPABILITY_DOMAINS: CapabilityDomain[] = [
  { id: 'chat', label: '对话协作', description: '读取上下文、发起对话、追问并在智能助教之间交接任务。', operations: operations('chat', [['history', '查看对话历史'], ['send', '发送消息'], ['ask', '发起问题'], ['handoff', '交接任务']]) },
  { id: 'memory', label: '长期记忆', description: '回忆、整理、记录并核实与学习者有关的长期信息。', operations: operations('memory', [['recall', '检索记忆'], ['list', '列出记忆'], ['note', '记录记忆'], ['verify', '核实记忆']]) },
  { id: 'files', label: '工作区文件', description: '管理课程空间中的文件与文本内容。', operations: operations('files', [['list', '列出文件'], ['read', '读取文件'], ['write', '写入文件'], ['edit', '编辑文件'], ['grep', '搜索文件内容'], ['delete', '删除工作区文件']]) },
  { id: 'documents', label: '协作文档', description: '创建、读取和精确修订课程文档。', operations: operations('documents', [['list', '列出文档'], ['create', '创建文档'], ['read', '读取文档'], ['append', '在文末追加'], ['prepend', '在文首补充'], ['replace', '替换内容'], ['replace_block', '替换指定区块'], ['rename', '重命名文档'], ['delete', '删除文档']]) },
  { id: 'canvas', label: 'Canvas 协作', description: '让多位智能助教围绕同一学习问题分工、核验并沉淀产物。', operations: operations('canvas', [['available_agents', '查看可用智能助教'], ['start_workspace', '启动 Canvas'], ['add_agents', '加入智能助教'], ['get', '查看 Canvas'], ['submit_report', '提交协作报告'], ['handoff', '交接 Canvas 任务'], ['create_frame', '创建内容块'], ['set_status', '更新协作状态'], ['update_frame', '更新内容块'], ['append_content', '追加内容'], ['delete_frame', '删除内容块']]) },
  { id: 'calendar', label: '日历安排', description: '读取、创建、调整和执行学习日程。', operations: operations('calendar', [['list', '列出日程'], ['get', '查看日程'], ['create', '创建日程'], ['update', '更新日程'], ['run_now', '立即执行任务'], ['dispatches', '查看执行记录'], ['cancel', '取消日程'], ['delete', '删除日程']]) },
  { id: 'routines', label: '例行任务', description: '把周期性提醒和跟进安排为可管理的例行任务。', operations: operations('routines', [['list', '列出例行任务'], ['pause', '暂停例行任务'], ['activate', '启用例行任务'], ['create', '创建例行任务']]) },
  { id: 'research', label: '资料研究', description: '搜索外部资料并阅读可信来源。', operations: operations('research', [['search', '搜索资料'], ['read', '阅读资料']]) },
  { id: 'email', label: '邮件协作', description: '识别邮箱身份、查找联系人并处理课程邮件。', operations: operations('email', [['whoami', '查看邮箱身份'], ['contacts', '查找联系人'], ['inbox', '查看收件箱'], ['show', '查看邮件会话'], ['send', '发送邮件'], ['reply', '回复邮件']]) },
  { id: 'knowledge', label: '课程知识库', description: '建立课程来源、控制可用范围并维护索引。', operations: operations('knowledge', [['list_sources', '列出知识来源'], ['add_text', '添加文本'], ['add_url', '添加网页'], ['add_file', '添加文件'], ['retry_ingestion', '重新处理来源'], ['set_source_enabled', '设置来源可用状态'], ['delete_source', '删除知识来源']]) },
  { id: 'presentations', label: '演示文稿', description: '从课程资料形成大纲、生成页面并迭代成稿。', operations: operations('presentations', [['create', '创建演示文稿'], ['get', '查看演示文稿'], ['revise_outline', '修改大纲'], ['approve_outline', '确认大纲'], ['revise', '修改演示文稿'], ['cancel', '取消生成'], ['retry', '重新生成']]) },
  { id: 'learning', label: '学习闭环', description: '从诊断、计划、练习到证据与评价形成完整学习闭环。', operations: operations('learning', [['current', '查看当前学习状态'], ['get_learner_state', '获取学习者状态'], ['list_knowledge_units', '列出知识单元'], ['list_due', '列出到期复习'], ['get_mission', '查看学习任务'], ['get_activity', '查看学习活动'], ['start_mission', '启动学习任务'], ['add_steps', '添加任务步骤'], ['finish_planning', '完成任务规划'], ['update_step', '更新任务步骤'], ['complete_mission', '完成学习任务'], ['draft_knowledge_units', '起草知识单元'], ['draft_activity', '起草学习活动'], ['record_attempt', '记录作答证据'], ['propose_evaluation', '提交学习评价']]) },
  { id: 'polls', label: '课堂投票', description: '创建、参与、关闭并查看课堂投票。', operations: operations('polls', [['create', '创建投票'], ['vote', '参与投票'], ['close', '关闭投票'], ['show', '查看投票']]) },
  { id: 'teacher', label: '教学运营', description: '帮助教师掌握课程全局、识别风险并完成必要干预。', operations: operations('teacher', [['current', '查看当前教学状态'], ['overview', '查看教学概览'], ['list_learners', '列出学习者'], ['get_learner', '查看学习者详情'], ['get_attempt', '查看作答'], ['list_objectives', '列出学习目标'], ['list_activities', '列出教学活动'], ['list_reviews', '列出复核事项'], ['list_rooms', '列出学习室'], ['get_digest_schedule', '查看简报计划'], ['draft_objectives', '起草学习目标'], ['draft_activity', '起草教学活动'], ['update_course', '更新课程'], ['set_learner_membership', '设置学生成员'], ['set_room_binding', '绑定学习室'], ['configure_digest', '配置教学简报'], ['publish_objective', '发布学习目标'], ['publish_activity', '发布学习活动'], ['close_activity', '关闭学习活动'], ['archive_objective', '归档学习目标'], ['transition_course', '转换课程状态'], ['set_teacher_membership', '设置教师成员'], ['review_evaluation', '复核学习评价']]) },
]

export interface EnvelopeMessage {
  type: 'envelope'
  id: string
  senderId: string
  payload: LingxiMessageV1
  result?: unknown
  cards?: CardType[]
}

export interface HostMessage {
  type: 'host'
  id: string
  senderId: string
  body: string
  runId: string
  calls: Array<{ name: string; args: Record<string, unknown>; result: unknown; isError?: boolean }>
  cards: CardType[]
}

export type CourseMessage = EnvelopeMessage | HostMessage

export interface CourseConversation extends Conversation {
  messages: CourseMessage[]
}

export interface CourseDocument {
  id: string
  title: string
  owner: string
  updatedAt: string
  summary: string
  body: string
}

export interface CourseFixture {
  id: 'teacher-course' | 'learner-course'
  role: 'teacher' | 'learner'
  workspace: WorkspaceSummary
  space: LearningSpace
  course: ApiCourse
  members: ApiCourseMember[]
  participants: Record<string, Participant>
  conversations: CourseConversation[]
  canvases: CanvasSnapshot[]
  canvasSummaries: CanvasWorkspaceSummary[]
  sources: KnowledgeSource[]
  documents: CourseDocument[]
  calendarEvents: CalendarEvent[]
  presentation: PresentationDetailV1
  presentationVersions: PresentationVersionSummaryV1[]
  presentationHtml: string
  objectives: LearningObjective[]
  activities: LearningActivity[]
  missions: LearningMission[]
  evidence: LearningEvidence[]
  reviews: LearningReview[]
  overview: LearnerLearningOverview | TeacherLearningOverview
  dashboard: LearningDashboard
  learners: TeacherLearnerSummary[]
  journey: Array<{ title: string; description: string }>
  agentActivity: CoworkerActivity
}

function envelope(
  id: string,
  senderId: string,
  kind: LingxiMessageV1['kind'],
  body: string,
  data: Record<string, unknown> = {},
  refs: Record<string, string | string[]> = {},
  cards: CardType[] = [],
  result?: unknown,
): EnvelopeMessage {
  return {
    type: 'envelope',
    id,
    senderId,
    payload: { version: 1, kind, clientMsgNo: id, body, data, refs },
    ...(cards.length ? { cards } : {}),
    ...(result === undefined ? {} : { result }),
  }
}

function host(
  id: string,
  senderId: string,
  body: string,
  calls: HostMessage['calls'],
  cards: CardType[],
): HostMessage {
  return { type: 'host', id, senderId, body, runId: `run-${id}`, calls, cards }
}

function participant(
  id: string,
  name: string,
  kind: Participant['kind'],
  role: string,
  initial: string,
  avatarBg: string,
): Participant {
  return {
    id,
    name,
    kind,
    role,
    initial,
    avatarBg,
    avatarUrl: kind === 'human' ? generatedUserAvatarUrl(id) : null,
    status: kind === 'agent' ? 'avail' : 'avail',
    ...(kind === 'agent' ? { capabilities: ['canvas', 'web', 'files', 'documents', 'calendar', 'knowledge', 'learning'] } : {}),
  }
}

function source(
  id: string,
  title: string,
  ownerUserId: string,
  ownerName: string,
  visibilityScope: KnowledgeSource['visibilityScope'],
  extractedText: string,
): KnowledgeSource {
  return {
    id,
    kind: 'file',
    title,
    mimeType: 'application/pdf',
    sizeBytes: 146_000,
    originalUrl: null,
    originalFileUrl: null,
    status: 'ready',
    stage: 'ready',
    error: null,
    isTruncated: false,
    visibilityScope,
    ownerUserId,
    ownerName,
    createdBy: ownerUserId,
    createdVia: ownerUserId.startsWith('agent-') ? 'AGENT' : 'USER',
    createdAt: NOW,
    updatedAt: NOW,
    chunkCount: 12,
    extractedText,
  }
}

function calendarEvent(
  id: string,
  createdBy: string,
  title: string,
  description: string,
  startAt: string,
  endAt: string,
  targetConversationId: string,
  assigneeId: string | null = null,
): CalendarEvent {
  return {
    id,
    companyId: COMPANY_ID,
    createdBy,
    kind: assigneeId ? 'agent_task' : 'personal',
    title,
    description,
    assigneeId,
    targetConversationId,
    agentPrompt: assigneeId ? description : null,
    startAt,
    endAt,
    allDay: false,
    recurrence: null,
    status: 'active',
    lastFiredAt: null,
    reminderMinutesBefore: 15,
    reminderChannel: 'toast',
    isPrivate: false,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function makeCanvas(
  id: string,
  conversationId: string,
  title: string,
  createdBy: string,
  agents: string[],
): CanvasSnapshot {
  const frames = [
    {
      id: `${id}-map`, canvasId: id, type: 'markdown' as const, title: '概念关系图',
      x: 60, y: 70, width: 420, height: 290,
      content: '# 向量空间判断路径\n\n1. 检查加法封闭\n2. 检查数乘封闭\n3. 验证零向量与逆元\n4. 用基与维数解释结构',
      data: {}, revision: 3, createdBy: agents[0]!, updatedBy: agents[0]!, createdAt: NOW, updatedAt: NOW,
    },
    {
      id: `${id}-evidence`, canvasId: id, type: 'markdown' as const, title: '证据与反馈',
      x: 530, y: 110, width: 430, height: 300,
      content: '## 已确认\n\n- 能用封闭性判断子空间\n- 能解释张成与线性无关\n- 已修正把“向量个数”等同于“维数”的误解\n\n## 下一步\n\n迁移到多项式空间。',
      data: {}, revision: 2, createdBy: agents[1] ?? agents[0]!, updatedBy: agents[1] ?? agents[0]!, createdAt: NOW, updatedAt: NOW,
    },
    {
      id: `${id}-solution`, canvasId: id, type: 'html' as const, title: '综合题解题路径',
      x: 280, y: 440, width: 480, height: 240,
      content: '<main style="font-family:system-ui;padding:24px"><h1>从集合到基</h1><p>封闭性 → 张成 → 线性无关 → 基 → 维数</p><p>每一步都附有课程资料中的定义与学生作答证据。</p></main>',
      data: {}, revision: 2, createdBy, updatedBy: createdBy, createdAt: NOW, updatedAt: NOW,
    },
  ]
  return {
    id,
    title,
    companyId: COMPANY_ID,
    conversationId,
    triggerClientMsgNo: `${conversationId}-canvas`,
    goal: '用概念图、例题和学习证据完成向量空间综合任务',
    initiatorAgentId: agents[0]!,
    status: 'completed',
    origin: 'conversation',
    summary: '多智能助教已完成分工，学生证据通过核验，下一轮复习已安排。',
    createdBy,
    createdAt: NOW,
    updatedAt: NOW,
    frames,
    assignments: agents.slice(0, 4).map((agentId, index) => ({
      id: `${id}-assignment-${index}`,
      canvasId: id,
      agentId,
      assignment: ['概念诊断', '苏格拉底式追问', '资料核验', '练习与反馈'][index] ?? '学习支持',
      color: ['#4667d9', '#0f8a7a', '#b46b20', '#7a57c9'][index] ?? '#4667d9',
      status: 'completed' as const,
      workArea: { x: 40 + index * 210, y: 40 + index * 90, width: 360, height: 260 },
      activeFrameId: frames[index % frames.length]!.id,
      cursor: null,
      workId: `${id}-work-${index}`,
      dependsOnAgentIds: index === 0 ? [] : [agents[index - 1]!],
      executionRole: index === agents.length - 1 ? 'verifier' as const : 'specialist' as const,
      verifiesAssignmentId: index === agents.length - 1 ? `${id}-assignment-0` : null,
      result: '任务完成，结论已写入 Canvas。',
      error: null,
      startedAt: NOW,
      completedAt: NOW,
      updatedAt: NOW,
    })),
    presence: [],
    comments: [
      { id: `${id}-comment-1`, canvasId: id, frameId: frames[0]!.id, authorId: createdBy, authorKind: 'user', body: '这里补上“非空”检查后，论证就完整了。', createdAt: NOW },
      { id: `${id}-comment-2`, canvasId: id, frameId: frames[1]!.id, authorId: agents[1] ?? agents[0]!, authorKind: 'agent', body: '已补充反例，并把维数误解关联到下一道练习。', createdAt: NOW },
    ],
    activity: [],
    reports: [],
  }
}

function summary(canvas: CanvasSnapshot): CanvasWorkspaceSummary {
  return {
    id: canvas.id,
    title: canvas.title,
    goal: canvas.goal,
    conversationId: canvas.conversationId,
    initiatorAgentId: canvas.initiatorAgentId,
    status: canvas.status,
    origin: canvas.origin,
    frameCount: canvas.frames.length,
    assignmentCount: canvas.assignments.length,
    updatedAt: canvas.updatedAt,
    createdAt: canvas.createdAt,
  }
}

function presentation(id: string, title: string, sourceIds: string[]): {
  detail: PresentationDetailV1
  versions: PresentationVersionSummaryV1[]
  html: string
} {
  const version: PresentationVersionSummaryV1 = {
    schemaVersion: 'presentation_version_v1',
    id: `${id}-v1`,
    versionNumber: 1,
    pageCount: 6,
    sizeBytes: 94_000,
    sha256: 'course-presentation-v1',
    runtimeVersion: '1',
    rendererVersion: '1',
    createdAt: NOW,
  }
  const detail: PresentationDetailV1 = {
    schemaVersion: 'presentation_detail_v1',
    id,
    title,
    status: 'ready',
    visibilityScope: 'PROJECT',
    requestText: '用定义、反例和学生证据讲清向量空间的判断路径。',
    targetPageCount: 6,
    recommendedPageCount: 6,
    outlineRevision: 2,
    outline: {
      schemaVersion: 'deck_plan_v1',
      title,
      subtitle: '从封闭性到基与维数',
      audience: '线性代数项目课学习者',
      objective: '能判断子空间并解释基与维数',
      language: 'zh-CN',
      targetPageCount: 6,
      sourceCoverage: { selectedSourceCount: sourceIds.length, readySourceCount: sourceIds.length, coveredSourceIds: sourceIds, uncoveredSourceIds: [], coverageRatio: 1 },
      sections: [{
        id: `${id}-section`,
        title: '向量空间判断路径',
        objective: '把定义转成可执行的判断步骤',
        summary: '用反例定位误解，再用综合题完成迁移。',
        pages: [
          { id: `${id}-p1`, pageNumber: 1, kind: 'opening', title: '一个集合何时成为向量空间', conclusion: '从运算封闭性开始检查。', visualType: 'conceptMap', evidenceIds: [], sourceIds, zoomPointCount: 2 },
          { id: `${id}-p2`, pageNumber: 2, kind: 'content', title: '子空间判定', conclusion: '非空与线性组合封闭缺一不可。', visualType: 'process', evidenceIds: ['evidence-subspace'], sourceIds, zoomPointCount: 3 },
          { id: `${id}-p3`, pageNumber: 3, kind: 'content', title: '从张成到基', conclusion: '基同时满足张成与线性无关。', visualType: 'diagram', evidenceIds: ['evidence-basis'], sourceIds, zoomPointCount: 3 },
          { id: `${id}-p4`, pageNumber: 4, kind: 'closing', title: '迁移到新空间', conclusion: '同一套判断路径可迁移到多项式与函数空间。', visualType: 'formula', evidenceIds: ['evidence-transfer'], sourceIds, zoomPointCount: 2 },
        ],
      }],
    },
    sourceSnapshot: sourceIds.map((sourceId, index) => ({ sourceId, title: index === 0 ? '向量空间课程讲义' : '学习证据汇编', visibilityScope: 'PROJECT' })),
    latestVersion: version,
    qualityReport: { schemaVersion: 'presentation_quality_report_v1', evidenceCoverageRatio: 1, sourceCoverageRatio: 1, duplicatePageRatio: 0, issues: [] },
    progress: 100,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;font-family:system-ui;background:#f4f1e8;color:#19202b}main{min-height:100vh;display:grid;place-items:center;padding:8vw;box-sizing:border-box}article{max-width:900px}h1{font-size:clamp(2rem,6vw,5rem);line-height:1.05}p{font-size:clamp(1rem,2.2vw,1.7rem);line-height:1.7}.path{padding:1.2rem;border-radius:1rem;background:white;box-shadow:0 1rem 3rem #0001}</style><main><article><p>向量空间研习</p><h1>${title}</h1><p class="path">封闭性 → 张成 → 线性无关 → 基 → 维数</p><p>课程资料、学生作答与智能助教核验共同支持这条学习路径。</p></article></main></html>`
  return { detail, versions: [version], html }
}

const commonAgents = {
  nova: participant('agent-nova', 'Nova', 'agent', '学习协调智能助教', 'N', '#4667d9'),
  sage: participant('agent-sage', 'Sage', 'agent', '概念导师', 'S', '#0f8a7a'),
  milo: participant('agent-milo', 'Milo', 'agent', '提问教练', 'M', '#b46b20'),
  scout: participant('agent-scout', 'Scout', 'agent', '资料研究智能助教', 'S', '#3577a8'),
  forge: participant('agent-forge', 'Forge', 'agent', '练习设计智能助教', 'F', '#7a57c9'),
  trace: participant('agent-trace', 'Trace', 'agent', '证据核验智能助教', 'T', '#2f855a'),
  pulse: participant('agent-pulse', 'Pulse', 'agent', '教学运营智能助教', 'P', '#a34b78'),
}

const capabilityActors: Record<string, Participant> = {
  chat: commonAgents.milo,
  memory: commonAgents.sage,
  files: commonAgents.forge,
  documents: commonAgents.forge,
  canvas: commonAgents.milo,
  calendar: commonAgents.nova,
  routines: commonAgents.pulse,
  research: commonAgents.scout,
  email: commonAgents.pulse,
  knowledge: commonAgents.sage,
  presentations: commonAgents.forge,
  learning: commonAgents.trace,
  polls: commonAgents.nova,
  teacher: commonAgents.pulse,
}

const capabilityContexts: Record<string, Record<'teacher' | 'learner', string>> = {
  chat: { teacher: '已串联课程筹备、学习证据与干预会话，并把后续追问交接给对应助教。', learner: '已回看任务上下文、补充问题，并让 Nova 把概念追问交接给 Milo。' },
  memory: { teacher: '已核对余澄的概念误解、提示偏好与历次修正记录，形成可追溯的学习画像。', learner: '已找回你的学习重点和先前卡点，并记录本次对基与维数的新理解。' },
  files: { teacher: '已整理任务书、评价标准与证据文件，修订内容并清理重复草稿。', learner: '已读取课程文件、写入个人解题记录，并移除重复的临时草稿。' },
  documents: { teacher: '已创建任务书与证据摘要，完成增补、替换、重命名和归档整理。', learner: '已把概念图说明、迁移证明和反馈整理成可以继续修订的学习文档。' },
  canvas: { teacher: '已安排多位助教在同一 Canvas 分工，核验结论并沉淀教师可查看的报告。', learner: '已让六位助教围绕同一 Canvas 完成分工、追问、修订、交接与报告提交。' },
  calendar: { teacher: '已查看全班安排，创建迁移练习，调整时间并核对执行记录。', learner: '已确认截止时间与复习日程，并检查最近一次学习任务的执行结果。' },
  routines: { teacher: '已配置每周学习风险汇总，并验证暂停、恢复和新建例行跟进均已生效。', learner: '已安排个人间隔复习节奏，并确认暂停与恢复不会丢失下一次提醒。' },
  research: { teacher: '已检索基与维数的常见误解，并阅读可信来源以补强干预依据。', learner: '已搜索子空间判断资料，并阅读与当前迁移题直接相关的来源。' },
  email: { teacher: '已核对发件身份与学生联系人，查看往来邮件并送达本次干预说明。', learner: '已确认课程邮箱、找到教师联系人，并查看和回复任务跟进邮件。' },
  knowledge: { teacher: '已汇集课程文本、网页和文件来源，完成索引维护与可用范围核对。', learner: '已查看当前可用来源，补充学习材料，并确认本次回答引用的是课程知识。' },
  presentations: { teacher: '已根据课程证据创建并修订教学演示文稿，确认大纲和最终版本。', learner: '已查看课程演示文稿，并把自己的概念路径整理成可复习的页面。' },
  learning: { teacher: '已从学习目标、活动与作答记录形成评价，完成任务闭环与教师复核。', learner: '已完成诊断、计划、练习、证据提交、评价和后续复习安排。' },
  polls: { teacher: '已创建并关闭课堂投票，结果用于确定迁移练习时间。', learner: '已参与课堂投票并查看关闭后的全班选择结果。' },
  teacher: { teacher: '已查看课程全局与学习者详情，完成成员、学习室、简报、内容发布和评价复核。', learner: '教师运营记录已转化为你能看到的任务、反馈、风险解除与复习安排。' },
}

function capabilityCard(
  domain: CapabilityDomain,
  role: 'teacher' | 'learner',
  prefix: string,
  agent: Participant,
  canvasId: string,
  presentationId: string,
  conversationId: string,
): CourseMessage | null {
  const id = `${prefix}-capability-${domain.id}-result`
  const refs = { runId: `run-${prefix}-capability-${domain.id}`, agentId: agent.id }
  switch (domain.id) {
    case 'chat':
      return envelope(id, agent.id, 'handoff', '对话上下文和下一步已经交给 Trace 继续核验。', {
        fromAgentId: agent.id, toAgentId: 'agent-trace', status: 'complete', title: '继续核验学习证据',
      }, refs, ['handoff'])
    case 'files':
      return envelope(id, agent.id, 'attachment', role === 'teacher' ? '课程文件整理结果' : '个人学习文件整理结果', {
        url: 'data:text/plain;charset=utf-8,%E5%90%91%E9%87%8F%E7%A9%BA%E9%97%B4%E6%96%87%E4%BB%B6%E6%95%B4%E7%90%86%E7%BB%93%E6%9E%9C',
        name: role === 'teacher' ? '课程文件整理结果.pdf' : '学习文件整理结果.pdf', mime: 'application/pdf', size: 82_000, kind: 'file',
      }, refs, ['attachment'])
    case 'canvas':
      return envelope(id, agent.id, 'canvas', role === 'teacher' ? '课程协作成果' : '我的协作成果', {
        canvasId, title: role === 'teacher' ? '向量空间课程协作成果' : '我的向量空间协作成果',
        goal: role === 'teacher' ? '查看助教分工、学习证据和核验结论' : '查看概念路径、反例和迁移证明', status: 'completed', frameCount: 3,
      }, { ...refs, canvasId }, ['canvas-artifact'])
    case 'calendar': {
      const event = calendarEvent(
        `${prefix}-capability-calendar-event`, agent.id,
        role === 'teacher' ? '查看下一次教师干预' : '查看下一次间隔复习',
        role === 'teacher' ? '核对学习证据并确认风险变化。' : '完成一道改变运算规则的判断题。',
        '2026-09-07T19:30:00+08:00', '2026-09-07T20:00:00+08:00', conversationId,
      )
      return host(id, agent.id, '', [{
        name: 'calendar.get', args: { operation: '查看具体日程', eventId: event.id }, result: { status: 'completed', value: event },
      }], ['calendar-get'])
    }
    case 'research':
    case 'knowledge': {
      const marker = 'S1'
      const claim = role === 'teacher'
        ? '课程资料与学习证据共同支持当前干预判断。'
        : '课程资料支持你在迁移题中使用的判断路径。'
      return envelope(id, agent.id, 'text', `- [${claim}](#cite-${marker})`, {
        rag: {
          claims: [{ id: `${id}-claim`, text: claim, confidence: 'grounded', basis: '向量空间课程讲义', markers: [marker] }],
          documentReferences: [{ marker, sourceId: `${prefix}-source-notes`, title: '向量空间课程讲义', pages: 18, anchors: [{ page: 11, quote: '判断向量空间时，需要先确认集合、运算、非空性与封闭性。' }] }],
        },
      }, refs, ['knowledge-confidence'])
    }
    case 'email':
      return envelope(id, agent.id, 'email', role === 'teacher'
        ? '课程跟进已经送达：请按计划完成迁移练习，我会在下一次简报中查看结果。'
        : '我已收到并回复课程跟进邮件，确认会按计划完成下一次复习。', {
        email: {
          subject: role === 'teacher' ? '向量空间课程跟进' : '回复：向量空间课程跟进',
          from: role === 'teacher' ? '课程助教@灵犀循环.中国' : '你@课程.中国',
          to: [role === 'teacher' ? '余澄@课程.中国' : '林老师@课程.中国'], cc: [], direction: 'outbound', transportStatus: 'sent', transportError: null,
        },
      }, refs, ['email'])
    case 'presentations':
      return envelope(id, agent.id, 'artifact', '向量空间：从直觉到严格判断', {
        artifactId: presentationId, artifactKind: 'lecture_deck_html', title: '向量空间：从直觉到严格判断',
      }, { ...refs, presentationId }, ['presentation-artifact'])
    case 'learning':
      return host(id, agent.id, '', [{
        name: 'learning.propose_evaluation',
        args: {
          operation: '形成学习评价',
          attemptId: `${prefix}-capability-attempt`, demonstratedLevel: role === 'teacher' ? 3.6 : 3.7, confidence: 0.93,
          rubricResults: [
            { label: '概念准确性', score: 3.8, weight: 2, note: '能正确解释子空间、基与维数。' },
            { label: '推理完整性', score: 3.6, weight: 1, note: '证据和结论之间关系清楚。' },
            { label: '迁移应用', score: 3.7, weight: 1, note: '能迁移到多项式空间。' },
          ],
        },
        result: { status: 'completed', value: { status: 'ACCEPTED', evaluationId: `${prefix}-capability-evaluation` } },
      }], ['score-breakdown'])
    case 'polls':
      return envelope(id, agent.id, 'poll', '课堂投票已经结束，练习时间已确认。', {
        poll: {
          question: '下一次迁移练习安排在哪个时段？', mode: 'single', closedAt: NOW,
          options: [{ id: 'evening', text: '周五晚间' }, { id: 'morning', text: '周六上午' }],
        },
        pollTallies: [{ optionId: 'evening', count: 2, voterIds: [ME_ID, 'student-yu'] }, { optionId: 'morning', count: 1, voterIds: ['student-he'] }],
      }, refs, ['poll'])
    case 'teacher':
      return envelope(id, agent.id, 'system', role === 'teacher' ? '课程风险已经解除，干预结果可以查看。' : '教师已经完成复核，你的风险状态已解除。', {
        type: 'teacher_briefing',
        dashboard: {
          id, role: 'information', title: role === 'teacher' ? '课程干预结果' : '我的学习结果', description: '向量空间项目进展',
          stats: [
            { key: 'updates', label: '学习更新', value: 18, sparkline: { data: [8, 12, 15, 18], color: 'var(--chart-1)' } },
            { key: 'attention', label: '需要关注', value: 0, sparkline: { data: [3, 2, 1, 0], color: 'var(--chart-2)' } },
            { key: 'evidence', label: '有效证据', value: 12, sparkline: { data: [3, 6, 9, 12], color: 'var(--chart-3)' } },
            { key: 'mastery', label: '平均掌握', value: role === 'teacher' ? '3.6' : '3.7', sparkline: { data: [2.1, 2.7, 3.2, 3.7], color: 'var(--chart-4)' } },
          ],
        },
      }, refs, ['teacher-briefing'])
    case 'memory':
    case 'documents':
    case 'routines':
      return null
    default:
      return null
  }
}

function capabilityMessages(
  role: 'teacher' | 'learner',
  prefix: string,
  canvasId: string,
  presentationId: string,
  conversationId: string,
): CourseMessage[][] {
  return CAPABILITY_DOMAINS.map((domain) => {
    const agent = capabilityActors[domain.id] ?? commonAgents.nova
    const context = capabilityContexts[domain.id]?.[role] ?? domain.description
    const timeline = host(
      `${prefix}-capability-${domain.id}`,
      agent.id,
      '',
      domain.operations.map((operation) => ({
        name: `course-capability:${operation.id}`,
        args: { operation: operation.label, courseUse: context },
        result: { status: 'completed', value: { summary: `${operation.label}已完成`, outcome: context } },
      })),
      ['tool-timeline'],
    )
    const card = capabilityCard(domain, role, prefix, agent, canvasId, presentationId, conversationId)
    const summary = envelope(
      `${prefix}-capability-${domain.id}-summary`,
      agent.id,
      'text',
      `${agent.name} 已完成${domain.label}：${context}`,
    )
    return card ? [timeline, card, summary] : [timeline, summary]
  })
}

function embedCapabilities(
  story: CourseMessage[],
  capabilities: CourseMessage[][],
  bucket: number,
  bucketCount: number,
): CourseMessage[] {
  return [
    ...story.slice(0, -1),
    ...capabilities.filter((_, index) => index % bucketCount === bucket).flat(),
    ...story.slice(-1),
  ]
}

const objectives = (projectId: string): LearningObjective[] => [
  { id: `${projectId}-objective-subspace`, projectId, title: '判断子空间', successCriteria: '能用非空与线性组合封闭完成严格判断', targetLevel: 3, position: 0, status: 'PUBLISHED', prerequisiteIds: [] },
  { id: `${projectId}-objective-basis`, projectId, title: '解释基与维数', successCriteria: '能同时使用张成和线性无关解释一组向量是否构成基', targetLevel: 4, position: 1, status: 'PUBLISHED', prerequisiteIds: [`${projectId}-objective-subspace`] },
  { id: `${projectId}-objective-transfer`, projectId, title: '迁移到新向量空间', successCriteria: '能把判定方法迁移到多项式空间或函数空间', targetLevel: 4, position: 2, status: 'PUBLISHED', prerequisiteIds: [`${projectId}-objective-basis`] },
]

const activities = (projectId: string): LearningActivity[] => [
  { id: `${projectId}-activity-map`, projectId, title: '绘制向量空间判断图', instructions: '在 Canvas 中把定义、反例和判断步骤连成一条可复用路径。', kind: 'PROJECT', status: 'CLOSED', evaluationMode: 'AGENT_FORMATIVE', targetLevel: 3, rubric: [{ criterion: '概念准确' }, { criterion: '证据可追溯' }], knowledgeUnitIds: [`${projectId}-objective-subspace`, `${projectId}-objective-basis`], dueAt: '2026-09-02T20:00:00.000+08:00' },
  { id: `${projectId}-activity-transfer`, projectId, title: '多项式空间迁移题', instructions: '独立完成判定，并解释所用性质。', kind: 'ASSESSMENT', status: 'PUBLISHED', evaluationMode: 'TEACHER_REQUIRED', targetLevel: 4, rubric: [{ criterion: '方法迁移' }, { criterion: '论证完整' }], knowledgeUnitIds: [`${projectId}-objective-transfer`], dueAt: '2026-09-08T20:00:00.000+08:00' },
]

function baseSources(prefix: string, learnerId: string, learnerName: string): KnowledgeSource[] {
  return [
    source(`${prefix}-source-notes`, '向量空间课程讲义', 'teacher-lin', '林老师', 'PROJECT', '课程讲义给出向量空间、子空间、张成、线性无关、基与维数的定义，并用反例说明封闭性条件为何必要。'),
    source(`${prefix}-source-rubric`, '项目任务与评价标准', 'teacher-lin', '林老师', 'PROJECT', '评价关注概念准确性、推理完整性、证据可追溯性与方法迁移。'),
    source(`${prefix}-source-evidence`, 'Canvas 学习证据汇编', learnerId, learnerName, 'PRIVATE', '学生先把向量个数误认为维数；在反例与追问后，能够用最大线性无关组解释维数，并迁移到多项式空间。'),
  ]
}

function basePresentation(prefix: string, sources: KnowledgeSource[]) {
  return presentation(`${prefix}-presentation`, '向量空间：从直觉到严格判断', sources.map(({ id }) => id))
}

const teacherProjectId = 'vector-spring'
const teacherCourseId = 'course-vector-spring'
const teacherConversations = {
  planning: 'teacher-planning-room',
  evidence: 'teacher-evidence-room',
  intervention: 'teacher-intervention-room',
}
const teacherSources = baseSources('teacher', 'student-yu', '余澄')
const teacherDeck = basePresentation('teacher', teacherSources)
const teacherCanvases = Object.values(teacherConversations).map((conversationId, index) => makeCanvas(
  `teacher-canvas-${index + 1}`,
  conversationId,
  index === 0 ? '向量空间项目任务设计' : index === 1 ? '学习证据与风险图' : '干预结果与迁移练习',
  ME_ID,
  ['agent-nova', 'agent-sage', 'agent-trace', 'agent-forge'],
))

const teacherParticipants: Record<string, Participant> = {
  [ME_ID]: participant(ME_ID, '你', 'human', '课程教师', '你', '#315ea8'),
  'student-yu': participant('student-yu', '余澄', 'human', '学生', '余', '#b45f55'),
  'student-he': participant('student-he', '何简', 'human', '学生', '何', '#567a55'),
  ...Object.fromEntries(Object.values(commonAgents).map((value) => [value.id, value])),
}

const teacherPlanningMessages: CourseMessage[] = [
  envelope('teacher-plan-1', ME_ID, 'text', '课程已经创建完成。余澄和何简都已加入，我也把讲义、项目任务和评价标准放进了课程资料。'),
  envelope('teacher-plan-3', 'agent-nova', 'learning_mission', '向量空间判断与迁移项目', {
    missionId: 'teacher-mission', projectId: teacherProjectId,
    goal: '完成向量空间判断与迁移项目', successCriteria: '每个判断都有定义或反例支持，并完成一道多项式空间迁移题',
    kind: 'PROJECT', coordinatorAgentId: 'agent-nova', status: 'COMPLETED',
  }, { agentId: 'agent-nova' }, ['agent-plan']),
  envelope('teacher-plan-4', 'agent-nova', 'approval', '发布学习目标和项目任务', {
    approval: {
      id: 'teacher-publish', agentId: 'agent-nova', kind: 'sensitive_or_destructive_action',
      summary: '发布学习目标和项目任务', status: 'APPROVED',
      payload: { action: 'teacher.publish_activity', args: { activityId: `${teacherProjectId}-activity-map` } },
      requestedAt: NOW, requestedBy: ME_ID, scope: { risk: 'course_publish' },
    },
  }, { runId: 'teacher-publish', agentId: 'agent-nova' }, ['approval']),
  envelope('teacher-plan-5', 'agent-nova', 'attachment', '项目任务与评价标准', {
    url: 'data:text/plain;charset=utf-8,%E5%90%91%E9%87%8F%E7%A9%BA%E9%97%B4%E9%A1%B9%E7%9B%AE%E8%AF%84%E4%BB%B7%E6%A0%87%E5%87%86',
    name: '向量空间项目任务与评价标准.pdf', mime: 'application/pdf', size: 146000, kind: 'file',
  }, { runId: 'teacher-materials', agentId: 'agent-nova' }, ['attachment']),
  envelope('teacher-plan-2', 'agent-nova', 'text', '我先把目标收束为“能严格判断子空间，并把方法迁移到多项式空间”。接下来用一个 Canvas 项目串联概念、反例和综合题。'),
  envelope('teacher-plan-6', ME_ID, 'text', '很好。任务按这个版本发布，学习室里保留同学互评，关键评价由 Trace 核验后再进入我的简报。'),
]

const teacherEvidenceMessages: CourseMessage[] = [
  envelope('teacher-evidence-1', 'student-yu', 'text', '我把“向量个数就是维数”写进了第一版概念图。何简提醒我，三个向量也可能线性相关，所以我们补了一组反例。'),
  envelope('teacher-evidence-2', 'agent-sage', 'canvas', '学习证据与风险图', {
    canvasId: teacherCanvases[1]!.id, title: '学习证据与风险图', goal: '把概念误解、同伴反馈和修正证据放在同一个 Canvas 中', status: 'completed', frameCount: 3,
  }, { runId: 'teacher-canvas', agentId: 'agent-sage', canvasId: teacherCanvases[1]!.id }, ['canvas-artifact']),
  envelope('teacher-evidence-2-summary', 'agent-sage', 'text', '我已把概念误解、同伴反馈和修正证据整理到同一个 Canvas，教师可以沿证据链查看变化。'),
  envelope('teacher-evidence-3', 'agent-scout', 'text', '- [课程讲义指出，维数由任一组基中向量的个数定义，而不是任意向量组的大小。](#cite-S1)', {
    rag: {
      claims: [{ id: 'teacher-claim-1', text: '课程讲义指出，维数由任一组基中向量的个数定义，而不是任意向量组的大小。', confidence: 'grounded', basis: '向量空间课程讲义', markers: ['S1'] }],
      documentReferences: [{ marker: 'S1', sourceId: teacherSources[0]!.id, title: teacherSources[0]!.title, pages: 18, anchors: [{ page: 11, quote: '有限维向量空间的维数，是这个空间任意一组基所含向量的个数。' }] }],
    },
  }, { runId: 'teacher-evidence-rag', agentId: 'agent-scout' }, ['knowledge-confidence']),
  host('teacher-evidence-4', 'agent-nova', '', [
    { name: 'research.search', args: { query: '基与维数常见误解', limit: 5 }, result: { status: 'completed', value: { count: 5 } } },
    { name: 'memory.recall', args: { query: '余澄的线性无关学习记录' }, result: { status: 'completed', value: { count: 3 } } },
    { name: 'documents.create', args: { title: '余澄学习证据摘要' }, result: { status: 'completed', value: { documentId: 'teacher-document-evidence' } } },
    { name: 'learning.get_learner_state', args: { learnerId: 'student-yu' }, result: { status: 'completed', value: { mastery: 3.6 } } },
  ], ['tool-timeline']),
  envelope('teacher-evidence-5', 'agent-nova', 'handoff', '请 Trace 核验概念修正是否由学生独立完成。', {
    fromAgentId: 'agent-nova', toAgentId: 'agent-trace', status: 'complete', title: '核验概念修正证据',
  }, { runId: 'teacher-handoff', fromAgentId: 'agent-nova', toAgentId: 'agent-trace' }, ['handoff']),
  envelope('teacher-evidence-5-summary', 'agent-nova', 'text', '资料、记忆和学习记录已汇总，概念修正证据也已交给 Trace 独立核验。'),
  host('teacher-evidence-6', 'agent-trace', '', [{
    name: 'learning.propose_evaluation',
    args: {
      attemptId: 'teacher-attempt-1', demonstratedLevel: 3.6, confidence: 0.91,
      rubricResults: [
        { label: '概念准确性', score: 3.8, weight: 2, note: '能区分任意向量组与基。' },
        { label: '推理完整性', score: 3.5, weight: 1, note: '能用反例修正原判断。' },
        { label: '迁移应用', score: 3.4, weight: 1, note: '已开始迁移到多项式空间。' },
      ],
    },
    result: { status: 'completed', value: { status: 'ACCEPTED', evaluationId: 'teacher-evaluation-1' } },
  }], ['score-breakdown']),
  envelope('teacher-evidence-6-summary', 'agent-trace', 'text', '核验完成：学生已经能用线性无关解释维数。'),
  envelope('teacher-evidence-7', 'agent-pulse', 'system', '本周期共有 18 条学习更新，余澄的“基与维数”风险已从需要关注转为持续观察。', {
    type: 'teacher_briefing',
    dashboard: {
      id: 'teacher-briefing', role: 'information', title: '本周学习情况', description: '向量空间项目进展',
      stats: [
        { key: 'updates', label: '学习更新', value: 18, sparkline: { data: [8, 12, 15, 18], color: 'var(--chart-1)' } },
        { key: 'attention', label: '需要关注', value: 0, sparkline: { data: [3, 2, 1, 0], color: 'var(--chart-2)' } },
        { key: 'evidence', label: '有效证据', value: 12, sparkline: { data: [3, 6, 9, 12], color: 'var(--chart-3)' } },
        { key: 'mastery', label: '平均掌握', value: '3.6', sparkline: { data: [2.1, 2.7, 3.2, 3.6], color: 'var(--chart-4)' } },
      ],
    },
  }, { briefingId: 'teacher-briefing' }, ['teacher-briefing']),
  envelope('teacher-evidence-7-summary', 'agent-pulse', 'text', '本周期共有 18 条学习更新，余澄的“基与维数”风险已从需要关注转为持续观察。'),
  envelope('teacher-evidence-8', ME_ID, 'text', '我已收到简报，下一步只保留迁移练习，并在完成后查看风险是否解除。'),
]

const teacherInterventionMessages: CourseMessage[] = [
  envelope('teacher-intervention-1', 'agent-pulse', 'email', '余澄同学，你已经修正了“向量个数等于维数”的判断。请在周五前完成多项式空间迁移题，并把关键步骤放进 Canvas。', {
    email: { subject: '向量空间项目跟进', from: '课程助教@灵犀循环.中国', to: ['余澄@课程.中国'], cc: ['教师@课程.中国'], direction: 'outbound', transportStatus: 'sent', transportError: null },
  }, { runId: 'teacher-email', agentId: 'agent-pulse' }, ['email']),
  envelope('teacher-intervention-2', 'agent-pulse', 'poll', '迁移练习时间已确认。', {
    poll: {
      question: '本周哪一个时间段最适合完成迁移练习？', mode: 'single', closedAt: '2026-09-02T18:00:00.000+08:00',
      options: [{ id: 'thu', text: '周四晚间' }, { id: 'fri', text: '周五晚间' }, { id: 'sat', text: '周六上午' }],
    },
    pollTallies: [{ optionId: 'thu', count: 1, voterIds: ['student-he'] }, { optionId: 'fri', count: 2, voterIds: ['student-yu', ME_ID] }, { optionId: 'sat', count: 0, voterIds: [] }],
  }, { pollClientMsgNo: 'teacher-intervention-2' }, ['poll']),
  envelope('teacher-intervention-2-summary', 'agent-pulse', 'text', '干预说明已经送达，课堂投票也已确认周五晚间为迁移练习时间。'),
  envelope('teacher-intervention-3', 'agent-nova', 'approval', '安排多项式空间迁移练习', {
    approval: {
      id: 'teacher-calendar-create', agentId: 'agent-nova', kind: 'calendar_create', summary: '安排多项式空间迁移练习', status: 'APPROVED',
      payload: { action: 'calendar.create', args: { title: '多项式空间迁移练习', at: '2026-09-04T19:30:00+08:00', endAt: '2026-09-04T20:15:00+08:00', kind: 'personal' } },
      requestedAt: NOW, requestedBy: ME_ID, scope: { risk: 'calendar_create' },
    },
  }, { approvalId: 'teacher-calendar-create', runId: 'teacher-calendar-create', agentId: 'agent-nova' }, ['calendar-create']),
  host('teacher-intervention-4', 'agent-nova', '', [{
    name: 'calendar.get', args: { eventId: 'teacher-event-transfer' },
    result: { status: 'completed', value: calendarEvent('teacher-event-transfer', ME_ID, '多项式空间迁移练习', '完成迁移题并把关键步骤放进 Canvas。', '2026-09-04T19:30:00+08:00', '2026-09-04T20:15:00+08:00', teacherConversations.intervention) },
  }], ['calendar-get']),
  host('teacher-intervention-5', 'agent-nova', '', [{
    name: 'calendar.list', args: { from: '2026-09-03T00:00:00+08:00', to: '2026-09-10T00:00:00+08:00' },
    result: { status: 'completed', value: [
      calendarEvent('teacher-event-transfer', ME_ID, '多项式空间迁移练习', '完成迁移题并把关键步骤放进 Canvas。', '2026-09-04T19:30:00+08:00', '2026-09-04T20:15:00+08:00', teacherConversations.intervention),
      calendarEvent('teacher-event-review', ME_ID, '教师查看干预结果', '查看迁移作答、Trace 评价与风险变化。', '2026-09-05T17:00:00+08:00', '2026-09-05T17:30:00+08:00', teacherConversations.intervention),
    ] },
  }], ['calendar-list']),
  envelope('teacher-intervention-5-summary', 'agent-nova', 'text', '单项安排已经确认，迁移练习与教师复核形成了连续节奏。'),
  envelope('teacher-intervention-6', 'agent-forge', 'artifact', '向量空间：从直觉到严格判断', {
    artifactId: teacherDeck.detail.id, artifactKind: 'lecture_deck_html', title: teacherDeck.detail.title,
  }, { presentationId: teacherDeck.detail.id, agentId: 'agent-forge' }, ['presentation-artifact']),
  envelope('teacher-intervention-6-summary', 'agent-forge', 'text', '演示文稿已结合本轮学习证据更新，可以直接查看从概念判断到迁移练习的路径。'),
  envelope('teacher-intervention-7', 'student-yu', 'text', '迁移题已经完成。我先检查多项式集合非空，再验证线性组合封闭，最后用一组基说明维数。Trace 的反馈也已写进 Canvas。'),
  envelope('teacher-intervention-8', ME_ID, 'text', '我看到了：风险已经解除，掌握等级从 2.4 提升到 3.6。下一轮只保留一道间隔复习题，不再追加补救任务。'),
]

const teacherCapabilityMessages = capabilityMessages(
  'teacher',
  'teacher',
  teacherCanvases[0]!.id,
  teacherDeck.detail.id,
  teacherConversations.planning,
)

const teacherFixture: CourseFixture = {
  id: 'teacher-course',
  role: 'teacher',
  workspace: { id: teacherProjectId, companyId: COMPANY_ID, kind: 'TEACHING', planId: null, name: '向量空间研习 · 春季班', description: '从子空间判断到基与维数迁移的项目课', color: '#315ea8', status: 'ACTIVE', createdBy: ME_ID, isDefault: false, createdAt: NOW, updatedAt: NOW, archivedAt: null, lastVisitedAt: NOW, sourceCount: teacherSources.length, conversationCount: 3, documentCount: 3, calendarEventCount: 3, canvasCount: teacherCanvases.length, canManage: true },
  space: { companyId: COMPANY_ID, projectId: teacherProjectId, projectKind: 'TEACHING', courseId: teacherCourseId, title: '向量空间研习 · 春季班', description: '学生以真实问题为线索，在同一工作区完成概念诊断、协作推理、证据提交与迁移练习。', color: '#315ea8', status: 'ACTIVE', perspective: 'teacher', canManage: true, canEditContent: false, canUpdateCourse: false, canInviteMembers: false, canRevokeInvitations: false, canUpdateMembers: false, canRemoveMembers: false, canSubmit: false, canReview: true, lifecycleAction: null, studyRoomId: teacherConversations.planning, isDefault: false, lastVisitedAt: NOW },
  course: { id: teacherCourseId, companyId: COMPANY_ID, projectId: teacherProjectId, projectKind: 'TEACHING', name: '向量空间研习 · 春季班', description: '从子空间判断到基与维数迁移的项目课', color: '#315ea8', status: 'ACTIVE', createdBy: ME_ID, studyRoomId: teacherConversations.planning, courseRole: 'teacher', memberCount: 3, canManage: true, createdAt: NOW, updatedAt: NOW },
  members: [
    { id: ME_ID, name: '你', email: 'teacher@course.cn', role: 'teacher', joinedAt: NOW },
    { id: 'student-yu', name: '余澄', email: 'yucheng@course.cn', role: 'learner', joinedAt: NOW },
    { id: 'student-he', name: '何简', email: 'hejian@course.cn', role: 'learner', joinedAt: NOW },
  ],
  participants: teacherParticipants,
  conversations: [
    { id: teacherConversations.planning, kind: 'group', title: '课程筹备与任务设计', subtitle: '你、Nova、Sage', topic: '从课程创建到任务发布', members: [ME_ID, 'agent-nova', 'agent-sage'], leaderId: 'agent-nova', readOnly: true, pinned: true, unread: 0, lastMessageId: 'teacher-plan-6', lastAt: '09:10', lastAtIso: NOW, preview: '你：关键评价由 Trace 核验后进入简报', tag: 'team', messages: embedCapabilities(teacherPlanningMessages, teacherCapabilityMessages, 0, 3) },
    { id: teacherConversations.evidence, kind: 'group', title: '学习证据与风险', subtitle: '余澄、Sage、Scout、Trace', topic: '识别误解并核验证据', members: ['student-yu', 'agent-sage', 'agent-scout', 'agent-trace', ME_ID], leaderId: 'agent-trace', readOnly: true, pinned: true, unread: 0, lastMessageId: 'teacher-evidence-7', lastAt: '昨天', lastAtIso: '2026-09-02T18:20:00.000+08:00', preview: 'Pulse：风险已从需要关注转为持续观察', tag: 'team', messages: embedCapabilities(teacherEvidenceMessages, teacherCapabilityMessages, 1, 3) },
    { id: teacherConversations.intervention, kind: 'group', title: '教师干预与完成反馈', subtitle: '你、余澄、Pulse、Forge', topic: '跟进迁移任务并查看干预结果', members: [ME_ID, 'student-yu', 'agent-pulse', 'agent-forge'], leaderId: 'agent-pulse', readOnly: true, pinned: false, unread: 0, lastMessageId: 'teacher-intervention-8', lastAt: '昨天', lastAtIso: '2026-09-02T20:20:00.000+08:00', preview: '你：风险已经解除，掌握等级提升到 3.6', tag: 'team', messages: embedCapabilities(teacherInterventionMessages, teacherCapabilityMessages, 2, 3) },
  ],
  canvases: teacherCanvases,
  canvasSummaries: teacherCanvases.map(summary),
  sources: teacherSources,
  documents: [
    { id: 'teacher-document-task', title: '向量空间项目任务书', owner: '你', updatedAt: NOW, summary: '学习目标、完成标准、时间线与协作方式。', body: '学生需要在同一 Canvas 中完成子空间判定、基与维数解释及多项式空间迁移。每条结论必须关联定义、反例或作答证据。' },
    { id: 'teacher-document-evidence', title: '余澄学习证据摘要', owner: 'Nova', updatedAt: NOW, summary: '记录概念误解、同伴反馈、修正过程与迁移表现。', body: '初始风险：把任意向量组大小当作维数。干预后：能用基的定义解释维数，并完成多项式空间迁移。当前掌握等级 3.6。' },
    { id: 'teacher-document-result', title: '教师干预结果', owner: 'Pulse', updatedAt: NOW, summary: '风险解除，后续转为间隔复习。', body: '邮件跟进与迁移练习均已完成。Trace 核验证据成立，教师确认不再追加补救任务，下周安排一道间隔复习题。' },
  ],
  calendarEvents: [
    calendarEvent('teacher-event-launch', ME_ID, '项目任务发布', '向学生发布项目任务和评价标准。', '2026-09-01T09:00:00+08:00', '2026-09-01T09:30:00+08:00', teacherConversations.planning),
    calendarEvent('teacher-event-transfer', ME_ID, '多项式空间迁移练习', '完成迁移题并把关键步骤放进 Canvas。', '2026-09-04T19:30:00+08:00', '2026-09-04T20:15:00+08:00', teacherConversations.intervention),
    calendarEvent('teacher-event-review', ME_ID, '教师查看干预结果', '查看迁移作答、Trace 评价与风险变化。', '2026-09-05T17:00:00+08:00', '2026-09-05T17:30:00+08:00', teacherConversations.intervention),
  ],
  presentation: teacherDeck.detail,
  presentationVersions: teacherDeck.versions,
  presentationHtml: teacherDeck.html,
  objectives: objectives(teacherProjectId),
  activities: activities(teacherProjectId),
  missions: [],
  evidence: [],
  reviews: [],
  overview: { perspective: 'teacher', windowDays: 30, summary: { learnerCount: 2, pendingReviews: 0, attempts: 8, learnersWithEvidence: 2, dueReviews: 1 }, masteryDistribution: [{ level: 2, count: 0 }, { level: 3, count: 1 }, { level: 4, count: 1 }], missionDistribution: [{ status: 'COMPLETED', count: 2 }], evaluationDistribution: [{ status: 'ACCEPTED', count: 8 }], attention: [] },
  dashboard: { projects: [], due: [], states: [], pendingReviews: 0 },
  learners: [
    { learnerId: 'student-yu', displayName: '余澄', email: 'yucheng@course.cn', averageLevel: 3.6, verifiedObjectives: 3, dueReviews: 1, needsReview: 0, pausedMissions: 0, attemptCount: 5, lastAttemptAt: NOW, attentionReasons: [] },
    { learnerId: 'student-he', displayName: '何简', email: 'hejian@course.cn', averageLevel: 3.8, verifiedObjectives: 3, dueReviews: 0, needsReview: 0, pausedMissions: 0, attemptCount: 3, lastAttemptAt: NOW, attentionReasons: [] },
  ],
  journey: [
    { title: '创建课程', description: '课程空间、身份与项目主题已经确定。' },
    { title: '邀请学生并准备资料', description: '学生已经加入，讲义、任务与评价标准均可访问。' },
    { title: '形成学习任务', description: 'Nova 引导教师把课程目标转成可验证的项目任务。' },
    { title: '学生协作学习', description: '学生与智能助教、同学和文档在同一工作区推进任务。' },
    { title: '生成证据与风险判断', description: '系统把作答、Canvas 变化与资料引用汇总为学习证据。' },
    { title: '教师收到摘要并干预', description: 'Pulse 送达简报，教师安排跟进邮件与迁移练习。' },
    { title: '完成任务并获得反馈', description: '学生完成迁移题，Trace 给出评分与改进建议。' },
    { title: '查看干预结果', description: '教师看到风险解除、掌握提升和下一轮复习安排。' },
  ],
  agentActivity: { id: 'teacher-agent-status', runId: 'teacher-followup-status', agentId: 'agent-pulse', agentName: 'Pulse', runStatus: 'running', kind: 'course_digest', level: 'info', title: '正在整理下一轮间隔复习', createdAt: NOW },
}

const learnerProjectId = 'vector-colearning'
const learnerCourseId = 'course-vector-colearning'
const learnerConversations = { room: 'learner-project-room', feedback: 'learner-feedback-room' }
const learnerSources = baseSources('learner', ME_ID, '你')
const learnerDeck = basePresentation('learner', learnerSources)
const learnerCanvases = Object.values(learnerConversations).map((conversationId, index) => makeCanvas(
  `learner-canvas-${index + 1}`,
  conversationId,
  index === 0 ? '我的向量空间学习 Canvas' : '提交证据与反馈',
  ME_ID,
  ['agent-nova', 'agent-sage', 'agent-milo', 'agent-trace'],
))

const learnerParticipants: Record<string, Participant> = {
  [ME_ID]: participant(ME_ID, '你', 'human', '课程学生', '你', '#315ea8'),
  'teacher-lin': participant('teacher-lin', '林老师', 'human', '课程教师', '林', '#754a98'),
  'peer-an': participant('peer-an', '安禾', 'human', '同学', '安', '#a56232'),
  ...Object.fromEntries(Object.values(commonAgents).map((value) => [value.id, value])),
}

const learnerRoomMessages: CourseMessage[] = [
  envelope('learner-room-1', 'teacher-lin', 'text', '本周任务已经发布：请在 Canvas 中完成一张“子空间判断—基—维数”的概念图，再用同一套方法判断次数不超过 2 的多项式是否构成向量空间。'),
  envelope('learner-room-2', ME_ID, 'text', '我能照着定义检查，但还不确定应该先做反例还是先画概念图。'),
  envelope('learner-room-3', 'agent-nova', 'questionnaire', '先确认你的学习起点。', {
    questionnaire: {
      title: '确定项目起点',
      items: [
        { name: 'confidence', prompt: '你最有把握的部分是什么？', required: true, choices: [{ value: 'closure', label: '封闭性判断' }, { value: 'basis', label: '基与维数' }, { value: 'proof', label: '完整证明' }] },
        { name: 'focus', prompt: '今天最想解决哪个卡点？', required: true, input: { label: '学习重点', placeholder: '写下一个具体卡点' } },
      ],
      submitLabel: '确认起点',
    },
  }, { runId: 'learner-questionnaire', agentId: 'agent-nova' }, ['questionnaire'], { confidence: 'closure', focus: '基为什么必须同时满足张成和线性无关' }),
  envelope('learner-room-4', 'agent-nova', 'learning_mission', '向量空间判断与迁移项目', {
    missionId: 'learner-mission', projectId: learnerProjectId,
    goal: '完成概念图与多项式空间迁移题', successCriteria: '能独立解释每一步判断，并提交可核验的 Canvas 证据',
    kind: 'PROJECT', coordinatorAgentId: 'agent-nova', status: 'COMPLETED',
  }, { agentId: 'agent-nova' }, ['agent-plan']),
  envelope('learner-room-4-summary', 'agent-nova', 'text', '你的起点已经确认。我把任务拆成概念图、反例核验和多项式空间迁移三段，接下来先由 Sage 带你画判断路径。'),
  envelope('learner-room-5', 'agent-sage', 'text', '先画判断路径，再为每个判断补一个反例。这样概念图会成为解题工具，而不只是定义抄写。'),
  envelope('learner-room-6', 'agent-nova', 'canvas', '我的向量空间学习 Canvas', {
    canvasId: learnerCanvases[0]!.id, title: '我的向量空间学习 Canvas', goal: '让 Nova、Sage、Milo、Scout、Forge、Trace 围绕同一个项目分工协作', status: 'completed', frameCount: 3,
  }, { runId: 'learner-canvas', agentId: 'agent-nova', canvasId: learnerCanvases[0]!.id }, ['canvas-artifact']),
  envelope('learner-room-7', 'agent-nova', 'handoff', '概念路径已经搭好，请 Milo 用追问检查你是否真正理解“基”。', {
    fromAgentId: 'agent-nova', toAgentId: 'agent-milo', status: 'complete', title: '检查基与维数理解',
  }, { runId: 'learner-handoff', fromAgentId: 'agent-nova', toAgentId: 'agent-milo' }, ['handoff']),
  envelope('learner-room-7-summary', 'agent-nova', 'text', 'Canvas 已就绪，概念路径也已交给 Milo 继续用追问核验。'),
  envelope('learner-room-8', 'agent-milo', 'text', '如果三个向量张成整个空间，但其中一个可以由另外两个线性表示，它们还是一组基吗？先把你的判断写进 Canvas。'),
  envelope('learner-room-9', ME_ID, 'text', '不是。它们虽然能张成空间，但线性相关，所以不是基；删去冗余向量后，剩下的最大线性无关组才可以成为基。'),
  envelope('learner-room-10', 'agent-scout', 'text', '- [课程讲义把基定义为既能张成空间又线性无关的向量组。](#cite-S1)', {
    rag: {
      claims: [{ id: 'learner-claim-1', text: '课程讲义把基定义为既能张成空间又线性无关的向量组。', confidence: 'grounded', basis: '向量空间课程讲义', markers: ['S1'] }],
      documentReferences: [{ marker: 'S1', sourceId: learnerSources[0]!.id, title: learnerSources[0]!.title, pages: 18, anchors: [{ page: 10, quote: '向量空间的一组基，是该空间中一组线性无关的生成集。' }] }],
    },
  }, { runId: 'learner-rag', agentId: 'agent-scout' }, ['knowledge-confidence']),
  host('learner-room-11', 'agent-nova', '', [
    { name: 'chat.history', args: { limit: 40 }, result: { status: 'completed', value: { count: 10 } } },
    { name: 'knowledge.list_sources', args: { projectId: learnerProjectId }, result: { status: 'completed', value: { count: 3 } } },
    { name: 'canvas.get', args: { canvasId: learnerCanvases[0]!.id }, result: { status: 'completed', value: { frameCount: 3 } } },
    { name: 'learning.record_attempt', args: { activityId: `${learnerProjectId}-activity-map` }, result: { status: 'completed', value: { attemptId: 'learner-attempt-1' } } },
  ], ['tool-timeline']),
  envelope('learner-room-11-summary', 'agent-nova', 'text', '六位智能助教已经把学习路径、资料和证据汇总到同一个工作区。'),
  envelope('learner-room-12', 'peer-an', 'text', '我看了你的概念图。把“非空”放到封闭性前面后，整条判断路径更严谨，我也按你的反例改了自己的版本。'),
]

const learnerFeedbackMessages: CourseMessage[] = [
  envelope('learner-feedback-1', ME_ID, 'text', '我已提交多项式空间迁移题：次数不超过 2 的多项式在通常加法和数乘下非空且封闭，因此构成向量空间；一组基可以取 1、x、x²，维数为 3。'),
  host('learner-feedback-2', 'agent-trace', '', [{
    name: 'learning.propose_evaluation',
    args: {
      attemptId: 'learner-attempt-2', demonstratedLevel: 3.7, confidence: 0.93,
      rubricResults: [
        { label: '概念准确性', score: 3.8, weight: 2, note: '正确使用非空与封闭性。' },
        { label: '推理完整性', score: 3.6, weight: 1, note: '证明步骤清楚且顺序合理。' },
        { label: '迁移应用', score: 3.7, weight: 1, note: '能迁移到多项式空间并给出一组基。' },
      ],
    },
    result: { status: 'completed', value: { status: 'ACCEPTED', evaluationId: 'learner-evaluation-2' } },
  }], ['score-breakdown']),
  envelope('learner-feedback-2-summary', 'agent-trace', 'text', '证据已核验，概念判断和迁移应用都达到本次任务标准。'),
  envelope('learner-feedback-3', 'agent-forge', 'text', '做得好。下一次只换运算规则，不换集合，看看原来的封闭性判断是否仍然成立。这样能检验你是否真正掌握了方法。'),
  envelope('learner-feedback-4', 'agent-nova', 'approval', '安排向量空间间隔复习', {
    approval: {
      id: 'learner-calendar', agentId: 'agent-nova', kind: 'calendar_create', summary: '安排向量空间间隔复习', status: 'APPROVED',
      payload: { action: 'calendar.create', args: { title: '向量空间间隔复习', at: '2026-09-07T19:30:00+08:00', endAt: '2026-09-07T20:00:00+08:00', kind: 'personal' } },
      requestedAt: NOW, requestedBy: ME_ID, scope: { risk: 'calendar_create' },
    },
  }, { approvalId: 'learner-calendar', runId: 'learner-calendar', agentId: 'agent-nova' }),
  envelope('learner-feedback-4-summary', 'agent-nova', 'text', '间隔复习已经安排在下周，只保留一道改变运算规则的判断题。'),
  envelope('learner-feedback-5', 'teacher-lin', 'text', '我看到了你的提交和 Trace 的评价。你的风险已经解除；下周的间隔复习只需要完成一题，并解释运算规则改变后哪些条件失效。'),
]

const learnerCapabilityMessages = capabilityMessages(
  'learner',
  'learner',
  learnerCanvases[0]!.id,
  learnerDeck.detail.id,
  learnerConversations.room,
)

const learnerObjectives = objectives(learnerProjectId)
const learnerActivities = activities(learnerProjectId)
const learnerMissions: LearningMission[] = [{
  id: 'learner-mission', projectId: learnerProjectId, courseId: learnerCourseId, learnerId: ME_ID,
  conversationId: learnerConversations.room, triggerClientMsgNo: 'learner-room-1', goal: '完成概念图与多项式空间迁移题', successCriteria: '能独立解释每一步判断，并提交可核验的 Canvas 证据', kind: 'PROJECT', coordinatorAgentId: 'agent-nova', coordinatorName: 'Nova', status: 'COMPLETED',
  steps: [
    { id: 'learner-step-1', kind: 'LEARN', description: '绘制子空间判断路径', successCriteria: '判断步骤完整', knowledgeUnitId: learnerObjectives[0]!.id, status: 'COMPLETED', position: 0, outcome: '概念图已完成' },
    { id: 'learner-step-2', kind: 'PRACTICE', description: '用反例解释基与维数', successCriteria: '能识别线性相关的冗余向量', knowledgeUnitId: learnerObjectives[1]!.id, status: 'COMPLETED', position: 1, outcome: '反例通过核验' },
    { id: 'learner-step-3', kind: 'CHECK', description: '完成多项式空间迁移题', successCriteria: '证明完整并给出一组基', knowledgeUnitId: learnerObjectives[2]!.id, status: 'COMPLETED', position: 2, outcome: '掌握等级 3.7' },
  ],
  createdAt: NOW,
  updatedAt: NOW,
}]
const learnerEvidence: LearningEvidence[] = [
  { id: 'learner-evidence-1', activity_id: learnerActivities[0]!.id, mission_step_id: 'learner-step-2', assistance: 'HINT', status: 'ACCEPTED', evidence: { summary: '概念图、反例与解释' }, created_at: NOW, evaluation_id: 'learner-evaluation-1', demonstrated_level: 3.4, confidence: 0.9, rubric_results: [{ criterion: '概念准确', met: true }], feedback: '能用反例解释线性相关，但还需强化迁移。', evaluation_status: 'ACCEPTED', learner_id: ME_ID },
  { id: 'learner-evidence-2', activity_id: learnerActivities[1]!.id, mission_step_id: 'learner-step-3', assistance: 'NONE', status: 'ACCEPTED', evidence: { summary: '多项式空间完整证明' }, created_at: NOW, evaluation_id: 'learner-evaluation-2', demonstrated_level: 3.7, confidence: 0.93, rubric_results: [{ criterion: '方法迁移', met: true }, { criterion: '论证完整', met: true }], feedback: '方法已经稳定，可进入间隔复习。', evaluation_status: 'ACCEPTED', learner_id: ME_ID },
]

const learnerFixture: CourseFixture = {
  id: 'learner-course',
  role: 'learner',
  workspace: { id: learnerProjectId, companyId: COMPANY_ID, kind: 'INSTITUTIONAL_COURSE', planId: null, name: '向量空间研习 · 共学班', description: '在多智能助教和同伴协作中完成线性代数项目', color: '#7654b3', status: 'ACTIVE', createdBy: 'teacher-lin', isDefault: false, createdAt: NOW, updatedAt: NOW, archivedAt: null, lastVisitedAt: NOW, sourceCount: learnerSources.length, conversationCount: 2, documentCount: 3, calendarEventCount: 2, canvasCount: learnerCanvases.length, canManage: false },
  space: { companyId: COMPANY_ID, projectId: learnerProjectId, projectKind: 'INSTITUTIONAL_COURSE', courseId: learnerCourseId, title: '向量空间研习 · 共学班', description: '你在同一工作区与老师、同学和六位智能助教完成向量空间项目。', color: '#7654b3', status: 'ACTIVE', perspective: 'learner', canManage: false, canEditContent: false, canUpdateCourse: false, canInviteMembers: false, canRevokeInvitations: false, canUpdateMembers: false, canRemoveMembers: false, canSubmit: false, canReview: false, lifecycleAction: null, studyRoomId: learnerConversations.room, isDefault: false, lastVisitedAt: NOW },
  course: { id: learnerCourseId, companyId: COMPANY_ID, projectId: learnerProjectId, projectKind: 'INSTITUTIONAL_COURSE', name: '向量空间研习 · 共学班', description: '在多智能助教和同伴协作中完成线性代数项目', color: '#7654b3', status: 'ACTIVE', createdBy: 'teacher-lin', studyRoomId: learnerConversations.room, courseRole: 'learner', memberCount: 3, canManage: false, createdAt: NOW, updatedAt: NOW },
  members: [
    { id: 'teacher-lin', name: '林老师', email: 'lin@course.cn', role: 'teacher', joinedAt: NOW },
    { id: ME_ID, name: '你', email: 'learner@course.cn', role: 'learner', joinedAt: NOW },
    { id: 'peer-an', name: '安禾', email: 'anhe@course.cn', role: 'learner', joinedAt: NOW },
  ],
  participants: learnerParticipants,
  conversations: [
    { id: learnerConversations.room, kind: 'group', title: '向量空间项目学习室', subtitle: '林老师、安禾、Nova、Sage、Milo、Scout、Forge、Trace', topic: '在聊天和同一 Canvas 中完成概念图与迁移题', members: [ME_ID, 'teacher-lin', 'peer-an', 'agent-nova', 'agent-sage', 'agent-milo', 'agent-scout', 'agent-forge', 'agent-trace'], leaderId: 'agent-nova', readOnly: true, pinned: true, unread: 0, lastMessageId: 'learner-room-12', lastAt: '09:40', lastAtIso: NOW, preview: '安禾：我也按你的反例改了自己的版本', tag: 'team', messages: embedCapabilities(learnerRoomMessages, learnerCapabilityMessages, 0, 2) },
    { id: learnerConversations.feedback, kind: 'group', title: '提交、评价与后续复习', subtitle: '你、林老师、Forge、Trace', topic: '提交学习证据并接收反馈', members: [ME_ID, 'teacher-lin', 'agent-forge', 'agent-trace', 'agent-nova'], leaderId: 'agent-trace', readOnly: true, pinned: false, unread: 0, lastMessageId: 'learner-feedback-5', lastAt: '昨天', lastAtIso: '2026-09-02T20:00:00.000+08:00', preview: '林老师：你的风险已经解除', tag: 'team', messages: embedCapabilities(learnerFeedbackMessages, learnerCapabilityMessages, 1, 2) },
  ],
  canvases: learnerCanvases,
  canvasSummaries: learnerCanvases.map(summary),
  sources: learnerSources,
  documents: [
    { id: 'learner-document-task', title: '老师发布的项目任务', owner: '林老师', updatedAt: NOW, summary: '概念图、多项式空间迁移题与完成标准。', body: '先在 Canvas 中完成子空间判断、基与维数的关系图，再用这条路径判断次数不超过 2 的多项式空间。所有结论需要关联定义、反例或自己的作答。' },
    { id: 'learner-document-notes', title: '我的向量空间学习笔记', owner: '你', updatedAt: NOW, summary: '从封闭性到基与维数的个人解释。', body: '基不是任意能张成空间的向量组；它还必须线性无关。维数由一组基中向量的个数确定。判断新空间时，先确认集合与运算，再检查非空和线性组合封闭。' },
    { id: 'learner-document-feedback', title: 'Trace 的学习反馈', owner: 'Trace', updatedAt: NOW, summary: '任务达标，建议用改变运算规则的题目巩固迁移。', body: '概念准确性 3.8，推理完整性 3.6，迁移应用 3.7。当前方法已经稳定，下一步通过一道间隔复习题检查长期保持。' },
  ],
  calendarEvents: [
    calendarEvent('learner-event-task', 'teacher-lin', '向量空间项目截止', '提交概念图与多项式空间迁移题。', '2026-09-04T20:00:00+08:00', '2026-09-04T20:30:00+08:00', learnerConversations.room),
    calendarEvent('learner-event-review', ME_ID, '向量空间间隔复习', '完成一题改变运算规则的向量空间判断。', '2026-09-07T19:30:00+08:00', '2026-09-07T20:00:00+08:00', learnerConversations.feedback, 'agent-forge'),
  ],
  presentation: learnerDeck.detail,
  presentationVersions: learnerDeck.versions,
  presentationHtml: learnerDeck.html,
  objectives: learnerObjectives,
  activities: learnerActivities,
  missions: learnerMissions,
  evidence: learnerEvidence,
  reviews: [],
  overview: { perspective: 'learner', windowDays: 30, summary: { dueReviews: 1, verifiedObjectives: 3, activeMissions: 0, evidenceAttempts: 2 }, masteryDistribution: [{ level: 1, count: 0 }, { level: 2, count: 0 }, { level: 3, count: 2 }, { level: 4, count: 1 }], attemptTrend: [{ date: '2026-08-27', count: 1 }, { date: '2026-09-01', count: 1 }, { date: '2026-09-02', count: 2 }], assistanceDistribution: [{ assistance: 'NONE', count: 1 }, { assistance: 'HINT', count: 1 }, { assistance: 'GUIDED', count: 0 }], dueReviews: [{ knowledgeUnitId: learnerObjectives[2]!.id, title: '迁移到新向量空间', level: 3, status: 'DUE', nextReviewAt: '2026-09-07T19:30:00+08:00' }], missionProgress: [{ missionId: 'learner-mission', goal: '完成概念图与多项式空间迁移题', status: 'COMPLETED', completedSteps: 3, totalSteps: 3, updatedAt: NOW }] },
  dashboard: { projects: [{ projectId: learnerProjectId, courseId: learnerCourseId, projectKind: 'INSTITUTIONAL_COURSE', title: '向量空间研习 · 共学班', description: '在多智能助教和同伴协作中完成线性代数项目', status: 'ACTIVE', perspective: 'learner', canManage: false, canEditContent: false, canSubmit: false, canReview: false }], due: [{ projectId: learnerProjectId, knowledgeUnitId: learnerObjectives[2]!.id, title: '迁移到新向量空间', level: 3, status: 'DUE', nextReviewAt: '2026-09-07T19:30:00+08:00' }], states: learnerObjectives.map((objective, index) => ({ projectId: learnerProjectId, knowledgeUnitId: objective.id, title: objective.title, level: index === 2 ? 3 : 4, status: 'VERIFIED', nextReviewAt: index === 2 ? '2026-09-07T19:30:00+08:00' : null, reviewIntervalDays: index === 2 ? 5 : 14 })), pendingReviews: 0 },
  learners: [],
  journey: [
    { title: '收到老师发布的任务', description: '学习目标、项目要求、课程资料和截止时间已经进入学习室。' },
    { title: '在学习室完成项目', description: 'Nova 拆解计划，Sage、Milo、Scout、Forge、Trace 在聊天和同一 Canvas 中指导学习，最后形成证据、评价、反馈与后续复习。' },
  ],
  agentActivity: { id: 'learner-agent-status', runId: 'learner-review-status', agentId: 'agent-forge', agentName: 'Forge', runStatus: 'running', kind: 'spaced_review', level: 'info', title: '正在准备下一次间隔复习', createdAt: NOW },
}

export const COURSES: CourseFixture[] = [teacherFixture, learnerFixture]

export function courseByProjectId(projectId: string): CourseFixture {
  const course = COURSES.find((item) => item.workspace.id === projectId)
  if (!course) throw new Error('课程不可用')
  return course
}
