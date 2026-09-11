import { generateInvitationToken, hashInvitationToken } from '../../http/invitation-token.js'
import { HttpError } from '../../http/errors.js'
import { insertInvitation, revokeActiveEmailInvitations } from '../companies/repository.js'
import { installStarterAgents } from '../companies/onboarding-repository.js'
import { createHash } from 'node:crypto'
import type { Queryable } from '../../db/queryable.js'
import { appendDomainEventInTransaction } from '../events/public.js'
import { applySystemCompanyLifecycleInTransaction } from '../companies/public.js'
import { applySystemProjectLifecycleInTransaction } from '../projects/public.js'
import type { CreateEducationCompanyInput } from './contracts.js'
import { expireNextDueEducationContract, insertEducationCore } from './repository.js'

export interface EducationInfrastructure {
  invitationBaseUrl: string
  transaction<T>(work: (db: Queryable) => Promise<T>): Promise<T>
  auditInTransaction(db: Queryable, input: { kind: string; userId?: string; companyId: string; detail: Record<string, unknown> }): Promise<void>
}

function identity(prefix: string, key: string): string {
  return `${prefix}-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`
}

export class EducationApplication {
  constructor(private readonly infrastructure: EducationInfrastructure) {}

  createCompany(creatorUserId: string, input: CreateEducationCompanyInput) {
    const companyId = identity('education', `${creatorUserId}:${input.idempotencyKey}`)
    const contractId = identity('contract', companyId)
    return this.infrastructure.transaction(async (db) => {
      const created = await insertEducationCore(db, { ...input, creatorUserId, companyId, contractId })
      if (!created) return { companyId, contractId, status: 'TRIAL' as const, invitation: null }
      await installStarterAgents(db, companyId)
      const invitation = await this.issueAdministratorInvitation(db, creatorUserId, companyId, input.initialAdminEmail)
      await appendDomainEventInTransaction(db, {
        companyId, aggregateType: 'COMPANY', aggregateId: companyId, idempotencyKey: `${input.idempotencyKey}:company`,
        actor: { type: 'SYSTEM' },
        event: { eventType: 'EDUCATION_COMPANY.CREATED', schemaVersion: 1, payload: { status: 'TRIAL', planId: input.planId } },
      })
      await this.infrastructure.auditInTransaction(db, { kind: 'education_company_create', userId: creatorUserId, companyId,
        detail: { contractId, planId: input.planId } })
      return { companyId, contractId, status: 'TRIAL' as const, invitation }
    })
  }

  inviteAdministrator(actorUserId: string, companyId: string, email: string) {
    return this.infrastructure.transaction(async (db) => {
      const company = await db.query(`SELECT 1 FROM companies WHERE id=$1 AND status IN ('ACTIVE','TRIAL') FOR UPDATE`, [companyId])
      if (!company.rows[0]) throw new HttpError(409, 'company is not accepting administrators')
      return this.issueAdministratorInvitation(db, actorUserId, companyId, email.toLowerCase())
    })
  }

  private async issueAdministratorInvitation(db: Queryable, actorUserId: string, companyId: string, email: string) {
    const token = generateInvitationToken()
    const expiresAt = new Date(Date.now()+7*86_400_000)
    await revokeActiveEmailInvitations(db, companyId, email)
    await insertInvitation(db, { tokenHash: hashInvitationToken(token), companyId, invitedBy: actorUserId, email,
      isAdmin: true, note: null, maxUses: 1, expiresAt })
    await this.infrastructure.auditInTransaction(db, { kind: 'platform_administrator_invite', userId: actorUserId, companyId, detail: { email } })
    return { url: `${this.infrastructure.invitationBaseUrl.replace(/\/+$/, '')}/invite/${encodeURIComponent(token)}`, expiresAt: expiresAt.toISOString() }
  }

  expireNextDueContract(now: Date): Promise<boolean> {
    return this.infrastructure.transaction(async (db) => {
      const expired = await expireNextDueEducationContract(db, now)
      if (!expired) return false
      const companyStatus = expired.previousCompanyStatus === 'TRIAL' || expired.previousCompanyStatus === 'ACTIVE'
        ? (await applySystemCompanyLifecycleInTransaction(db, {
            companyId: expired.companyId,
            type: 'EDUCATION',
            status: expired.previousCompanyStatus,
            command: 'ENTER_GRACE_PERIOD',
          })).status
        : expired.previousCompanyStatus
      const endedProjectIds: string[] = []
      for (const project of expired.projects) {
        const transition = await applySystemProjectLifecycleInTransaction(db, {
          companyId: expired.companyId,
          projectId: project.id,
          kind: project.kind,
          status: project.status,
          command: 'END',
        })
        if (transition.applied) endedProjectIds.push(project.id)
      }
      const expiryKey = `education-contract-expired:${expired.contractId}:${expired.endsAt.toISOString()}`
      await appendDomainEventInTransaction(db, {
        companyId: expired.companyId,
        aggregateType: 'EDUCATION_CONTRACT',
        aggregateId: expired.contractId,
        idempotencyKey: expiryKey,
        actor: { type: 'SYSTEM' },
        event: {
          eventType: 'EDUCATION_CONTRACT.EXPIRED',
          schemaVersion: 1,
          payload: { endsAt: expired.endsAt.toISOString(), companyStatus },
        },
      })
      if (companyStatus !== expired.previousCompanyStatus) {
        await appendDomainEventInTransaction(db, {
          companyId: expired.companyId,
          aggregateType: 'COMPANY',
          aggregateId: expired.companyId,
          idempotencyKey: `${expiryKey}:company`,
          actor: { type: 'SYSTEM' },
          event: {
            eventType: 'EDUCATION_COMPANY.ENTERED_GRACE_PERIOD',
            schemaVersion: 1,
            payload: {
              reason: 'EDUCATION_CONTRACT_EXPIRED',
              contractId: expired.contractId,
              previousStatus: expired.previousCompanyStatus,
            },
          },
        })
      }
      for (const projectId of endedProjectIds) {
        await appendDomainEventInTransaction(db, {
          companyId: expired.companyId,
          projectId,
          aggregateType: 'PROJECT',
          aggregateId: projectId,
          idempotencyKey: `${expiryKey}:project:${projectId}`,
          actor: { type: 'SYSTEM' },
          event: {
            eventType: 'PROJECT.COURSE_ENDED',
            schemaVersion: 1,
            payload: { reason: 'EDUCATION_CONTRACT_EXPIRED', contractId: expired.contractId },
          },
        })
      }
      await this.infrastructure.auditInTransaction(db, {
        kind: 'education_contract_expired',
        companyId: expired.companyId,
        detail: {
          contractId: expired.contractId,
          previousCompanyStatus: expired.previousCompanyStatus,
          companyStatus,
          endedProjectIds,
        },
      })
      return true
    })
  }
}
