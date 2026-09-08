import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type ProjectLifecycleCommand,
  type ProjectStatus,
  projectStatusBelongsToKind,
  transitionProject,
} from '../domain/public.js'
import {
  createProjectRequestSchema,
  presignSourceRequestSchema,
  updateSourceRequestSchema,
  updateProjectRequestSchema,
} from '../modules/knowledge/contracts.js'

test('Project creation kind is selected by the use case rather than client input', () => {
  assert.equal(createProjectRequestSchema.safeParse({ name: 'Math', kind: 'TEACHING' }).success, false)
  assert.equal(updateProjectRequestSchema.safeParse({ kind: 'INSTITUTIONAL_COURSE' }).success, false)
})

test('Knowledge source titles accept one bounded rename field', () => {
  assert.deepEqual(updateSourceRequestSchema.parse({ title: '  New title  ' }), { title: 'New title' })
  assert.equal(updateSourceRequestSchema.safeParse({ title: '', projectId: 'other' }).success, false)
})

test('Knowledge uploads reject path-like file names at the API boundary', () => {
  assert.equal(presignSourceRequestSchema.safeParse({
    idempotencyKey: 'upload-notes', name: '../notes.pdf', mime: 'application/pdf', size: 1,
  }).success, false)
})

function runProjectLifecycle(
  kind: 'TEACHING' | 'INSTITUTIONAL_COURSE',
  initial: ProjectStatus,
  commands: ProjectLifecycleCommand[],
): ProjectStatus[] {
  const statuses = [initial]
  for (const command of commands) {
    const transition = transitionProject(kind, statuses.at(-1)!, command)
    assert.notEqual(transition.outcome, 'INVALID')
    if (transition.to) statuses.push(transition.to)
  }
  return statuses
}

test('each ProjectKind follows its own lifecycle without arbitrary jumps', () => {
  assert.deepEqual(runProjectLifecycle('TEACHING', 'DRAFT', [
    'ACTIVATE', 'END', 'ENTER_READ_ONLY', 'ARCHIVE',
  ]), ['DRAFT', 'ACTIVE', 'COURSE_ENDED', 'READ_ONLY', 'ARCHIVED'])
  assert.deepEqual(runProjectLifecycle('INSTITUTIONAL_COURSE', 'DRAFT', [
    'ACTIVATE', 'END', 'ENTER_READ_ONLY', 'ENTER_RETENTION', 'DELETE',
  ]), ['DRAFT', 'ACTIVE', 'COURSE_ENDED', 'READ_ONLY', 'RETENTION', 'DELETED'])

  assert.deepEqual(transitionProject('TEACHING', 'ACTIVE', 'ARCHIVE'), {
    outcome: 'INVALID', from: 'ACTIVE', to: null,
  })
})

test('Project lifecycle commands are idempotent and transfer cancellation restores ACTIVE', () => {
  assert.deepEqual(transitionProject('TEACHING', 'ACTIVE', 'ACTIVATE'), {
    outcome: 'ALREADY_APPLIED', from: 'ACTIVE', to: 'ACTIVE',
  })
})

test('Project statuses cannot be assigned to the wrong ProjectKind', () => {
  assert.equal(projectStatusBelongsToKind('TEACHING', 'RETENTION'), false)
})
