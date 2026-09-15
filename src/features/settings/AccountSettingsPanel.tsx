import { http } from '@/api/core/http'
import { AvatarEditor, type AvatarInput } from './AvatarEditor'
import { resolveUserAvatarUrl } from '@/lib/userAvatar'
import { clearAvatarCache } from '@/lib/avatarCache'
import { useParticipants } from '@/features/agents/state'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/stores/auth'
import { SettingsPanelSkeleton } from './SettingsComponents'

export function AccountSettingsPanel() {
  const user = useAuth((state) => state.user)

  if (!user) return <SettingsPanelSkeleton rows={4} />

  const save = async (input: AvatarInput) => {
    const avatar = await http<{ avatarUrl: string; avatarSeed: string | null }>('/me/avatar', { method: 'PUT', body: JSON.stringify(input) })
    if (useAuth.getState().user?.id !== user.id) return
    useAuth.setState((state) => ({ user: state.user ? { ...state.user, ...avatar } : null }))
    clearAvatarCache()
    void useParticipants.getState().refresh()
    window.dispatchEvent(new Event('lingxiloop:growth-updated'))
  }

  return (
    <section aria-label="账号资料" className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-4 p-5 sm:p-6">
        <AvatarEditor kind="user" currentUrl={resolveUserAvatarUrl(user.avatarUrl, user.id)} onSave={save} />
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="break-words text-base font-semibold text-foreground">{user.name}</h3>
          <p className="break-all text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>
      <dl className="grid border-t border-border sm:grid-cols-2">
        <div className="space-y-2 px-5 py-4 sm:px-6">
          <dt className="text-xs text-muted-foreground">登录方式</dt>
          <dd className="text-sm font-medium text-foreground">灵犀账号</dd>
        </div>
        {typeof user.emailVerified === 'boolean' && (
          <div className="space-y-2 border-t border-border px-5 py-4 sm:border-s sm:border-t-0 sm:px-6">
            <dt className="text-xs text-muted-foreground">邮箱状态</dt>
            <dd>
              <Badge variant={user.emailVerified ? 'secondary' : 'outline'}>
                {user.emailVerified ? '已验证' : '未验证'}
              </Badge>
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}
