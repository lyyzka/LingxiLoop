import { useCallback, useEffect, useState } from 'react'
import { authApi } from '@/auth/api'
import { Button } from '@/components/ui/button'
import { companiesApi } from '@/features/companies/api'
import type { ApiCompanyMember } from '@/features/companies/contracts'
import { InvitePeopleModal } from '@/features/companies/components/InvitePeopleModal'
import { confirmSensitiveAction } from '@/lib/confirmAction'
import { userFacingError } from '@/lib/userFacingError'
import { useAuth } from '@/stores/auth'

export function CompanySettingsPanel() {
  const company = useAuth((state) => state.companies[0])
  const [members, setMembers] = useState<ApiCompanyMember[]>([])
  const [inviteOpen, setInviteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    if (company?.isAdmin) setMembers(await companiesApi.listCompanyMembers(company.id))
  }, [company?.id, company?.isAdmin])
  useEffect(() => { void reload().catch((reason) => setError(userFacingError(reason, '成员加载失败'))) }, [reload])
  if (!company) return null
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await work(); await reload() } catch (reason) { setError(userFacingError(reason, '操作失败')) } finally { setBusy(false) }
  }
  const leave = async () => {
    if (!await confirmSensitiveAction({ title: '退出公司？', description: '账号将立即停用。公司保留课程和学习记录；再次加入需要退出后创建的新邀请。最后一位管理员须先交接。', confirmLabel: '退出公司', tone: 'destructive' })) return
    await run(async () => {
      await companiesApi.leaveCompany(company.id)
      useAuth.getState().clear()
      await authApi.signOut()
    })
  }
  return <section className="space-y-4">
    <h2 className="text-lg font-semibold">{company.name}</h2>
    <p>{company.role === 'teacher' ? '教师' : '学生'}{company.isAdmin ? ' · 公司管理员' : ''}</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {company.isAdmin && <>
      <Button onClick={() => setInviteOpen(true)}>邀请教师</Button>
      <ul className="space-y-3">{members.map((member) => <li key={member.id} className="flex flex-wrap items-center gap-3 rounded border p-3">
        <div className="min-w-0 flex-1"><p>{member.name}</p><p className="break-all text-sm text-muted-foreground">{member.email} · {member.role === 'teacher' ? '教师' : '学生'}{member.isAdmin ? ' · 管理员' : ''}</p></div>
        {member.role === 'teacher' && <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
          await companiesApi.updateCompanyMember(company.id, member.id, !member.isAdmin)
          const me = await authApi.me(); useAuth.getState().setMe(me.user, me.companies, me.activeCompanyId)
        })}>{member.isAdmin ? '撤销管理权限' : '授予管理权限'}</Button>}
        <Button variant="destructive" disabled={busy} onClick={() => void (async () => {
          if (await confirmSensitiveAction({ title: `移除 ${member.name}？`, description: '账号将停用，所有访问权限立即撤销，公司历史记录保留。', confirmLabel: '移除成员', tone: 'destructive' })) await run(() => companiesApi.removeCompanyMember(company.id, member.id))
        })()}>移除</Button>
      </li>)}</ul>
    </>}
    <Button variant="destructive" disabled={busy} onClick={() => void leave()}>退出公司</Button>
    {inviteOpen && <InvitePeopleModal companyId={company.id} companyName={company.name} onClose={() => setInviteOpen(false)} />}
  </section>
}
