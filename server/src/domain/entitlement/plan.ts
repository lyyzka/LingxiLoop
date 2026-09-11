export type PlanStatus = 'ACTIVE' | 'ARCHIVED'

export interface Plan {
  id: string
  code: string
  name: string
  status: PlanStatus
}

export const EDUCATION_PLAN = {
  id: 'plan-education', code: 'EDUCATION', name: 'Education', status: 'ACTIVE',
} as const satisfies Plan

