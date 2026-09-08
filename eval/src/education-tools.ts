import { z } from 'zod'

// Eval-owned public contract snapshots; keep product imports and effects out of Eval.
const id = z.string().trim().min(1).max(200)
const text = z.string().trim().min(1).max(10_000)
const empty = z.object({}).strict()
const ids = (max: number) => z.array(id).max(max).refine(values => new Set(values).size === values.length)
const tool = (description: string, schema: z.ZodObject) => ({ description, schema })
const choice = z.object({ value: text.max(120), label: text.max(500), description: text.max(500).optional(), disabled: z.boolean().optional() }).strict()
const question = z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/).optional(), prompt: text.max(500), description: text.max(1000).optional(),
  required: z.boolean().optional(), multiple: z.boolean().optional(), choices: z.array(choice).max(12).default([]),
  input: z.object({ label: text.max(120), placeholder: text.max(160).optional() }).strict().optional(),
}).strict().refine(item => (!!item.choices.length || !!item.input) && new Set(item.choices.map(c => c.value)).size === item.choices.length)
const step = z.object({ kind: z.enum(['LEARN', 'PRACTICE', 'CHECK', 'REFLECT']), description: text, successCriteria: text, knowledgeUnitId: id.optional() }).strict()
const member = z.object({ agentId: id, assignment: text.max(4000), dependsOnAgentIds: z.array(id).max(32).optional(),
  executionRole: z.enum(['specialist', 'verifier']).optional(), verifiesAgentId: id.optional() }).strict()
const objective = z.object({ title: text, successCriteria: text, targetLevel: z.number().int().min(1).max(4).optional(), prerequisiteIds: ids(100).optional() }).strict()

export const educationTools = {
  chat__ask: tool('Send an interactive questionnaire with unique questions and choices.', z.object({ title: text.max(160).default('Agent 提问'),
    items: z.array(question).min(1).max(8).refine(items => new Set(items.map((q, i) => q.name ?? `question_${i + 1}`)).size === items.length), submitLabel: text.max(80).optional() }).strict()),
  memory__note: tool('Persist an observation in authorized learner, course or agent-role memory. Learner memory requires an active human learnerId.', z.object({
    scope: z.enum(['learner', 'course', 'agent_role']).default('course'), learnerId: id.optional(), body: text.max(2000),
    kind: z.string().regex(/^[a-z_]{1,32}$/).default('observation'), validUntil: z.iso.datetime({ offset: true }).optional(),
  }).strict().refine(v => v.scope === 'learner' ? !!v.learnerId : !v.learnerId)),
  learning__current: tool('Read the original learner, project, current Mission and room context.', empty),
  learning__get_learner_state: tool('Read the original learner’s observed learning state in this project.', empty),
  learning__get_mission: tool('Read the active Mission or a visible Mission by ID.', z.object({ missionId: id.optional() }).strict()),
  learning__list_attempts: tool('Read persisted attempts for the original learner.', z.object({ activityId: id.optional(), missionStepId: id.optional() }).strict()
    .refine(v => !(v.activityId && v.missionStepId))),
  learning__start_mission: tool('Create a learner Mission and enqueue its coordinator child for planning. Uses the original learner’s committed message. A queued child is not a completed plan.', z.object({
    goal: text, successCriteria: text, missionKind: z.enum(['STUDY', 'RESEARCH', 'PROJECT']).optional(), sourceClientMsgNo: id.optional(), explicit: z.boolean().optional(),
  }).strict()),
  learning__add_steps: tool('Add concrete learning steps to the current Mission.', z.object({ missionId: id, steps: z.array(step).min(1).max(64) }).strict()),
  learning__finish_planning: tool('Finish Mission planning after steps have been persisted.', z.object({ missionId: id }).strict()),
  learning__update_step: tool('Update a Mission step; completion requires an outcome and persisted evidence.', z.object({ missionId: id, stepId: id,
    status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']), outcome: text.optional(), sourceEvidenceId: id.optional(), attemptId: id.optional(),
  }).strict().refine(v => v.status !== 'COMPLETED' || !!(v.outcome && (v.sourceEvidenceId || v.attemptId)))),
  learning__record_attempt: tool('Persist a learning attempt for exactly one activity or Mission step, citing committed message, document or Canvas evidence.', z.object({
    activityId: id.optional(), missionStepId: id.optional(), evidenceClientMsgNos: ids(20).default([]), documentIds: ids(20).default([]),
    canvasFrameIds: ids(20).default([]), assistance: z.enum(['NONE', 'HINT', 'GUIDED']).default('NONE'),
  }).strict().refine(v => !!v.activityId !== !!v.missionStepId)
    .refine(v => v.evidenceClientMsgNos.length + v.documentIds.length + v.canvasFrameIds.length > 0)),
  teacher__current: tool('Read current authorized course and teacher context.', empty),
  teacher__overview: tool('Read an aggregate course learning overview.', z.object({ windowDays: z.number().int().min(1).max(90).default(30) }).strict()),
  teacher__list_learners: tool('Read learners in the authorized course.', z.object({ attentionOnly: z.boolean().default(false) }).strict()),
  teacher__get_learner: tool('Read one learner’s observed state in the authorized course.', z.object({ learnerId: id }).strict()),
  teacher__list_objectives: tool('Read existing course objectives.', empty),
  teacher__list_activities: tool('Read existing course activities and publication state.', empty),
  teacher__draft_objectives: tool('Persist draft course learning objectives. Drafting does not publish them.', z.object({ objectives: z.array(objective).min(1).max(100) }).strict()),
  teacher__draft_activity: tool('Persist a draft course learning activity. Publishing is a separate action requiring teacher approval.', z.object({ title: text, instructions: text,
    type: z.enum(['LESSON', 'PRACTICE', 'ASSESSMENT', 'PROJECT', 'REVIEW']), evaluationMode: z.enum(['AGENT_FORMATIVE', 'TEACHER_REQUIRED']).default('TEACHER_REQUIRED'),
    targetLevel: z.number().int().min(1).max(4).default(2), rubric: z.array(z.json()).max(100).default([]), objectiveIds: ids(100).default([]), dueAt: z.string().datetime().optional(),
  })),
  teacher__publish_activity: tool('Request the teacher’s approval to publish a draft activity. A pending approval does not publish or assign it to students.', z.object({ activityId: id }).strict()),
  handoffs__list: tool('Read handoffs owned by the original human in this conversation.', empty),
  handoffs__create: tool('Delegate to another active member agent and wait for its durable child task. The target must be another agent in this conversation.', z.object({
    toAgentId: id, title: text.max(500), contextMessageIds: z.array(id).max(50).default([]), note: z.string().trim().max(4000).nullable().optional(),
  }).strict()),
  canvas__current: tool('Read the current Canvas, assignments and reports.', empty),
  canvas__available_agents: tool('List available Canvas agents and their specialties.', empty),
  canvas__start_workspace: tool('Start a Canvas workspace with specialist and verifier assignments, then resume to report their results.', z.object({
    title: text.max(200), goal: text.max(8000), members: z.array(member).min(1).max(32),
  }).strict()),
}
