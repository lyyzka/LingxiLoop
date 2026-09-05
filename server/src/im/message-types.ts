export type LingxiMessageKind =
  | 'text'
  | 'attachment'
  | 'system'
  | 'tool_activity'
  | 'approval'
  | 'handoff'
  | 'poll'
  | 'questionnaire'
  | 'artifact'
  | 'canvas'
  | 'learning_mission'

export interface LingxiMessageV1 {
  version: 1
  kind: LingxiMessageKind
  clientMsgNo: string
  body?: string
  replyToClientMsgNo?: string
  refs?: Record<string, string | string[]>
  data?: Record<string, unknown>
}
