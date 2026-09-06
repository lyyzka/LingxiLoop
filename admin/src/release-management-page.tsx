import { useCustom } from '@refinedev/core'
import { ArrowUpRightIcon, CheckCircle2Icon, Clock3Icon, GitCommitHorizontalIcon, RefreshCwIcon, RocketIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ResourceSkeleton } from '@/components/ResourceSkeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toastAction } from '@/lib/actionToast'
import { promptSensitiveAction } from '@/lib/confirmAction'
import { API_URL, adminFetch } from './api'
import { BarList } from './components/tremor/BarList'
import { PageHeading } from './pages'
import { StatusBadge } from './record-components'
import { formatValue, STATUS_LABELS } from './record-presentation'

const ACTIONS = { restart: '重启服务', redeploy: '重新部署', cancel: '取消部署', rollback: '回滚版本', keep: '保留部署', reject: '拒绝部署' } as const
interface ReleaseRequest { commit_sha: string; status: string; created_at: number; updated_at: number }
interface DeploymentSummary {
  id: string; projectId?: string; projectName?: string; status?: string; commitSha?: string; commitMessage?: string;
  trigger?: string; environment?: string; framework?: string; buildDurationMs?: number; version?: number;
  createdAt?: string; updatedAt?: string; isActive?: boolean;
}

export function ReleaseManagementPage() {
  const releases = useCustom<{ data: ReleaseRequest[] }>({ url: `${API_URL}/control/releases`, method: 'get', queryOptions: { staleTime: 15_000, refetchOnWindowFocus: false } })
  const deployments = useCustom<{ data: DeploymentSummary[]; total: number }>({ url: `${API_URL}/control/deployment-dashboard`, method: 'get', queryOptions: { staleTime: 15_000, refetchOnWindowFocus: false } })
  const rows = deployments.query.data?.data.data ?? []
  const total = deployments.query.data?.data.total ?? rows.length
  const [selected, setSelected] = useState<string | null>(null)
  const [stream, setStream] = useState<string[]>([])
  const [connection, setConnection] = useState('connecting')
  const [reconnect, setReconnect] = useState(0)
  const [pending, setPending] = useState(false)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const selectedDeployment = rows.find((row) => row.id === selected)
  const visible = rows.filter((row) => (status === 'all' || row.status === status) && [row.projectName, row.commitSha, row.commitMessage, row.id].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())))
  const states = [...new Set(rows.map((row) => row.status ?? 'unknown'))]
  const distribution = states.map((state) => ({ name: STATUS_LABELS[state] ?? state, value: rows.filter((row) => (row.status ?? 'unknown') === state).length }))

  useEffect(() => {
    if (!selected) return
    setStream([])
    setConnection('connecting')
    const events = new EventSource(`${API_URL}/control/openship/deployments/${encodeURIComponent(selected)}/stream`)
    events.onopen = () => setConnection('live')
    events.onmessage = (event) => setStream((current) => [...current.slice(-199), event.data])
    events.onerror = () => { setConnection('error'); events.close() }
    return () => events.close()
  }, [selected, reconnect])

  const mutate = async (action: keyof typeof ACTIONS) => {
    if (!selected || pending) return
    const deploymentId = selected
    const reason = await promptSensitiveAction({ title: `${ACTIONS[action]}？`, description: `将对部署 ${deploymentId} 执行此操作，并记录到审计日志。`, confirmLabel: ACTIONS[action], inputLabel: '操作原因', inputRequired: true, tone: ['rollback', 'cancel', 'reject'].includes(action) ? 'destructive' : 'warning' })
    if (!reason) return
    setPending(true)
    try {
      await toastAction(adminFetch(`/control/openship/deployments/${encodeURIComponent(deploymentId)}/${action}`, { method: 'POST', headers: { 'x-control-reason': reason }, body: JSON.stringify(action === 'redeploy' ? { useExistingCommit: true } : {}) }), { loading: '正在提交操作…', success: `${ACTIONS[action]}已提交`, error: '操作失败，请重试' })
      await Promise.all([deployments.query.refetch(), releases.query.refetch()])
    } finally { setPending(false) }
  }

  return <div className="space-y-6">
    <PageHeading title="发布管理" description="追踪版本交付，了解每次部署的状态与进展。" actions={[
      <Button key="refresh" variant="outline" disabled={deployments.query.isFetching || releases.query.isFetching} onClick={() => { void deployments.query.refetch(); void releases.query.refetch() }}><RefreshCwIcon />刷新</Button>,
      <Button key="openship" asChild><a href="https://ops.christmas1314.xyz" target="_blank" rel="noopener noreferrer">打开 OpenShip<ArrowUpRightIcon /></a></Button>,
    ]} />
    <div className="admin-overview-tabs"><Link to="/">运营总览</Link><Link to="/observability">AI 分析</Link><span aria-current="page">发布动态</span></div>
    {deployments.query.isError ? <Card role="alert"><CardHeader><CardTitle>部署记录暂不可用</CardTitle><CardDescription>请稍后重试，或在 OpenShip 中查看。</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => void deployments.query.refetch()}>重新加载</Button></CardContent></Card> : deployments.query.isLoading ? <ResourceSkeleton variant="table" label="正在加载部署记录" /> : <>
      <section className="admin-kpi-grid" aria-label="最近加载的部署摘要">{[
        { label: '最近部署', value: rows.length, note: `历史共 ${total} 条`, icon: RocketIcon, color: 'blue' },
        { label: '部署就绪', value: rows.filter((row) => row.status === 'ready').length, note: '最近加载的部署记录', icon: CheckCircle2Icon, color: 'emerald' },
        { label: '正在交付', value: rows.filter((row) => ['queued', 'building', 'deploying', 'running', 'pending'].includes(row.status ?? '')).length, note: '等待、构建或部署中', icon: Clock3Icon, color: 'violet' },
        { label: '需要关注', value: rows.filter((row) => ['failed', 'error', 'action_required'].includes(row.status ?? '')).length, note: '失败或等待人工处理', icon: TriangleAlertIcon, color: 'amber' },
      ].map(({ label, value, note, icon: Icon, color }) => <Card key={label} className="admin-kpi"><CardContent><div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{label}</p><span className="admin-kpi-icon" data-color={color}><Icon className="size-5" /></span></div><p className="admin-kpi-value">{value}</p><p className="text-xs text-muted-foreground">{note}</p></CardContent></Card>)}</section>
      <div className="grid gap-5 lg:grid-cols-2"><Card><CardHeader><CardTitle>部署状态分布</CardTitle><CardDescription>最近 {rows.length} 条部署记录</CardDescription></CardHeader><CardContent>{distribution.length ? <BarList data={distribution} aria-label="各部署状态的记录数量" /> : <p className="py-8 text-center text-sm text-muted-foreground">暂无部署数据</p>}</CardContent></Card><Card><CardHeader><CardTitle>版本交付记录</CardTitle><CardDescription>最近的自动发布请求</CardDescription></CardHeader><CardContent>{releases.query.isError ? <div role="alert"><p className="text-sm text-muted-foreground">发布请求暂不可用</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void releases.query.refetch()}>重试</Button></div> : releases.query.isLoading ? <ResourceSkeleton variant="list" count={2} label="正在加载发布请求" /> : <ol className="space-y-4">{releases.query.data?.data.data.slice(0, 4).map((release) => <li key={release.commit_sha} className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted"><GitCommitHorizontalIcon className="size-4" /></span><div className="min-w-0 flex-1"><p className="font-mono text-xs">{release.commit_sha.slice(0, 12)}</p><time className="text-xs text-muted-foreground">{formatValue(release.updated_at, 'updated_at')}</time></div><StatusBadge value={release.status} /></li>)}{!releases.query.data?.data.data.length && <li className="py-8 text-center text-sm text-muted-foreground">暂无发布请求</li>}</ol>}</CardContent></Card></div>
      <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>部署历史</CardTitle><CardDescription className="mt-1">筛选最近记录，展开详情查看日志与管理操作</CardDescription></div><Badge variant="outline">{visible.length} 条匹配</Badge></CardHeader><CardContent className="space-y-5"><div className="admin-toolbar"><InputGroup className="max-w-md"><InputGroupAddon><SearchIcon /></InputGroupAddon><InputGroupInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索项目、提交或部署编号…" aria-label="搜索部署" /></InputGroup><select className="admin-select" aria-label="部署状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option>{states.map((state) => <option key={state} value={state}>{STATUS_LABELS[state] ?? state}</option>)}</select></div><div className="admin-table-card rounded-xl border"><Table className="min-w-[48rem]"><TableHeader><TableRow><TableHead>项目 / 版本</TableHead><TableHead>状态</TableHead><TableHead>提交</TableHead><TableHead>耗时</TableHead><TableHead>创建时间</TableHead><TableHead className="text-end">操作</TableHead></TableRow></TableHeader><TableBody>{visible.map((row) => <TableRow key={row.id}><TableCell><div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary"><RocketIcon className="size-4" /></span><div><p className="max-w-64 truncate font-medium">{row.projectName ?? row.projectId ?? '未命名项目'}</p><p className="mt-1 text-xs text-muted-foreground">v{row.version ?? '—'} · {row.environment ?? '生产环境'}{row.isActive ? ' · 当前版本' : ''}</p></div></div></TableCell><TableCell><StatusBadge value={row.status} /></TableCell><TableCell><p className="max-w-56 truncate text-sm">{row.commitMessage ?? '无提交说明'}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{row.commitSha?.slice(0, 10) ?? '—'}</p></TableCell><TableCell>{row.buildDurationMs == null ? '—' : `${Math.round(row.buildDurationMs / 1000)} 秒`}</TableCell><TableCell className="text-muted-foreground">{formatValue(row.createdAt, 'createdAt')}</TableCell><TableCell className="text-end"><Button size="sm" variant="ghost" onClick={() => setSelected(row.id)}>详情<ArrowUpRightIcon /></Button></TableCell></TableRow>)}</TableBody></Table>{!visible.length && <p className="py-12 text-center text-sm text-muted-foreground">没有匹配的部署记录</p>}</div></CardContent></Card>
    </>}
    <Sheet open={selected !== null} onOpenChange={(open) => { if (!open && !pending) setSelected(null) }}><SheetContent className="w-full! sm:max-w-2xl! overflow-y-auto"><SheetHeader className="border-b pe-14"><SheetTitle>{selectedDeployment?.projectName ?? '部署详情'}</SheetTitle><SheetDescription>查看实时日志，或执行管理操作。</SheetDescription></SheetHeader><div className="space-y-6 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><span className="break-all font-mono text-xs text-muted-foreground">{selected}</span><StatusBadge value={selectedDeployment?.status} /></div><section><h3 className="mb-3 font-semibold">实时日志</h3><div className="min-h-64 overflow-auto rounded-xl bg-slate-950 p-4 text-slate-200"><pre className="max-h-96 whitespace-pre-wrap break-all font-mono text-xs leading-6">{stream.length ? stream.join('\n') : connection === 'error' ? '日志连接已断开。' : '等待日志输出…'}</pre></div><div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{connection === 'live' ? '已连接 · 保留最近 200 条日志' : connection === 'error' ? '连接断开，请重新连接' : '正在连接…'}</span>{connection === 'error' && <Button size="sm" variant="outline" onClick={() => setReconnect((value) => value + 1)}>重新连接</Button>}</div></section><section className="border-t pt-5"><h3 className="font-semibold">部署操作</h3><p className="mb-4 mt-1 text-xs text-muted-foreground">操作前需要确认并填写原因，服务端将验证当前部署状态。</p><div className="flex flex-wrap gap-2">{(Object.keys(ACTIONS) as Array<keyof typeof ACTIONS>).map((action) => <Button key={action} size="sm" disabled={pending} variant={['cancel', 'rollback', 'reject'].includes(action) ? 'destructive' : 'outline'} onClick={() => void mutate(action)}>{ACTIONS[action]}</Button>)}</div></section></div></SheetContent></Sheet>
  </div>
}
