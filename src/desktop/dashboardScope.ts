import type { LearningSpace } from '@/features/learning/contracts'

export interface LearningSpaceScopes {
  courses: LearningSpace[]
  visible: LearningSpace[]
}

export function getLearningSpaceScopes(spaces: LearningSpace[]): LearningSpaceScopes {
  const visible = spaces.filter((space) => space.status !== 'ARCHIVED' && space.status !== 'DELETED')
  return { courses: visible, visible }
}
