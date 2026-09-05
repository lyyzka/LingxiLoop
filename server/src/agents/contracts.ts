/** Product authorization/context inputs, independent of any runtime protocol. */
export type AgentExecutionRole = 'coordinator' | 'specialist' | 'verifier' | 'reporter'

export interface AgentActionContext {
  id: string
  companyId: string
  authorizationUserId?: string
  agentId: string
  channelId: string
  threadRootClientMsgNo?: string
  triggerClientMsgNo: string
  reason: 'message' | 'mention' | 'handoff' | 'routine' | 'resume' | 'canvas_worker' | 'canvas_summary'
}

export interface AgentAction {
  action: string
  args: Record<string, unknown>
}
