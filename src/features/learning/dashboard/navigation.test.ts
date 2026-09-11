import assert from 'node:assert/strict'
import test from 'node:test'
import { getLearningDashboardMenu, isLearningDashboardSectionAvailable } from './navigation'

test('joined course menus are derived from the server perspective without a role switch', () => {
  assert.deepEqual(
    getLearningDashboardMenu({ perspective: 'learner' }).map((item) => item.label),
    ['概览', '日历', '资料'],
  )
  assert.deepEqual(
    getLearningDashboardMenu({ perspective: 'teacher' }).map((item) => item.label),
    ['总览', '日历', '资料', '课程设置'],
  )
  assert.equal(isLearningDashboardSectionAvailable('learners', { perspective: 'teacher' }), false)
  assert.equal(isLearningDashboardSectionAvailable('settings', { perspective: 'learner' }), false)
  assert.equal(isLearningDashboardSectionAvailable('settings', { perspective: 'teacher' }), true)
})
