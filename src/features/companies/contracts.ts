export interface CompanySummary {
  id: string
  name: string
  slug: string
  createdAt: string
  role: 'teacher' | 'student'; isAdmin: boolean
  status: import('@/auth/contracts').CompanyStatus
}

export type ApiInvitationStatus = 'active' | 'revoked' | 'expired' | 'consumed'

export interface ApiInvitation {
  id: string
  email: string | null
  role: 'teacher'
  isAdmin: boolean
  note: string | null
  maxUses: number
  useCount: number
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  lastAcceptedAt: string | null
  lastAcceptedBy: string | null
  invitedBy: string
  inviterName: string | null
  status: ApiInvitationStatus
}

export interface ApiInvitationWithToken {
  id: string
  token: string
  url: string
  email: string | null
  role: 'teacher'
  isAdmin: boolean
  note: string | null
  maxUses: number
  useCount: number
  createdAt: string
  expiresAt: string
  status: 'active'
  emailDelivery: { ok: true } | null
}

export type ApiInvitationPreviewStatus =
  | 'valid' | 'revoked' | 'expired' | 'consumed'
  | 'wrong_email' | 'already_member' | 'not_found'

export interface ApiInvitationPreview {
  status: ApiInvitationPreviewStatus
  invitation?: {
    role: 'teacher' | 'student'; isAdmin: boolean
    email: string | null
    note: string | null
    expiresAt: string
    createdAt: string
    inviterName: string | null
    company: { id: string; name: string; slug: string }
    multiUse: boolean
  }
}

export interface ApiInvitationAccept {
  ok: true
  alreadyMember: boolean
  company: { id: string; name: string; slug: string; role: 'teacher' | 'student'; isAdmin: boolean; status: import('@/auth/contracts').CompanyStatus }
}

export interface ApiCompanyProfile {
  id: string
  name: string
  slug: string
  description: string
  role: 'teacher' | 'student'
  isAdmin: boolean
  status: import('@/auth/contracts').CompanyStatus
  createdAt: string
}

export interface ApiCompanyMember {
  id: string
  name: string
  email: string
  role: 'teacher' | 'student'
  isAdmin: boolean
  joinedAt: string
  courses: Array<{ courseId: string; projectKind: import('@/types').ProjectKind; name: string; role: 'teacher' | 'learner' }>
}
