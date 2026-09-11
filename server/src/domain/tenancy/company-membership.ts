import type { CompanyRole, MembershipStatus } from '../access/public.js'

export interface CompanyMembership {
  id: string
  companyId: string
  userId: string
  role: CompanyRole
  isAdmin: boolean
  periodId: string
  endedAt: string | null
  status: MembershipStatus
  createdAt: string
  updatedAt: string
}

