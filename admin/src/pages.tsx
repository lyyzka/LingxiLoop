import { CanAccess, useCustom, useGetIdentity, useLogout, useOne, useTable } from '@refinedev/core'
import {
  ActivityIcon,
  ArrowLeftIcon,
  BotIcon,
  BoxesIcon,
  Building2Icon,
  ChevronRightIcon,
  CircleAlertIcon,
  ChartNoAxesCombinedIcon,
  DatabaseIcon,
  GraduationCapIcon,
  HeartPulseIcon,
  KeyRoundIcon,
  LogOutIcon,
  SearchIcon,
  ShieldCheckIcon,
  ShieldIcon,
  LayoutGridIcon,
  ListIcon,
  MoonIcon,
  SunIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { AuthScreen } from '@/components/AuthScreen'
import { ResourceSkeleton } from '@/components/ResourceSkeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toastAction } from '@/lib/actionToast'
import { confirmSensitiveAction, promptSensitiveAction } from '@/lib/confirmAction'
import { API_URL, adminFetch } from './api'
import { ADMIN_RESOURCES, GROUP_LABELS, type ResourceGroup, resourceDefinition } from './resources'
import { RecordAvatar, RecordCover, RecordValue as FieldValue, StatusBadge } from './record-components'
import { accountStatus, fieldLabel, formatValue, recordColumns, recordTitle as titleFor, resourceContentPath, type AdminRecord } from './record-presentation'

interface ChunkDescriptor extends Record<string, unknown> { truncated: true; length: number; contentUrl: string }

function isChunkDescriptor(value: unknown): value is ChunkDescriptor {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && 'truncated' in value && value.truncated === true && 'length' in value && typeof value.length === 'number' && 'contentUrl' in value && typeof value.contentUrl === 'string' && resourceContentPath(value.contentUrl))
}

export function AdminLayout() {
  const { pathname } = useLocation()
  const contentRef = useRef<HTMLElement>(null)
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }) }, [pathname])
  const [globalSearch, setGlobalSearch] = useState('')
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('admin-theme') === 'dark' } catch { return false } })
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); try { localStorage.setItem('admin-theme', dark ? 'dark' : 'light') } catch { /* Storage is optional. */ } }, [dark])
  const identity = useGetIdentity<{ id: string; name: string; email: string; image?: string }>()
  const navigate = useNavigate()
  const { mutate: logout, isPending } = useLogout()
  const health = useCustom<{ ok: boolean }>({ url: `${API_URL}/health/dependencies`, method: 'get' })
  const dependencyOk = health.query.data?.data.ok
  return <SidebarProvider className="admin-shell" style={{ '--sidebar-width': '16rem' } as React.CSSProperties}>
    <a href="#admin-main" className="admin-skip-link">跳至主要内容</a>
    <Sidebar variant="inset">
      <SidebarHeader className="p-3">
        <Link to="/" className="flex min-w-0 items-center gap-3 rounded-2xl p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm"><ShieldIcon className="size-5" /></span>
          <span className="min-w-0"><strong className="block truncate font-heading text-lg font-semibold tracking-tight">LingxiLoop<span className="text-primary">.</span></strong><span className="block truncate text-xs text-sidebar-foreground/60">管理工作空间</span></span>
        </Link>
      </SidebarHeader>
      <AdminNavigation />
      <SidebarFooter className="p-3">
        <div className="flex items-center gap-3 border-b px-2 pb-4"><RecordAvatar record={{ id: identity.data?.id ?? 'admin', name: identity.data?.name ?? '管理员', image: identity.data?.image }} /><div className="min-w-0"><p className="truncate text-sm font-semibold">{identity.data?.name ?? '平台管理员'}</p><p className="truncate text-xs text-muted-foreground">{identity.data?.email ?? '管理工作空间'}</p></div></div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-sidebar-accent/70 px-3 py-2 text-xs">
          <span className="flex min-w-0 items-center gap-2"><span className={`size-2 shrink-0 rounded-full ${health.query.isLoading ? 'bg-muted-foreground' : dependencyOk ? 'bg-primary' : 'bg-destructive'}`} /><span className="truncate">{health.query.isLoading ? '正在检查依赖' : dependencyOk ? '全部依赖正常' : '依赖存在异常'}</span></span>
          <Badge variant="outline" className="bg-sidebar">LIVE</Badge>
        </div>
        <SidebarMenu>
          <SidebarMenuItem><SidebarMenuButton disabled={isPending} onClick={() => void confirmSensitiveAction({ title: '退出管理后台？', description: '当前管理会话将结束。', confirmLabel: '退出' }).then((confirmed) => { if (confirmed) logout() })}><LogOutIcon /><span>退出管理后台</span></SidebarMenuButton></SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
    <SidebarInset className="h-svh min-w-0 overflow-hidden">
      <header className="admin-header">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-5" />
        <div className="admin-header-copy"><p>工作空间 <span className="mx-2 inline!">/</span> 管理中心</p></div>
        <form className="admin-global-search" onSubmit={(event) => { event.preventDefault(); if (globalSearch.trim().length >= 2) navigate(`/search?q=${encodeURIComponent(globalSearch.trim())}`) }}>
          <InputGroup><InputGroupAddon><SearchIcon /></InputGroupAddon><InputGroupInput value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="搜索用户、公司、项目或课程" aria-label="全局搜索" /></InputGroup>
        </form>
        <Badge variant="outline" className="admin-role-badge"><ShieldCheckIcon />平台管理员</Badge>
        <Button variant="ghost" size="icon" onClick={() => setDark(!dark)} aria-label={dark ? '切换浅色模式' : '切换深色模式'}>{dark ? <SunIcon /> : <MoonIcon />}</Button>
      </header>
      <main ref={contentRef} id="admin-main" tabIndex={-1} className="admin-content"><Outlet /><footer className="admin-footer"><span>© {new Date().getFullYear()} LingxiLoop</span><span>管理工作空间 · 生产环境</span></footer></main>
    </SidebarInset>
  </SidebarProvider>
}

const GROUP_ICONS: Record<ResourceGroup, React.ComponentType<{ className?: string }>> = {
  identity: Building2Icon,
  learning: GraduationCapIcon,
  collaboration: BotIcon,
  operations: BoxesIcon,
}

function AdminNavigation() {
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()
  const closeNavigation = () => setOpenMobile(false)
  return <SidebarContent className="px-2 pb-2">
    <SidebarGroup className="pt-0">
      <SidebarGroupLabel>工作台</SidebarGroupLabel>
      <SidebarGroupContent><SidebarMenu>
        <SidebarMenuItem><SidebarMenuButton asChild isActive={pathname === '/'}><Link to="/" onClick={closeNavigation}><ActivityIcon /><span>运营概览</span></Link></SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton asChild isActive={pathname.startsWith('/authentication')}><Link to="/authentication" onClick={closeNavigation}><KeyRoundIcon /><span>身份与安全</span></Link></SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton asChild isActive={pathname.startsWith('/status')}><Link to="/status" onClick={closeNavigation}><HeartPulseIcon /><span>服务状态</span></Link></SidebarMenuButton></SidebarMenuItem>
        <SidebarMenuItem><SidebarMenuButton asChild isActive={pathname.startsWith('/observability')}><Link to="/observability" onClick={closeNavigation}><ChartNoAxesCombinedIcon /><span>AI 分析</span></Link></SidebarMenuButton></SidebarMenuItem>
      </SidebarMenu></SidebarGroupContent>
    </SidebarGroup>
    <SidebarGroup className="pt-0">
      <SidebarGroupLabel>资源目录</SidebarGroupLabel>
      <SidebarGroupContent><SidebarMenu>
        {(Object.keys(GROUP_LABELS) as ResourceGroup[]).map((group) => {
          const GroupIcon = GROUP_ICONS[group]
          const resources = ADMIN_RESOURCES.filter((resource) => resource.group === group)
          const active = resources.some((resource) => pathname.startsWith(`/resources/${resource.name}`))
          return <Collapsible key={`${group}-${active}`} asChild defaultOpen={active} className="group/collapsible">
            <SidebarMenuItem>
              <CollapsibleTrigger asChild><SidebarMenuButton isActive={active}><GroupIcon /><span>{GROUP_LABELS[group]}</span><ChevronRightIcon className="ms-auto transition-transform group-data-[state=open]/collapsible:rotate-90" /></SidebarMenuButton></CollapsibleTrigger>
              <CollapsibleContent><SidebarMenuSub>
                {resources.map((resource) => <SidebarMenuSubItem key={resource.name}><SidebarMenuSubButton asChild isActive={pathname.startsWith(`/resources/${resource.name}`)}><Link to={`/resources/${resource.name}`} onClick={closeNavigation}><span>{resource.label}</span></Link></SidebarMenuSubButton></SidebarMenuSubItem>)}
              </SidebarMenuSub></CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        })}
      </SidebarMenu></SidebarGroupContent>
    </SidebarGroup>
  </SidebarContent>
}

interface SearchResult { resource: string; id: string; label: string; summary: string | null }

export function SearchPage() {
  const [parameters] = useSearchParams()
  const query = parameters.get('q')?.trim() ?? ''
  const results = useCustom<{ data: SearchResult[] }>({
    url: `${API_URL}/control/platform/search?q=${encodeURIComponent(query)}`,
    method: 'get',
    queryOptions: { enabled: query.length >= 2 },
  })
  if (results.query.isLoading) return <ResourceSkeleton variant="list" count={6} label="正在全局搜索" />
  if (results.query.isError) return <ErrorPanel message="全局搜索失败" retry={() => void results.query.refetch()} />
  const data = results.query.data?.data.data ?? []
  return <div className="space-y-6"><PageHeading title={`搜索“${query}”`} description="用户、公司、项目与课程" />{data.length === 0
    ? <EmptyPanel message="没有匹配结果" />
    : <ItemGroup>{data.map((item) => <Item asChild variant="outline" key={`${item.resource}:${item.id}`}><Link to={`/resources/${item.resource}/${encodeURIComponent(item.id)}`}><ItemMedia variant="icon" className="grid size-9 place-items-center rounded-xl bg-muted"><SearchIcon /></ItemMedia><ItemContent><ItemTitle>{item.label}<Badge variant="secondary">{resourceDefinition(item.resource)?.label}</Badge></ItemTitle><ItemDescription>{item.summary ?? item.id}</ItemDescription></ItemContent><ChevronRightIcon className="size-4 text-muted-foreground" /></Link></Item>)}</ItemGroup>}</div>
}

export function ResourceListPage() {
  const { resource: resourceName } = useParams()
  return <ResourceDirectory key={resourceName} />
}

function ResourceDirectory() {
  const { resource: resourceName } = useParams()
  const resource = resourceDefinition(resourceName)
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [view, setView] = useState<'table' | 'grid'>('table')
  const list = useTable<AdminRecord>({
    resource: resourceName ?? '',
    filters: { permanent: term ? [{ field: 'search', operator: 'contains', value: term }] : [] },
    pagination: { pageSize: 20 },
  })
  const rows = useMemo(() => (list.result.data ?? []).map((row) => resourceName === 'users' ? { ...row, status: accountStatus(row) } : row), [list.result.data, resourceName])
  const columns = useMemo(() => recordColumns(rows, resourceName), [rows, resourceName])
  if (!resource) return <Navigate to="/" replace />
  return <div className="space-y-6">
    <PageHeading title={`${resource.label}管理`} description={`${GROUP_LABELS[resource.group]} · 浏览、查找和管理${resource.label}记录。`} actions={[<Button key="refresh" variant="outline" disabled={list.tableQuery.isFetching} onClick={() => void list.tableQuery.refetch()}><RefreshCwIcon />刷新</Button>]} />
    <Card className="admin-directory"><CardHeader className="border-b"><CardTitle>全部{resource.label}</CardTitle><CardDescription>当前显示 {rows.length} 条记录</CardDescription></CardHeader><CardContent className="space-y-5">
    <div className="admin-toolbar"><form className="flex w-full max-w-md gap-2" onSubmit={(event) => { event.preventDefault(); setTerm(search.trim()); list.setCurrentPage(1) }}><InputGroup><InputGroupAddon><SearchIcon /></InputGroupAddon><InputGroupInput value={search} maxLength={200} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${resource.label}…`} aria-label={`搜索${resource.label}`} /></InputGroup><Button variant="outline" type="submit">搜索</Button></form><div className="flex flex-wrap items-center gap-2"><select aria-label="排序方式" className="admin-select" value={list.sorters[0]?.order ?? 'desc'} onChange={(event) => { list.setSorters([{ field: 'created_at', order: event.target.value === 'asc' ? 'asc' : 'desc' }]); list.setCurrentPage(1) }}><option value="desc">最新优先</option><option value="asc">最早优先</option></select><div className="flex rounded-lg border p-1"><Button size="icon" variant={view === 'table' ? 'secondary' : 'ghost'} aria-label="表格视图" aria-pressed={view === 'table'} onClick={() => setView('table')}><ListIcon /></Button><Button size="icon" variant={view === 'grid' ? 'secondary' : 'ghost'} aria-label="卡片视图" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><LayoutGridIcon /></Button></div></div></div>
    {list.tableQuery.isLoading && rows.length === 0 ? <ResourceSkeleton variant="table" count={8} label={`正在加载${resource.label}`} />
      : list.tableQuery.isError ? <ErrorPanel message={`无法加载${resource.label}`} retry={() => void list.tableQuery.refetch()} />
        : rows.length === 0 ? <EmptyPanel message={`没有匹配的${resource.label}`} />
          : view === 'grid' ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map((row) => <Card key={row.id} className={`overflow-hidden ${['courses', 'projects', 'presentations', 'canvases', 'documents'].includes(resource.name) ? 'pt-0' : ''}`}>{['courses', 'projects', 'presentations', 'canvases', 'documents'].includes(resource.name) && <RecordCover record={row} />}<CardHeader><div className="mb-3 flex items-center justify-between"><RecordAvatar record={row} />{row.status != null && <StatusBadge value={row.status} />}</div><CardTitle className="truncate">{titleFor(row)}</CardTitle><CardDescription className="truncate">{String(row.email ?? row.description ?? row.id)}</CardDescription></CardHeader><CardContent className="space-y-4"><dl className="admin-properties">{columns.slice(0, 3).map((column) => <div key={column}><dt>{fieldLabel(column)}</dt><dd><FieldValue value={row[column]} field={column} /></dd></div>)}</dl>{resource.detail !== false && <Button asChild variant="outline" className="w-full"><Link to={`/resources/${resource.name}/${encodeURIComponent(row.id)}`}>查看详情<ChevronRightIcon /></Link></Button>}</CardContent></Card>)}</div>
          : <div className="admin-table-card rounded-xl border"><Table className="min-w-[52rem]"><TableHeader><TableRow><TableHead>{resource.label}</TableHead>{columns.map((column) => <TableHead key={column}>{fieldLabel(column)}</TableHead>)}{resource.detail !== false && <TableHead className="text-end">操作</TableHead>}</TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell><div className="flex items-center gap-3"><RecordAvatar record={row} /><div className="min-w-0 max-w-56"><p className="truncate font-medium">{titleFor(row)}</p><p className="mt-1 truncate text-xs text-muted-foreground">{row.id}</p></div></div></TableCell>{columns.map((column) => <TableCell key={column} className="max-w-64 whitespace-normal"><span className="admin-cell-value"><FieldValue value={row[column]} field={column} /></span></TableCell>)}{resource.detail !== false && <TableCell className="text-end"><Button asChild variant="ghost" size="sm"><Link aria-label={`查看${titleFor(row)}`} to={`/resources/${resource.name}/${encodeURIComponent(String(row.id))}`}>详情<ChevronRightIcon /></Link></Button></TableCell>}</TableRow>)}</TableBody></Table></div>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><label className="flex items-center gap-2 text-sm text-muted-foreground">每页<select aria-label="每页记录数" className="admin-select" value={list.pageSize} onChange={(event) => { list.setPageSize(Number(event.target.value)); list.setCurrentPage(1) }}>{[20, 50, 100].map((size) => <option key={size} value={size}>{size} 条</option>)}</select></label><div className="flex items-center gap-3"><Button variant="outline" disabled={list.currentPage <= 1 || list.tableQuery.isFetching} onClick={() => list.setCurrentPage((page) => page - 1)}>上一页</Button><span className="text-sm text-muted-foreground">第 {list.currentPage} 页</span><Button variant="outline" disabled={list.currentPage >= list.pageCount || list.tableQuery.isFetching} onClick={() => list.setCurrentPage((page) => page + 1)}>下一页</Button></div></div>
    </CardContent></Card>
  </div>
}

interface Command { action: string; label: string; path: string; method: 'POST' | 'DELETE'; destructive?: boolean; reason?: boolean }

function commands(resource: string, record: AdminRecord): Command[] {
  if (resource === 'users') return record.suspended_at
    ? [{ action: 'restore', label: '恢复账号', path: `/control/platform/users/${record.id}/restore`, method: 'POST', reason: true }]
    : [{ action: 'suspend', label: '停用账号', path: `/control/platform/users/${record.id}/suspend`, method: 'POST', destructive: true, reason: true }]
  if (resource === 'companies') return [
    { action: 'activate', label: '激活', path: `/companies/${record.id}/activate`, method: 'POST', reason: true },
    { action: 'enter-read-only', label: '进入只读', path: `/companies/${record.id}/enter-read-only`, method: 'POST', destructive: true, reason: true },
    { action: 'archive', label: '归档', path: `/companies/${record.id}/archive`, method: 'POST', destructive: true, reason: true },
  ]
  if (resource === 'projects') return [
    { action: 'activate', label: '激活', path: `/projects/${record.id}/activate`, method: 'POST', reason: true },
    { action: 'end', label: '结束', path: `/projects/${record.id}/end`, method: 'POST', destructive: true, reason: true },
    { action: 'enter-read-only', label: '进入只读', path: `/projects/${record.id}/enter-read-only`, method: 'POST', destructive: true, reason: true },
    { action: 'archive', label: '归档', path: `/projects/${record.id}/archive`, method: 'POST', destructive: true, reason: true },
  ]
  if (resource === 'agent-routines' && record.status !== 'paused') return [{ action: 'pause', label: '暂停例程', path: `/im/routines/${record.id}/pause`, method: 'POST', destructive: true, reason: true }]
  if (resource === 'agent-runs') {
    const diagnostics = record.diagnostics as { failedEvents?: number; failedUsageDeliveries?: number; delivery?: { failed_at?: string | null } } | undefined
    return ([['message','结果',!!diagnostics?.delivery?.failed_at],['events','事件',!!diagnostics?.failedEvents],['usage','账单',!!diagnostics?.failedUsageDeliveries]] as const)
      .filter(([, ,failed]) => failed).map(([channel,label]) => ({ action: 'retry', label: `重试${label}投递`,
        path: `/control/platform/agent-runs/${encodeURIComponent(record.id)}/delivery/${channel}/retry`, method: 'POST', reason: true }))
  }
  if (resource === 'agent-deliveries' && record.failed_at) return [{ action: 'retry', label: '重试投递',
    path: `/control/platform/agent-deliveries/${encodeURIComponent(record.id)}/retry`, method: 'POST', reason: true }]
  return []
}

export function ResourceDetailPage() {
  const { resource: resourceName, id } = useParams()
  const resource = resourceDefinition(resourceName)
  const detail = useOne<AdminRecord>({ resource: resourceName ?? '', id: id ?? '' })
  const [pending, setPending] = useState(false)
  if (!resource) return <Navigate to="/" replace />
  if (detail.query.isLoading && !detail.result) return <ResourceSkeleton variant="detail" label={`正在加载${resource.label}详情`} />
  if (detail.query.isError || !detail.result) return <ErrorPanel message={`无法加载${resource.label}详情`} retry={() => void detail.query.refetch()} />
  const record = detail.result
  const availableCommands = commands(resource.name, record)
  const execute = async (command: Command) => {
    const reason = command.reason ? await promptSensitiveAction({
      title: command.label,
      description: `此操作会更改“${titleFor(record)}”的访问状态，并写入审计记录。`,
      confirmLabel: command.label,
      tone: command.destructive ? 'destructive' : 'warning',
      inputLabel: '操作原因',
      inputPlaceholder: '请输入 1–280 字原因',
      inputRequired: true,
    }) : await confirmSensitiveAction({
      title: command.label,
      description: `确认对“${titleFor(record)}”执行此操作？业务生命周期规则仍会在服务端复检。`,
      confirmLabel: command.label,
      tone: command.destructive ? 'destructive' : 'warning',
    }) ? '' : null
    if (reason === null) return
    setPending(true)
    try {
      await toastAction(adminFetch(command.path, {
        method: command.method,
        body: command.reason ? JSON.stringify({ reason }) : undefined,
        headers: {
          ...(record.company_id ? { 'x-company-id': String(record.company_id) } : {}),
          ...(record.project_id ? { 'x-project-id': String(record.project_id) } : {}),
          'x-platform-admin-reason': reason,
        },
      }), { loading: `正在${command.label}`, success: `${command.label}成功`, error: `${command.label}失败` })
      await detail.query.refetch()
    } finally { setPending(false) }
  }
  return <div className="space-y-6">
    <div><Button asChild variant="ghost" size="sm"><Link to={`/resources/${resource.name}`}><ArrowLeftIcon />返回{resource.label}</Link></Button></div>
    <PageHeading title={titleFor(record)} description={`${resource.label} · ${record.id}`} actions={availableCommands.map((command) => <CanAccess key={command.label} resource={resource.name} action={command.action}><Button variant={command.destructive ? 'destructive' : 'outline'} disabled={pending} onClick={() => void execute(command)}>{command.label}</Button></CanAccess>)} />
    <Card className="admin-profile-banner"><CardContent className="flex flex-wrap items-center gap-5"><RecordAvatar record={record} /><div className="min-w-0 flex-1"><p className="font-heading text-xl font-semibold">{titleFor(record)}</p><p className="mt-1 break-all text-sm text-muted-foreground">{String(record.email ?? record.description ?? record.id)}</p></div>{record.status != null && <StatusBadge value={record.status} />}{resource.name === 'users' && <StatusBadge value={record.suspended_at ? 'suspended' : 'active'} />}</CardContent></Card>
    <div className="admin-detail-grid"><Card><CardHeader><CardTitle>基本信息</CardTitle><CardDescription>身份、归属和生命周期</CardDescription></CardHeader><CardContent><dl className="admin-properties">{Object.entries(record).filter(([, value]) => value === null || typeof value !== 'object').map(([key, value]) => <div key={key}><dt>{fieldLabel(key)}</dt><dd><FieldValue value={value} field={key} /></dd></div>)}</dl></CardContent></Card><div className="space-y-5">{Object.entries(record).filter(([, value]) => value !== null && typeof value === 'object').map(([key, value]) => <Card key={key} className="admin-detail-field"><CardHeader><CardTitle>{fieldLabel(key)}</CardTitle></CardHeader><CardContent>{isChunkDescriptor(value) ? <ChunkedField key={value.contentUrl} descriptor={value} /> : <FieldValue value={value} field={key} />}</CardContent></Card>)}{availableCommands.length > 0 && <Card><CardHeader><CardTitle>管理操作</CardTitle><CardDescription>变更需要填写原因，操作将记录到审计日志。</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2">{availableCommands.map((command) => <CanAccess key={command.action} resource={resource.name} action={command.action}><Button variant={command.destructive ? 'destructive' : 'outline'} disabled={pending} onClick={() => void execute(command)}>{command.label}</Button></CanAccess>)}</CardContent></Card>}</div></div>
    {resource.name === 'conversations' && <ConversationMessages conversationId={record.id} />}
  </div>
}

function ChunkedField({ descriptor }: { descriptor: ChunkDescriptor }) {
  const [content, setContent] = useState('')
  const [cursor, setCursor] = useState<string | null>('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const load = async (next: string) => {
    setPending(true)
    setError(false)
    try {
      const result = await adminFetch<{ data: string; nextCursor: string | null }>(
        `${resourceContentPath(descriptor.contentUrl)}${next ? `?cursor=${encodeURIComponent(next)}` : ''}`,
      )
      setContent((current) => next ? current + result.data : result.data)
      setCursor(result.nextCursor)
    } catch { setError(true) } finally { setPending(false) }
  }
  useEffect(() => { void load('') }, [descriptor.contentUrl])
  return <div className="space-y-3"><pre>{content}</pre>{pending && !content
    ? <ResourceSkeleton variant="list" compact count={3} label="正在加载正文" />
    : cursor !== null && <Button variant="outline" size="sm" disabled={pending} onClick={() => void load(cursor)}>加载下一块</Button>}{error && <p className="text-sm text-destructive">正文加载失败，请重试。</p>}<p className="text-xs text-muted-foreground">{content.length} / {descriptor.length} 字符</p></div>
}

function ConversationMessages({ conversationId }: { conversationId: string }) {
  const messages = useCustom<Array<{ messageId: string; fromUid: string; timestamp: number; payload: { kind: string; body?: string; data?: Record<string, unknown> } }>>({ url: `${API_URL}/control/platform/conversations/${encodeURIComponent(conversationId)}/messages`, method: 'get' })
  return <Card><CardHeader><CardTitle className="text-base">会话消息</CardTitle><CardDescription>最近 50 条消息，按会话记录展示</CardDescription></CardHeader><CardContent>{messages.query.isLoading && !messages.query.data
    ? <ResourceSkeleton variant="list" count={5} label="正在加载消息正文" />
    : messages.query.isError ? <ErrorPanel message="无法加载消息正文" retry={() => void messages.query.refetch()} />
      : <ol className="space-y-5">{messages.query.data?.data.map((message) => <li key={message.messageId} className="flex items-start gap-3"><RecordAvatar record={{ id: message.fromUid }} /><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-3 text-xs"><span className="break-all font-medium">{message.fromUid}</span><time className="text-muted-foreground">{formatValue(message.timestamp * 1000, 'created_at')}</time></div><div className="rounded-xl rounded-ss-none bg-muted/70 p-4"><p className="whitespace-pre-wrap break-words text-sm leading-7">{message.payload.body ?? '非文本消息'}</p>{message.payload.data && <details className="mt-3"><summary className="cursor-pointer text-xs text-muted-foreground">查看附加内容</summary><div className="mt-3"><FieldValue value={message.payload.data} /></div></details>}</div></div></li>)}{!messages.query.data?.data.length && <li className="py-8 text-center text-sm text-muted-foreground">暂无消息记录</li>}</ol>}</CardContent></Card>
}

export function PageHeading({ title, description, actions = [] }: { title: string; description: string; actions?: React.ReactNode[] }) {
  return <div className="admin-page-heading"><div className="min-w-0"><h1>{title}</h1><p>{description}</p></div>{actions.length > 0 && <div className="admin-heading-actions">{actions}</div>}</div>
}

function ErrorPanel({ message, retry }: { message: string; retry: () => void }) {
  return <Empty className="admin-state" role="alert"><EmptyHeader><EmptyMedia variant="icon"><CircleAlertIcon /></EmptyMedia><EmptyTitle>{message}</EmptyTitle><EmptyDescription>请检查网络或服务状态后重试。</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" onClick={retry}>重新加载</Button></EmptyContent></Empty>
}

function EmptyPanel({ message }: { message: string }) {
  return <Empty className="admin-state"><EmptyHeader><EmptyMedia variant="icon"><DatabaseIcon /></EmptyMedia><EmptyTitle>{message}</EmptyTitle><EmptyDescription>调整搜索条件，或稍后再回来查看。</EmptyDescription></EmptyHeader></Empty>
}

export function LoginPage() {
  return <div className="admin-login"><aside className="admin-login-story"><Link to="/" className="flex items-center gap-3 text-xl font-semibold"><ShieldIcon />LingxiLoop.</Link><div><Badge variant="outline">管理工作空间</Badge><h1>每一份洞察，<br />都成为更好的决策。</h1><p>连接团队、学习与 AI 协作，<br />在一个清晰的工作空间里掌握全局。</p><div className="admin-login-visual" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div></div><p className="text-xs">面向团队的统一管理中心</p></aside><div className="admin-login-form"><AuthScreen /></div></div>
}

export function ForbiddenPage() {
  return <main className="min-h-svh bg-muted flex items-center justify-center p-6"><Card className="w-full max-w-md"><CardHeader><ShieldCheckIcon className="mb-4 size-10 text-primary" /><CardTitle>需要管理员权限</CardTitle><CardDescription>此工作空间仅向平台管理员开放。请使用管理员账号登录，或联系团队管理员申请权限。</CardDescription></CardHeader><CardContent><Button className="w-full" onClick={() => location.assign('/login')}>返回登录</Button></CardContent></Card></main>
}
