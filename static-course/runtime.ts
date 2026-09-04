import type { ThreadAssistantMessagePart, ThreadMessage } from '@assistant-ui/react'
import { ws } from '@/api/core/realtime'
import { agentsApi } from '@/features/agents/api'
import { useParticipants } from '@/features/agents/state'
import { useCanvas } from '@/features/canvas/state'
import { useCalendar } from '@/features/calendar/state'
import { messagesApi } from '@/features/chat/api'
import { convertEnvelope, projectMessageGroups } from '@/features/chat/runtime/converter'
import { getLingxiMessageMetadata, resolveMessagePresentation } from '@/features/chat/runtime/model'
import { applyAssistantStreamChunks } from '@/features/chat/runtime/stream'
import { useChatThreadStore } from '@/features/chat/runtime/store'
import { useConversations } from '@/features/conversations/store'
import { useDocuments } from '@/features/documents/state'
import { knowledgeApi } from '@/features/knowledge/api'
import { useKnowledgeSources } from '@/features/knowledge/state'
import { useWorkspace } from '@/features/knowledge/workspace'
import { learningApi } from '@/features/learning/api'
import { presentationsApi, usePresentations } from '@/features/presentations'
import type { ImEnvelope } from '@/lib/im/wukong'
import { setWorkspaceSession } from '@/lib/workspaceSession'
import { useApp } from '@/stores/app'
import { useAuth } from '@/stores/auth'
import { useSurface } from '@/stores/surface'
import type { ReadonlyJSONValue } from 'assistant-stream/utils'
import {
  COMPANY_ID,
  COURSES,
  ME_ID,
  type CourseConversation,
  type CourseFixture,
  type HostMessage,
  courseByProjectId,
} from './courseData'

let activeCourse = COURSES[1]!

function envelopeFor(
  course: CourseFixture,
  conversation: CourseConversation,
  index: number,
): ImEnvelope {
  const message = conversation.messages[index]!
  const payload = message.type === 'envelope'
    ? message.payload
    : {
        version: 1 as const,
        kind: 'text' as const,
        clientMsgNo: message.id,
        body: message.body,
        refs: { runId: message.runId, agentId: message.senderId },
      }
  return {
    messageId: `${course.id}-${conversation.id}-${message.id}`,
    messageSeq: index + 1,
    clientMsgNo: payload.clientMsgNo,
    channelId: conversation.id,
    channelType: 2,
    fromUid: message.senderId,
    timestamp: new Date(course.workspace.updatedAt).getTime() - (conversation.messages.length - index) * 60_000,
    payload,
  }
}

function hostToolParts(message: HostMessage): ThreadAssistantMessagePart[] {
  let parts: ThreadAssistantMessagePart[] = []
  message.calls.forEach((call, index) => {
    const toolCallId = `host:${message.id}:${index}`
    const result = JSON.parse(JSON.stringify(call.result)) as ReadonlyJSONValue
    parts = applyAssistantStreamChunks(parts, [
      { type: 'part-start', path: [index], part: { type: 'tool-call', toolCallId, toolName: call.name } },
      { type: 'text-delta', path: [index], textDelta: JSON.stringify(call.args) },
      { type: 'tool-call-args-text-finish', path: [index] },
      { type: 'result', path: [index], result, isError: call.isError ?? false },
      { type: 'part-finish', path: [index] },
    ])
  })
  return parts
}

function compileConversation(course: CourseFixture, conversation: CourseConversation): ThreadMessage[] {
  const messages = conversation.messages.map((blueprint, index) => {
    const converted = convertEnvelope(envelopeFor(course, conversation, index), {
      participants: course.participants,
      meId: ME_ID,
    })
    if (blueprint.type === 'host') {
      if (converted.role !== 'assistant') throw new Error('智能助教消息格式无效')
      const content: ThreadAssistantMessagePart[] = [
        { type: 'text', text: blueprint.body },
        ...hostToolParts(blueprint),
      ]
      return {
        ...converted,
        content,
        metadata: {
          ...converted.metadata,
          custom: {
            ...getLingxiMessageMetadata(converted),
            presentation: resolveMessagePresentation(content),
          },
        },
      }
    }
    if (blueprint.result === undefined || converted.role !== 'assistant') return converted
    const content = converted.content.map((part) => part.type === 'tool-call'
      ? { ...part, result: blueprint.result }
      : part)
    return {
      ...converted,
      content,
      metadata: {
        ...converted.metadata,
        custom: {
          ...getLingxiMessageMetadata(converted),
          presentation: resolveMessagePresentation(content),
        },
      },
    }
  })
  return projectMessageGroups(messages)
}

function courseForConversation(conversationId: string): CourseFixture {
  return COURSES.find((course) => course.conversations.some((conversation) => conversation.id === conversationId))
    ?? activeCourse
}

function courseForPresentation(id: string): CourseFixture {
  return COURSES.find((course) => course.presentation.id === id) ?? activeCourse
}

function installReadAdapters(): void {
  learningApi.listSpaces = async () => ({ data: [activeCourse.space], nextCursor: null })
  learningApi.getOverview = async (projectId) => courseByProjectId(projectId).overview
  learningApi.listKnowledgeUnits = async (projectId) => courseByProjectId(projectId).objectives
  learningApi.listActivities = async (projectId) => courseByProjectId(projectId).activities
  learningApi.listMissions = async (projectId) => courseByProjectId(projectId).missions
  learningApi.listEvidence = async (projectId) => courseByProjectId(projectId).evidence
  learningApi.listReviews = async (projectId) => courseByProjectId(projectId).reviews
  learningApi.getDashboard = async () => activeCourse.dashboard
  learningApi.getCourse = async (courseId) => COURSES.find((course) => course.course.id === courseId)?.course ?? activeCourse.course
  learningApi.listCourseMembers = async (courseId) => COURSES.find((course) => course.course.id === courseId)?.members ?? []
  learningApi.listProjectInvitations = async () => []
  learningApi.listLearners = async (projectId, input = {}) => {
    const query = input.search?.trim().toLocaleLowerCase('zh-CN') ?? ''
    const data = courseByProjectId(projectId).learners.filter((learner) => (
      (!input.attentionOnly || learner.attentionReasons.length > 0)
      && (!query || `${learner.displayName} ${learner.email}`.toLocaleLowerCase('zh-CN').includes(query))
    ))
    return { data, nextCursor: null }
  }
  learningApi.getLearner = async (projectId, learnerId) => {
    const learner = courseByProjectId(projectId).learners.find((item) => item.learnerId === learnerId)
    if (!learner) throw new Error('学习者不可用')
    return {
      learner: { learnerId, displayName: learner.displayName, email: learner.email, joinedAt: activeCourse.workspace.createdAt },
      summary: { averageLevel: learner.averageLevel, verifiedObjectives: learner.verifiedObjectives, dueReviews: learner.dueReviews, attemptCount: learner.attemptCount, activeMissions: 0 },
      masteryDistribution: [{ level: 3, count: 2 }, { level: 4, count: 1 }],
      states: activeCourse.objectives.map((objective, index) => ({ knowledgeUnitId: objective.id, title: objective.title, level: index === 0 ? 4 : 3, status: 'VERIFIED', nextReviewAt: index === 2 ? '2026-09-07T19:30:00+08:00' : null, reviewIntervalDays: 7, lastEvidenceAt: activeCourse.workspace.updatedAt })),
      missions: [],
      attempts: [],
    }
  }

  knowledgeApi.listProjects = async () => COURSES.map(({ workspace }) => workspace)
  knowledgeApi.openProject = async () => ({ ok: true })
  knowledgeApi.listProjectSources = async (projectId) => courseByProjectId(projectId).sources
  knowledgeApi.listCourseReviewSources = async (projectId) => courseByProjectId(projectId).sources
  knowledgeApi.getProjectSource = async (projectId, sourceId) => {
    const source = courseByProjectId(projectId).sources.find((item) => item.id === sourceId)
    if (!source) throw new Error('资料不可用')
    return source
  }
  knowledgeApi.getCourseReviewSource = knowledgeApi.getProjectSource
  knowledgeApi.listSources = async (conversationId) => courseForConversation(conversationId).sources
  knowledgeApi.getSource = async (conversationId, sourceId) => {
    const source = courseForConversation(conversationId).sources.find((item) => item.id === sourceId)
    if (!source) throw new Error('资料不可用')
    return source
  }
  knowledgeApi.getConversationSources = async (conversationId) => ({
    conversationId,
    sources: courseForConversation(conversationId).sources.map((source) => ({
      sourceId: source.id,
      title: source.title,
      status: source.status,
      enabled: true,
    })),
  })
  knowledgeApi.updateConversationSources = async (_conversationId, excludedSourceIds) => ({ ok: true, excludedSourceIds })

  presentationsApi.getResource = async (id) => {
    const course = courseForPresentation(id)
    return { presentation: course.presentation, versions: course.presentationVersions }
  }
  presentationsApi.getVersionContent = async (id) => new Blob([courseForPresentation(id).presentationHtml], { type: 'text/html' })
  presentationsApi.getVersionDownload = presentationsApi.getVersionContent

  agentsApi.getParticipants = async () => Object.values(activeCourse.participants).map((participant) => ({
    id: participant.id,
    kind: participant.kind,
    name: participant.name,
    role: participant.role ?? null,
    initial: participant.initial,
    avatarBg: participant.avatarBg,
    avatarUrl: participant.avatarUrl ?? null,
    status: participant.status,
    bio: participant.bio ?? null,
    tools: participant.tools ?? null,
    capabilities: participant.capabilities ?? null,
  }))
  agentsApi.getCoworkerActivity = async (conversationId) => [courseForConversation(conversationId).agentActivity]
  messagesApi.markRead = async (conversationId) => ({
    ok: true,
    latestSeq: courseForConversation(conversationId).conversations.find((item) => item.id === conversationId)?.messages.length ?? 0,
  })
  ws.connect = async () => undefined
  ws.reconnect = async () => undefined
}

export function applyCourse(course: CourseFixture, destination?: 'learning' | 'conversations'): void {
  activeCourse = course
  setWorkspaceSession({ companyId: COMPANY_ID, projectId: course.workspace.id })
  useSurface.setState({ surface: null })
  useParticipants.setState({ byId: course.participants, loaded: true })
  useConversations.setState({
    list: course.conversations.map(({ messages: _messages, ...conversation }) => ({ ...conversation, readOnly: false })),
    projectId: course.workspace.id,
    loaded: true,
    loading: false,
    error: null,
    load: async () => undefined,
    reload: async () => undefined,
  })
  useChatThreadStore.setState({
    conversations: Object.fromEntries(course.conversations.map((conversation) => [conversation.id, {
      messages: compileConversation(course, conversation),
      typingAgentIds: [],
      activeRuns: {},
      loaded: true,
      isLoading: false,
      isLoadingOlder: false,
      hasMoreOlder: false,
      error: null,
    }])),
  })
  const previews = Object.fromEntries(course.canvases.map((canvas) => [canvas.id, canvas]))
  useCanvas.setState({
    snapshot: course.canvases[0] ?? null,
    previews,
    workspaces: course.canvasSummaries,
    activeCanvasId: course.canvases[0]?.id ?? null,
    eventClocks: {},
    activityByCanvas: {},
    liveCards: {},
    loading: false,
    error: null,
    selectedFrameId: null,
    load: async (canvasId) => {
      const canvas = activeCourse.canvases.find((item) => item.id === canvasId) ?? activeCourse.canvases[0]
      if (canvas) useCanvas.setState({ snapshot: canvas, activeCanvasId: canvas.id, selectedFrameId: null })
    },
    loadPreview: async () => undefined,
    loadWorkspaces: async () => undefined,
    ensureForConversation: async (conversationId) => activeCourse.canvases.find((item) => item.conversationId === conversationId) ?? activeCourse.canvases[0]!,
    setStatus: async () => undefined,
    stopAgent: async () => undefined,
    stopWorkspace: async () => undefined,
  })
  useKnowledgeSources.setState({
    list: course.sources,
    loading: false,
    error: null,
    selectedSource: null,
    detailLoading: false,
    conversationSelection: null,
  })
  useCalendar.setState({
    events: course.calendarEvents,
    loaded: true,
    loading: false,
    loadingEventId: null,
    error: null,
    load: async () => undefined,
    reload: async () => undefined,
    loadEvent: async (id) => {
      const event = activeCourse.calendarEvents.find((item) => item.id === id)
      if (!event) throw new Error('日程不可用')
      return event
    },
  })
  useDocuments.setState({
    list: course.documents.map((document) => ({
      id: document.id,
      title: document.title,
      createdBy: document.owner,
      conversationId: course.conversations[0]?.id ?? null,
      createdAt: course.workspace.createdAt,
      updatedAt: document.updatedAt,
    })),
    loaded: true,
    selectedId: null,
    load: async () => undefined,
    reload: async () => undefined,
  })
  usePresentations.setState({ entries: {} })
  useWorkspace.setState({
    companyId: COMPANY_ID,
    list: [course.workspace],
    selectedId: course.workspace.id,
    loaded: true,
    loading: false,
    error: null,
    load: async () => undefined,
    select: async (projectId) => applyCourse(courseByProjectId(projectId)),
  })
  useApp.setState({
    view: destination ?? useApp.getState().view,
    selectedConversationId: course.conversations[0]?.id ?? null,
  })
  window.dispatchEvent(new CustomEvent('course:changed', { detail: course.workspace.id }))
  window.dispatchEvent(new Event('lingxiloop:learning-spaces-updated'))
}

export function activeCourseFixture(): CourseFixture {
  return activeCourse
}

export function initializeCourseRuntime(): CourseFixture {
  installReadAdapters()
  localStorage.setItem('lingxiloop-theme', 'light')
  useAuth.setState({
    authenticated: true,
    user: { id: ME_ID, name: '你', email: 'you@course.cn', emailVerified: true, providers: ['lingxi'] },
    companies: [{ id: COMPANY_ID, name: '线性代数研习', slug: 'linear-algebra', role: 'owner', status: 'ACTIVE' }],
    activeCompanyId: COMPANY_ID,
    personalCompanyId: COMPANY_ID,
    ready: true,
    serverCapabilities: { invitationEmail: false },
  })
  const course = new URLSearchParams(window.location.search).get('course') === 'teacher' ? COURSES[0]! : COURSES[1]!
  applyCourse(course, 'conversations')
  return course
}
