import { useCustom } from '@refinedev/core'
import { ActivityIcon, ExternalLinkIcon, PlayIcon, RefreshCwIcon, ShieldCheckIcon } from 'lucide-react'
import { useState } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toastAction } from '@/lib/actionToast'
import { promptSensitiveAction } from '@/lib/confirmAction'
import { API_URL, adminFetch } from './api'
import { normalizeLingxiLitUrl } from './lingxilit-url'
import { PageHeading } from './pages'

interface EvalRun {
  id: string
  status: string
  score: number
  createdAt: string
  target: { commitSha?: string; model?: string }
  scoreDelta: number | null
  summary: { resources: { averageLatencyMs: number | null; totalCostUsd: number } }
}

interface EvalDashboard {
  summary: { totalRuns: number; passRate: number; averageScore: number; averageLatencyMs: number | null; totalCostUsd: number }
  runs: EvalRun[]
  failureClusters: Array<{ category: string; count: number; runCount: number }>
  jobs: Array<{ id: string; profile: string; status: string; commitSha: string; createdAt: string; error: string | null }>
  policies: Array<{ mode: 'monitor' | 'enforce'; baselineRunId: string | null }>
}

interface EvalDetail extends EvalRun {
  cases: Array<{
    id: string
    caseId: string
    scenarioKey: string
    sampleIndex: number
    status: string
    score: number
    failureReasons: string[]
    observation: {
      judgments?: Array<{ scorer: string; score: number; passed: boolean; model: string; rationale: string }>
      metadata?: { traceId?: string }
    }
  }>
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`

export function EvalPage() {
  const dashboard = useCustom<EvalDashboard>({
    url: `${API_URL}/control/platform/eval/dashboard?suiteKey=agent-runtime-live`, method: 'get',
    queryOptions: { refetchInterval: 30_000, refetchOnWindowFocus: false },
  })
  const [selectedRun, setSelectedRun] = useState('')
  const detail = useCustom<EvalDetail>({
    url: `${API_URL}/control/platform/eval/runs/${encodeURIComponent(selectedRun)}`, method: 'get',
    queryOptions: { enabled: Boolean(selectedRun) },
  })
  const data = dashboard.query.data?.data
  const activePolicy = data?.policies[0]
  const lingxiLitUrl = normalizeLingxiLitUrl(import.meta.env.VITE_LINGXILIT_URL)

  const trigger = async (profile: 'core' | 'full') => {
    const reason = await promptSensitiveAction({
      title: `运行 ${profile} Live Eval？`, description: '会调用正式 Candidate/Judge 模型并产生费用。',
      confirmLabel: '开始评测', inputLabel: '审计原因', inputRequired: true,
    })
    if (!reason) return
    await toastAction(adminFetch('/control/eval/jobs', { method: 'POST', body: JSON.stringify({ profile, reason }) }), {
      loading: '正在创建并派发 Eval…', success: 'Eval 已派发到 GitHub Actions',
    })
    await dashboard.query.refetch()
  }

  const updatePolicy = async () => {
    const mode = activePolicy?.mode === 'enforce' ? 'monitor' : 'enforce'
    const baselineRunId = mode === 'enforce' ? data?.runs.find((run) => run.status === 'pass')?.id : null
    if (mode === 'enforce' && !baselineRunId) throw new Error('没有可用的通过基线')
    const reason = await promptSensitiveAction({
      title: mode === 'enforce' ? '晋级为发布门禁？' : '退回监控模式？',
      description: mode === 'enforce' ? `将 ${baselineRunId} 设为当前基线。` : '发布将不再被 Live Eval 阻断。',
      confirmLabel: '更新门禁', inputLabel: '变更原因', inputRequired: true,
    })
    if (!reason) return
    await toastAction(adminFetch('/control/platform/eval/gate-policy', {
      method: 'PUT', body: JSON.stringify({ mode, baselineRunId, reason }),
    }), { loading: '正在更新门禁…', success: `已切换为 ${mode}` })
    await dashboard.query.refetch()
  }

  const runs = data?.runs ?? []
  const chart = [...runs].reverse().map((run) => ({ at: new Date(run.createdAt).toLocaleDateString(), score: run.score }))
  const selected = detail.query.data?.data
  const stability = selected ? Object.values(selected.cases.reduce<Record<string, { passed: number; total: number }>>((result, item) => {
    const current = result[item.scenarioKey] ?? { passed: 0, total: 0 }
    current.total += 1
    if (item.status === 'pass') current.passed += 1
    result[item.scenarioKey] = current
    return result
  }, {})) : []

  return <div className="space-y-5">
    <PageHeading title="Agent Eval" description="真实 Agent OS / IPython 执行、Autoevals 语义评分与 LingxiLit Trace。" actions={[
      <Button key="core" onClick={() => void trigger('core')}><PlayIcon />运行 Core</Button>,
      <Button key="full" variant="outline" onClick={() => void trigger('full')}>运行 Full</Button>,
      <Button key="refresh" variant="outline" onClick={() => void dashboard.query.refetch()}><RefreshCwIcon />刷新</Button>,
    ]} />

    <div className="grid gap-4 md:grid-cols-4">
      <Metric title="通过率" value={percent(data?.summary.passRate ?? 0)} />
      <Metric title="平均分" value={percent(data?.summary.averageScore ?? 0)} />
      <Metric title="平均延迟" value={data?.summary.averageLatencyMs == null ? '—' : `${Math.round(data.summary.averageLatencyMs)} ms`} />
      <Metric title="累计成本" value={`$${(data?.summary.totalCostUsd ?? 0).toFixed(4)}`} />
    </div>

    <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
      <Card><CardHeader><CardTitle className="text-base">得分趋势</CardTitle><CardDescription>按场景等权聚合，不因 Core 重复采样改变权重。</CardDescription></CardHeader><CardContent className="h-64">
        <ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><XAxis dataKey="at" /><YAxis domain={[0, 1]} /><Tooltip formatter={(value) => percent(Number(value))} /><Line type="monotone" dataKey="score" stroke="var(--color-primary)" strokeWidth={2} /></LineChart></ResponsiveContainer>
      </CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheckIcon className="size-4" />发布门禁</CardTitle><CardDescription>默认仅监控；晋级必须选择通过的同模型基线。</CardDescription></CardHeader><CardContent className="space-y-4">
        <Badge variant={activePolicy?.mode === 'enforce' ? 'destructive' : 'outline'}>{activePolicy?.mode ?? 'monitor'}</Badge>
        <p className="break-all text-xs text-muted-foreground">Baseline: {activePolicy?.baselineRunId ?? '尚未选择'}</p>
        <Button variant="outline" onClick={() => void updatePolicy()}>{activePolicy?.mode === 'enforce' ? '退回 monitor' : '晋级 enforce'}</Button>
      </CardContent></Card>
    </div>

    <Card><CardHeader><CardTitle className="text-base">运行记录</CardTitle><CardDescription>选择运行后查看 sample、Judge rationale 和 Trace。</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>时间</TableHead><TableHead>Commit</TableHead><TableHead>状态</TableHead><TableHead>分数</TableHead><TableHead>变化</TableHead><TableHead /></TableRow></TableHeader><TableBody>
      {runs.map((run) => <TableRow key={run.id}><TableCell>{new Date(run.createdAt).toLocaleString()}</TableCell><TableCell className="font-mono text-xs">{run.target.commitSha?.slice(0, 8) ?? '—'}</TableCell><TableCell><Badge variant={run.status === 'pass' ? 'secondary' : 'destructive'}>{run.status}</Badge></TableCell><TableCell>{percent(run.score)}</TableCell><TableCell>{run.scoreDelta == null ? '—' : `${run.scoreDelta >= 0 ? '+' : ''}${percent(run.scoreDelta)}`}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => setSelectedRun(run.id)}>详情</Button></TableCell></TableRow>)}
    </TableBody></Table></CardContent></Card>

    <div className="grid gap-4 xl:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">失败聚类</CardTitle></CardHeader><CardContent className="space-y-2">{(data?.failureClusters ?? []).map((item) => <div key={item.category} className="flex justify-between rounded-lg border p-3 text-sm"><span>{item.category}</span><Badge variant="outline">{item.count} / {item.runCount} runs</Badge></div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">任务队列</CardTitle></CardHeader><CardContent className="space-y-2">{(data?.jobs ?? []).slice(0, 10).map((job) => <div key={job.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm"><ActivityIcon className="size-4" /><span className="min-w-0 flex-1 truncate">{job.profile} · {job.commitSha.slice(0, 8)}</span><Badge variant={job.status === 'failed' ? 'destructive' : 'outline'}>{job.status}</Badge></div>)}</CardContent></Card>
    </div>

    {selected && <Card><CardHeader><CardTitle className="text-base">逐次结果 · {selected.id}</CardTitle><CardDescription>场景稳定率 {stability.map((item) => `${item.passed}/${item.total}`).join(' · ')}</CardDescription></CardHeader><CardContent className="space-y-3">{selected.cases.map((item) => {
      const traceId = item.observation.metadata?.traceId
      return <div key={item.id} className="rounded-xl border p-4"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{item.scenarioKey} · #{item.sampleIndex + 1}</strong><Badge variant={item.status === 'pass' ? 'secondary' : 'destructive'}>{item.status}</Badge><span className="text-sm">{percent(item.score)}</span>{traceId && lingxiLitUrl ? <a className="ms-auto inline-flex items-center gap-1 text-xs text-primary" href={`${lingxiLitUrl}?trace_id=${encodeURIComponent(traceId)}`} target="_blank" rel="noreferrer">{traceId}<ExternalLinkIcon className="size-3" /></a> : null}</div>{item.observation.judgments?.map((judgment) => <p key={judgment.scorer} className="mt-2 text-xs text-muted-foreground"><strong>{judgment.scorer} {percent(judgment.score)}</strong> · {judgment.rationale || '无 rationale'}</p>)}{item.failureReasons.map((reason) => <p key={reason} className="mt-2 text-xs text-destructive">{reason}</p>)}</div>
    })}</CardContent></Card>}
  </div>
}

function Metric({ title, value }: { title: string; value: string }) {
  return <Card><CardHeader className="pb-2"><CardDescription>{title}</CardDescription><CardTitle className="text-2xl tabular-nums">{value}</CardTitle></CardHeader></Card>
}
