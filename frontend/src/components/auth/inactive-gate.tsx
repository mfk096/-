import { Outlet } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAccess } from '@/hooks/use-profile'
import { useAuth } from '@/providers/auth-context'

export function InactiveGate() {
  const access = useAccess()
  const { signOut } = useAuth()

  if (access.data && !access.data.is_active) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-xl border bg-card p-6">
          <h1 className="text-xl font-semibold">Учётная запись отключена</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Войти получилось, но администратор отключил доступ. Новые данные недоступны. Попросите
            администратора включить учётную запись.
          </p>
          <Button
            type="button"
            className="mt-6 h-11 w-full"
            onClick={() => {
              void signOut()
                .then(() => toast.success('Вы вышли из системы'))
                .catch((error: unknown) => {
                  const message = error instanceof Error ? error.message : 'Не удалось выйти'
                  toast.error(message)
                })
            }}
          >
            Выйти
          </Button>
        </div>
      </div>
    )
  }

  return <Outlet />
}
