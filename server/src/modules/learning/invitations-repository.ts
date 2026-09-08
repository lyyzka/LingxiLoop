import type { Queryable } from '../../db/queryable.js'

export async function listProjectInvitations(db: Queryable, projectId: string, companyId: string) {
  const { rows } = await db.query(
    `SELECT invitation.token_hash AS id,invitation.email,
            'learner'::text AS role,
            invitation.note,
            invitation.max_uses AS "maxUses",invitation.use_count AS "useCount",
            invitation.created_at AS "createdAt",invitation.expires_at AS "expiresAt",
            invitation.revoked_at AS "revokedAt",invitation.last_accepted_at AS "lastAcceptedAt",
            invitation.last_accepted_by AS "lastAcceptedBy",invitation.invited_by AS "invitedBy",
            user_account.display_name AS "inviterName",
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'userId',recent.user_id,'name',recent.display_name,
              'role','learner'::text,
              'acceptedAt',recent.accepted_at
            ) ORDER BY recent.accepted_at DESC) FROM (
              SELECT acceptance.user_id,accepted_user.display_name,acceptance.accepted_at
                FROM project_invitation_acceptances acceptance
                LEFT JOIN users accepted_user ON accepted_user.id=acceptance.user_id
               WHERE acceptance.token_hash=invitation.token_hash ORDER BY acceptance.accepted_at DESC LIMIT 10
            ) recent),'[]'::jsonb) AS acceptances,
            CASE WHEN invitation.revoked_at IS NOT NULL THEN 'revoked'
                 WHEN invitation.expires_at<NOW() THEN 'expired'
                 WHEN invitation.use_count>=invitation.max_uses THEN 'consumed' ELSE 'active' END AS status
       FROM project_invitations invitation
       LEFT JOIN users user_account ON user_account.id=invitation.invited_by
      WHERE invitation.project_id=$1 AND invitation.company_id=$2 ORDER BY invitation.created_at DESC`,
    [projectId, companyId],
  )
  return rows
}

export async function insertProjectInvitation(db: Queryable, args: {
  tokenHash: string; projectId: string; companyId: string; userId: string; email: string | null
  note: string | null; maxUses: number; expiresAt: Date
}): Promise<boolean> {
  const target = await db.query(
    `SELECT 1 FROM projects
      WHERE id=$1 AND company_id=$2 AND kind IN ('TEACHING','INSTITUTIONAL_COURSE')
      FOR UPDATE`,
    [args.projectId, args.companyId],
  )
  if (!target.rows[0]) return false
  if (args.email) {
    await db.query(
      `UPDATE project_invitations SET revoked_at=NOW()
        WHERE project_id=$1 AND company_id=$2 AND email=$3
          AND revoked_at IS NULL AND expires_at>NOW() AND use_count<max_uses`,
      [args.projectId, args.companyId, args.email],
    )
  }
  await db.query(
    `INSERT INTO project_invitations
       (token_hash,project_id,company_id,invited_by,email,note,max_uses,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [args.tokenHash, args.projectId, args.companyId, args.userId, args.email,
      args.note, args.maxUses, args.expiresAt],
  )
  return true
}

export async function revokeProjectInvitation(
  db: Queryable,
  projectId: string,
  companyId: string,
  invitationId: string,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE project_invitations SET revoked_at=NOW()
      WHERE token_hash=$1 AND project_id=$2 AND company_id=$3 AND revoked_at IS NULL`,
    [invitationId, projectId, companyId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function projectInvitationPreview(db: Queryable, tokenHash: string) {
  const { rows } = await db.query<{
    course_id: string; company_id: string; email: string | null; note: string | null
    max_uses: number; use_count: number; expires_at: string; revoked_at: string | null
    course_name: string; project_id: string; project_status: string; room_id: string | null
    company_name: string; company_slug: string; company_status: string; inviter_name: string | null
  }>(
    `SELECT course.id AS course_id,invitation.company_id,invitation.email,invitation.note,
            invitation.max_uses,invitation.use_count,invitation.expires_at,invitation.revoked_at,
            project.name AS course_name,project.id AS project_id,project.status AS project_status,
            course.study_room_conversation_id AS room_id,company.name AS company_name,
            company.slug AS company_slug,company.status AS company_status,user_account.display_name AS inviter_name
       FROM project_invitations invitation
       JOIN projects project ON project.id=invitation.project_id AND project.company_id=invitation.company_id
       JOIN courses course ON course.project_id=project.id AND course.company_id=project.company_id
       JOIN companies company ON company.id=project.company_id
       LEFT JOIN users user_account ON user_account.id=invitation.invited_by
      WHERE invitation.token_hash=$1`,
    [tokenHash],
  )
  return rows[0] ?? null
}

export async function invitationViewer(db: Queryable, userId: string, courseId: string) {
  const { rows } = await db.query<{ email: string; role: string | null }>(
    `SELECT user_account.email,
            CASE WHEN course_member.role IS NULL THEN NULL
                 WHEN course_member.role = 'STUDENT' THEN 'learner' ELSE 'teacher' END AS role
       FROM users user_account
       LEFT JOIN courses course ON course.id=$2
       LEFT JOIN project_memberships course_member
         ON course_member.project_id=course.project_id AND course_member.company_id=course.company_id
        AND course_member.user_id=user_account.id AND course_member.status='ACTIVE'
      WHERE user_account.id=$1`,
    [userId, courseId],
  )
  return rows[0] ?? null
}

export async function courseMembershipRole(db: Queryable, courseId: string, userId: string): Promise<'teacher' | 'learner' | null> {
  const { rows } = await db.query<{ role: 'teacher' | 'learner' }>(
    `SELECT CASE WHEN membership.role = 'STUDENT' THEN 'learner' ELSE 'teacher' END AS role
       FROM project_memberships membership
       JOIN courses course ON course.project_id=membership.project_id AND course.company_id=membership.company_id
      WHERE course.id=$1 AND membership.user_id=$2 AND membership.status='ACTIVE'`,
    [courseId, userId],
  )
  return rows[0]?.role ?? null
}

export async function countActiveProjectStudents(db: Queryable, companyId: string, projectId: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM project_memberships
      WHERE company_id=$1 AND project_id=$2 AND role='STUDENT' AND status='ACTIVE'`,
    [companyId, projectId],
  )
  return Number(rows[0]?.count ?? 0)
}

export async function courseExists(db: Queryable, courseId: string, companyId: string): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM courses WHERE id=$1 AND company_id=$2`, [courseId, companyId])
  return Boolean(rows[0])
}

export async function courseRole(db: Queryable, courseId: string, companyId: string, userId: string) {
  const { rows } = await db.query<{ role: 'teacher' | 'learner' }>(
    `SELECT CASE WHEN membership.role = 'STUDENT' THEN 'learner' ELSE 'teacher' END AS role
       FROM project_memberships membership
       JOIN courses course ON course.project_id=membership.project_id AND course.company_id=membership.company_id
      WHERE course.id=$1 AND membership.company_id=$2 AND membership.user_id=$3 AND membership.status='ACTIVE'`,
    [courseId, companyId, userId],
  )
  return rows[0]?.role ?? null
}

export async function owningCourseRole(db: Queryable, courseId: string, userId: string) {
  const { rows } = await db.query<{ company_id: string; role: 'teacher'|'learner' }>(
    `SELECT member.company_id,
            CASE WHEN member.role = 'STUDENT' THEN 'learner' ELSE 'teacher' END AS role
       FROM project_memberships member
       JOIN courses course ON course.project_id=member.project_id AND course.company_id=member.company_id
       JOIN company_memberships company_member ON company_member.company_id=member.company_id
         AND company_member.user_id=member.user_id AND company_member.status='ACTIVE'
      WHERE course.id=$1 AND member.user_id=$2 AND member.status='ACTIVE'`,
    [courseId,userId],
  )
  return rows[0] ?? null
}

