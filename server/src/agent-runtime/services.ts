import type { LingxiLoopServices } from 'lingxios/lingxiloop'
import * as calendar from '../modules/calendar/index.js'
import * as calendarApplication from '../modules/calendar/application.js'
import * as calendarSchemas from '../modules/calendar/contracts.js'
import * as canvas from '../modules/canvas/index.js'
import * as canvasOrchestration from '../canvas/orchestration.js'
import * as canvasAssignments from '../modules/canvas/assignments-application.js'
import * as canvasAssignmentRepository from '../modules/canvas/assignments-repository.js'
import * as canvasEvidence from '../modules/evidence/public.js'
import * as documents from '../modules/documents/public.js'
import * as documentRepository from '../modules/documents/repository.js'
import * as documentApplication from '../modules/documents/application.js'
import * as documentCollaboration from '../modules/documents/collaboration-application.js'
import * as documentStorage from '../storage.js'
import * as documentSchemas from '../modules/documents/contracts.js'
import * as learning from '../modules/learning/runtime.js'
import * as missionRepository from '../modules/learning/missions-repository.js'
import * as missionsApplication from '../modules/learning/missions-application.js'
import * as learningEvidence from '../modules/learning/evidence-repository.js'
import * as learningSchemas from '../modules/learning/contracts.js'
import * as evaluation from '../modules/learning/evaluation-application.js'
import * as projects from '../modules/projects/public.js'
import * as projection from '../modules/learning/project-lifecycle-projection.js'
import * as curriculum from '../modules/learning/curriculum-application.js'
import * as teacherManagement from '../modules/learning/teacher-management-repository.js'
import * as teacherApproval from '../modules/learning/teacher-approval-repository.js'
import * as teacherReporting from '../modules/learning/teacher-reporting-repository.js'
import * as identity from '../modules/identity/public.js'
import * as teacherRepository from '../modules/learning/teacher-runtime-repository.js'
import * as membership from '../modules/learning/membership-application.js'
import * as rooms from '../modules/learning/rooms-repository.js'
import * as effects from '../modules/learning/effects-repository.js'
import * as presentations from '../modules/presentations/public.js'
import * as email from '../modules/email/index.js'
import * as directory from '../modules/agents/index.js'
import * as conversations from '../modules/conversations/public.js'
import * as knowledge from '../modules/knowledge/public.js'
import * as messaging from '../im/public.js'
import * as handoffs from '../agents/coworker.js'
import * as access from '../modules/access/public.js'
import { permissionService } from '../modules/access/public.js'
import { pollApplication } from '../modules/polls/index.js'
import { advanceAgentReadReceipt } from '../im/read-receipts.js'
import { wukongClient } from '../im/wukong.js'
import { inc } from '../metrics.js'
import { CH_ASSISTANT_STREAM, CH_CALENDAR_EVENTS, CH_CANVAS, CH_DOC_UPDATE, CH_DOCS, publish } from '../redis.js'
import { storage } from '../storage.js'

export const lingxiLoopServices = {
  calendar: { ...calendar, ...calendarSchemas,
    writes: { ...calendarApplication, ...calendarSchemas, ...access, CH_CALENDAR_EVENTS, publish } },
  canvas: { ...canvas,
    orchestration: { ...canvasOrchestration, ...canvasAssignments, ...canvasAssignmentRepository, ...canvasEvidence,
      ...access, CH_CANVAS, publish } },
  documents: { ...documents,
    writes: { ...documentRepository, ...documentSchemas, ...access, CH_DOCS, publish,
      content: { ...documentApplication, ...documentCollaboration, ...documentStorage, CH_DOC_UPDATE, publish } } },
  teacher: { ...evaluation, ...projects, ...projection, ...curriculum, ...teacherManagement, ...teacherApproval,
    ...teacherReporting, ...identity, ...teacherRepository, ...learning, ...membership, ...rooms, ...effects, inc },
  learning: { ...learning, ...missionRepository, ...missionsApplication, ...learningEvidence, ...evaluation, ...learningSchemas, ...access, inc },
  presentations,
  email,
  directory,
  conversations,
  messaging,
  handoffs,
  pollApplication,
  knowledge,
  permissionService,
  storage,
  wukongClient,
  advanceAgentReadReceipt,
  retrieveKnowledge: knowledge.retrieveKnowledge,
  setCanvasStatus: canvas.setCanvasStatus,
  publishAssistantStream: (event) => publish(CH_ASSISTANT_STREAM, event as Parameters<typeof publish>[1]),
} satisfies LingxiLoopServices
