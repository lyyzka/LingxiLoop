import { acceptEducationInvitation } from '../companies/admission.js'
import type { Queryable } from '../../db/queryable.js'
import { createPermissionService } from '../access/public.js'
import type { CreateProjectInvitationInput, LearningScope } from './contracts.js'
import { LearningApplicationError } from './errors.js'
import { insertProjectInvitation, invitationViewer, listProjectInvitations, projectInvitationPreview, revokeProjectInvitation } from './repository.js'

export interface LearningInvitationInfrastructure {
  transaction<T>(work: (db: Queryable) => Promise<T>): Promise<T>
  auditInTransaction(db: Queryable, event: {
    kind: string
    userId: string
    companyId: string
    detail: Record<string, unknown>
  }): Promise<void>
  generateInvitationToken(): string
  hashInvitationToken(token: string): string
  invitationUrl(token: string): string
  avatarForEmail(email: string): string
}

export class LearningInvitationApplication {
  constructor(
    private readonly db: Queryable,
    private readonly infrastructure: LearningInvitationInfrastructure,
  ) {}

  list(scope: LearningScope & { projectId: string }) {
    return listProjectInvitations(this.db, scope.projectId, scope.companyId)
  }

  async create(scope: LearningScope & { projectId: string }, input: CreateProjectInvitationInput) {
    const token = this.infrastructure.generateInvitationToken()
    const tokenHash = this.infrastructure.hashInvitationToken(token)
    const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000)
    const email = input.email?.toLowerCase() || null
    const note = input.note || null
    await this.infrastructure.transaction(async (db) => {
      await createPermissionService(db, { lockDependencies: true }).assertCan({
        actorUserId: scope.userId,
        action: 'project_invitation:create',
        companyId: scope.companyId,
        projectId: scope.projectId,
      })
      const created = await insertProjectInvitation(db, {
        tokenHash,
        projectId: scope.projectId,
        companyId: scope.companyId,
        userId: scope.userId,
        email,
        note,
        maxUses: input.maxUses,
        expiresAt,
      })
      if (!created) throw new LearningApplicationError('not_found', 'Teaching Project not found')
      await this.infrastructure.auditInTransaction(db, {
        kind: 'project_invitation_create',
        userId: scope.userId,
        companyId: scope.companyId,
        detail: {
          projectId: scope.projectId,
          email,
          maxUses: input.maxUses,
          expiresInDays: input.expiresInDays,
        },
      })
    })
    return {
      id: tokenHash,
      token,
      url: this.infrastructure.invitationUrl(token),
      email,
      role: 'learner' as const,
      note,
      maxUses: input.maxUses,
      useCount: 0,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'active',
    }
  }

  async revoke(scope: LearningScope & { projectId: string }, invitationId: string) {
    const revoked = await this.infrastructure.transaction(async (db) => {
      await createPermissionService(db, { lockDependencies: true }).assertCan({
        actorUserId: scope.userId,
        action: 'project_invitation:revoke',
        companyId: scope.companyId,
        projectId: scope.projectId,
      })
      const revoked = await revokeProjectInvitation(db, scope.projectId, scope.companyId, invitationId)
      if (revoked) {
        await this.infrastructure.auditInTransaction(db, {
          kind: 'project_invitation_revoke',
          userId: scope.userId,
          companyId: scope.companyId,
          detail: { projectId: scope.projectId, invitationId },
        })
      }
      return revoked
    })
    return { ok: true as const, revoked }
  }

  async preview(token: string, viewerId?: string) {
    const invitation = await projectInvitationPreview(
      this.db,
      this.infrastructure.hashInvitationToken(token),
    )
    if (!invitation) return { status: 'not_found', kind: 'project' as const }
    let status = invitation.revoked_at
      ? 'revoked'
      : new Date(invitation.expires_at).getTime() < Date.now()
        ? 'expired'
        : invitation.use_count >= invitation.max_uses
          ? 'consumed'
          : invitation.project_status !== 'ACTIVE'
              || (invitation.company_status !== 'ACTIVE' && invitation.company_status !== 'TRIAL')
            ? 'archived'
            : 'valid'
    if (viewerId) {
      const viewer = await invitationViewer(this.db, viewerId, invitation.course_id)
      if (viewer?.role) status = 'already_member'
      else if (invitation.email && viewer?.email.toLowerCase() !== invitation.email) {
        status = 'wrong_email'
      }
    }
    return {
      kind: 'project' as const,
      status,
      invitation: {
        role: 'learner' as const,
        email: invitation.email,
        note: invitation.note,
        expiresAt: new Date(invitation.expires_at).toISOString(),
        inviterName: invitation.inviter_name,
        company: {
          id: invitation.company_id,
          name: invitation.company_name,
          slug: invitation.company_slug,
        },
        course: {
          id: invitation.course_id,
          name: invitation.course_name,
          projectId: invitation.project_id,
          studyRoomId: invitation.room_id,
        },
      },
    }
  }

  async accept(userId: string, token: string) {
    return this.infrastructure.transaction(async (db) => {
      const result = await acceptEducationInvitation(db, userId, this.infrastructure.hashInvitationToken(token), 'project')
      if (!result.course) throw new LearningApplicationError('not_found', 'course not found')
      return { ...result, course: result.course }
    })
  }
}
