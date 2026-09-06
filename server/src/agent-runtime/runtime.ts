import {
  createLingxiLoopControl,
  createLingxiLoopWorker,
  type LingxiLoopControlOptions,
  type LingxiLoopWorkerOptions,
} from 'lingxios/lingxiloop'
import { doctor, type ModelCallObservation } from 'lingxios'
import { execFileSync } from 'node:child_process'
import { pool } from '../db/pool.js'
import { env } from '../env.js'
import { recordLlmCall } from '../llm-ledger.js'
import { lingxiLoopServices } from './services.js'

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  const value = raw ? Number(raw) : fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function modelRate(name: string): number {
  const raw = process.env[name]?.trim()
  if (!raw && env.NODE_ENV === 'production') throw new Error(`${name} is required in production`)
  const value = raw ? Number(raw) : 0
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`)
  return value
}

function kernelOptions() {
  const homesRoot = process.env.AGENT_OS_HOMES_ROOT?.trim() || '.agent-os/homes'
  if (env.NODE_ENV === 'production' && process.env.LINGXIOS_CONTAINER_ISOLATED !== 'true') {
    throw new Error('production LingxiOS workers require LINGXIOS_CONTAINER_ISOLATED=true and container resource isolation')
  }
  return {
    kernel: { homesRoot, pythonCommand: process.env.AGENT_OS_PYTHON?.trim() || (process.platform === 'win32' ? 'python' : 'python3'),
      ...(env.NODE_ENV === 'production' ? { isolation: 'bubblewrap' as const } : {}) },
  }
}

const common = () => ({ database: pool, services: lingxiLoopServices, ...kernelOptions() })

let control: ReturnType<typeof createLingxiLoopControl> | undefined

/** Web/API ownership: ingress, reads, cancellation and approval continuation only. */
export function lingxiOSControl() {
  control ??= createLingxiLoopControl(common() satisfies LingxiLoopControlOptions)
  return control
}

async function recordModelCall(observation: ModelCallObservation): Promise<void> {
  const usage = observation.usage?.available ? observation.usage : undefined
  const record = {
    context: {
      purpose: `lingxios.${observation.purpose}`,
      companyId: observation.tenantId,
      agentId: observation.agentId,
      runId: observation.workId,
      conversationId: observation.sessionId,
      source: 'agent-os' as const,
      extras: { callId: observation.callId, ...(observation.threadId ? { threadId: observation.threadId } : {}),
        ...(observation.principalId ? { principalId: observation.principalId } : {}) },
    },
    model: observation.model,
    ...(usage ? { usage: {
      prompt_tokens: usage.inputTokens,
      completion_tokens: usage.outputTokens,
    } } : {}),
    costUsd: usage ? (usage.inputTokens * modelRate('AGENT_OS_INPUT_COST_MICROS_PER_MILLION')
      + usage.outputTokens * modelRate('AGENT_OS_OUTPUT_COST_MICROS_PER_MILLION')) / 1_000_000_000_000 : 0,
    latencyMs: observation.latencyMs,
    status: observation.status,
    ...(observation.error ? { error: observation.error } : {}),
    measured: observation.usage?.available === true,
  }
  let failure: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await recordLlmCall(record, pool, `lingxios-${observation.callId}`); return }
    catch (error) { failure = error }
  }
  throw failure
}

let worker: Awaited<ReturnType<typeof createLingxiLoopWorker>> | undefined

/** Worker ownership: the sole in-process agent runner; PostgreSQL leases fence replicas. */
export async function startLingxiOSWorker() {
  if (worker) throw new Error('LingxiOS worker already started in this process')
  const options = {
    ...common(),
    model: { id: env.OPENAI_MODEL, apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL,
      reasoningEffort: 'high' as const },
    worker: { id: `lingxiloop-${env.INSTANCE_ID}`, concurrency: positiveInteger('AGENT_OS_MAX_CONCURRENT_RUNS', 2) },
    modelBudget: {
      maxModelCalls: positiveInteger('AGENT_OS_MAX_MODEL_CALLS', 12),
      maxTokens: positiveInteger('AGENT_OS_MAX_MODEL_TOKENS', 1_000_000),
      maxCostMicros: positiveInteger('AGENT_OS_MAX_MODEL_COST_MICROS', 10_000_000),
      wallClockMs: positiveInteger('AGENT_OS_MAX_WORK_MS', 30 * 60_000),
      inputCostMicrosPerMillion: modelRate('AGENT_OS_INPUT_COST_MICROS_PER_MILLION'),
      outputCostMicrosPerMillion: modelRate('AGENT_OS_OUTPUT_COST_MICROS_PER_MILLION'),
    },
    onModelCall: recordModelCall,
  } satisfies LingxiLoopWorkerOptions
  if (env.NODE_ENV === 'production') execFileSync('bwrap', [
    '--die-with-parent', '--unshare-all', '--new-session', '--ro-bind', '/', '/',
    '--proc', '/proc', '--dev', '/dev', '--', '/usr/bin/true',
  ], { stdio: 'ignore', timeout: 10_000 })
  const readiness = await doctor({ database: pool, pythonCommand: options.kernel.pythonCommand,
    env: { ...process.env, AGENT_OS_MODEL_API_KEY: env.OPENAI_API_KEY } })
  if (!readiness.ready) throw new Error(`LingxiOS worker readiness failed: ${readiness.checks.filter(check => check.status !== 'passed').map(check => check.name).join(', ')}`)
  const app = await createLingxiLoopWorker(options)
  await app.start()
  worker = app
  return { stop: async () => { await app.stop(); if (worker === app) worker = undefined } }
}
