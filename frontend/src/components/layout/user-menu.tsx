import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAccess } from '@/hooks/use-profile'
import { roleLabel } from '@/lib/labels'
import { getUserDisplay } from '@/lib/user-label'
import { useAuth } from '@/providers/auth-context'

export function UserMenu() {
  const { user, signOut } = useAuth()
  const access = useAccess()
  const navigate = useNavigate()
  if (!user) return null

  const display = getUserDisplay(user)
  const role = access.data?.is_active ? roleLabel(access.data.role) : null

  async function handleSignOut() {
    try {
      await signOut()
      toast.success('Вы вышли из системы')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось выйти'
      toast.error(message)
    }
  }

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex max-w-[46vw] items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent sm:max-w-none"
          >
            <Avatar size="sm">
              <AvatarFallback>{display.initials}</AvatarFallback>
            </Avatar>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{display.title}</span>
              {display.email && display.email !== display.title ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {display.email}
                </span>
              ) : null}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>
            <span className="block truncate">{display.title}</span>
            {role ? (
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {role}
              </span>
            ) : null}
            {display.email ? (
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {display.email}
              </span>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {access.role === 'admin' ? (
            <DropdownMenuItem onSelect={() => navigate('/connection')}>
              Настройки подключения
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() => {
              void handleSignOut()
            }}
          >
            Выйти
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" onClick={() => void handleSignOut()}>
        <LogOut aria-hidden="true" />
        <span className="hidden sm:inline">Выйти</span>
        <span className="sr-only sm:hidden">Выйти</span>
      </Button>
    </div>
  )
}
