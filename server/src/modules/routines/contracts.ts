import { z } from 'zod'
const id = z.string().trim().min(1).max(240)
export const routineInputSchema = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/).refine(value => !value.startsWith('teacher_'), 'teacher routines are managed by the teaching module'),
  title: z.string().trim().min(1).max(2_000), instructions: z.string().trim().min(1).max(20_000),
  schedule: z.union([z.object({ everyMinutes: z.number().int().min(5).max(525600) }).strict(),
    z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict()]),
  timezone: z.string().max(100).default('Asia/Shanghai').refine(value => {
    try { return !/^[+-]/.test(new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone) } catch { return false }
  }, 'timezone must be an IANA timezone'),
}).strict()
export const routineSchemas = { create: routineInputSchema, list: z.object({}).strict(),
  activate: z.object({ routineId: id }).strict(), pause: z.object({ routineId: id }).strict() }

export interface RoutineRow {
  id: string; company_id: string; agent_id: string; channel_id: string; created_by: string; project_id: string | null
  thread_id: string | null; kind: string; title: string; instructions: string; schedule: Record<string, unknown>; timezone: string
  status: 'active' | 'paused'; version: number; next_run_at: string | Date | null; pause_reason: string | null
}
export interface RoutineRunRow {
  routine_id: string; routine_version: number; work_id: string; company_id: string; agent_id: string
  channel_id: string; principal_id: string; thread_id: string | null
}
