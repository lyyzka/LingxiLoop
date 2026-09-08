export type MembershipStatus = 'ACTIVE' | 'SUSPENDED'

export type CompanyRole = 'TEACHER' | 'STUDENT'

export type ProjectRole = 'TEACHER' | 'STUDENT'

export const ACTIVE_MEMBERSHIP_STATUS: MembershipStatus = 'ACTIVE'

export const COMPANY_ROLES: readonly CompanyRole[] = ['TEACHER', 'STUDENT']
export const PROJECT_ROLES: readonly ProjectRole[] = ['TEACHER', 'STUDENT']

export type CompanyRoleWire = 'teacher' | 'student'
export type LearningRoleWire = 'teacher' | 'learner'

export function companyRoleFromWire(role: CompanyRoleWire): CompanyRole {
  return role.toUpperCase() as CompanyRole
}

export function companyRoleToWire(role: CompanyRole): CompanyRoleWire {
  return role.toLowerCase() as CompanyRoleWire
}

export function projectRoleFromLearningWire(role: LearningRoleWire): 'TEACHER' | 'STUDENT' {
  return role === 'teacher' ? 'TEACHER' : 'STUDENT'
}

export function projectRoleToLearningWire(role: ProjectRole): LearningRoleWire {
  return role === 'STUDENT' ? 'learner' : 'teacher'
}
