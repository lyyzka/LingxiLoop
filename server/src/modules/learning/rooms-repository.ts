import { HttpError } from '../../http/errors.js'
import { addInstitutionalCourseMember, changeCourseMember } from './courses-repository.js'
import type { Queryable } from '../../db/queryable.js'
import type { CourseMemberChangeOutcome } from './types.js'

export async function setLearningCourseMembershipRecord(
  db: Queryable,
  args: { companyId: string; courseId: string; userId: string; role: 'teacher'|'learner'; enabled: boolean },
): Promise<CourseMemberChangeOutcome> {
  if (args.enabled) {
    if (args.role !== 'teacher') throw new HttpError(403, 'students must accept a course invitation')
    return await addInstitutionalCourseMember(db, { ...args, role: 'TEACHER' }) ? 'updated' : 'not_found'
  }
  return changeCourseMember(db, { ...args, role: null })
}

export async function upsertLearningCourseRoom(
  db: Queryable,
  args: {
    companyId: string; courseId: string; conversationId: string
    purpose: 'lab'|'discussion'; createdBy: string
  },
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO learning_course_rooms(course_id,company_id,conversation_id,purpose,created_by)
     SELECT course.id,course.company_id,conversation.id,$4,$5
       FROM courses course
       JOIN conversations conversation ON conversation.company_id=course.company_id
         AND conversation.project_id=course.project_id
      WHERE course.id=$2 AND course.company_id=$1 AND conversation.id=$3
        AND conversation.kind='group'
        AND NOT EXISTS(SELECT 1 FROM learning_course_teacher_rooms teacher_room
          WHERE teacher_room.company_id=$1 AND teacher_room.conversation_id=conversation.id)
     ON CONFLICT(conversation_id) DO UPDATE SET
       course_id=EXCLUDED.course_id,company_id=EXCLUDED.company_id,
       purpose=EXCLUDED.purpose,created_by=EXCLUDED.created_by`,
    [args.companyId,args.courseId,args.conversationId,args.purpose,args.createdBy],
  )
  return Boolean(result.rowCount)
}

export async function deleteLearningCourseRoom(
  db: Queryable,
  args: { companyId: string; courseId: string; conversationId: string },
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM learning_course_rooms
      WHERE company_id=$1 AND course_id=$2 AND conversation_id=$3`,
    [args.companyId,args.courseId,args.conversationId],
  )
  return Boolean(result.rowCount)
}
