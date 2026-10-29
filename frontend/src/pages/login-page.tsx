import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { AuthScreen } from '@/components/auth/auth-screen'
import { FullScreenStatus } from '@/components/full-screen-status'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/providers/auth-context'

type FromLocation = {
  pathname?: string
  search?: string
}

function destinationFrom(state: unknown): string {
  if (!state || typeof state !== 'object' || !('from' in state)) return '/'
  const from = (state as { from?: FromLocation }).from
  if (!from?.pathname || !from.pathname.startsWith('/') || from.pathname === '/login') return '/'
  return `${from.pathname}${from.search ?? ''}`
}

export function LoginPage() {
  const { configured, configMessage, loading, session, recovery, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Вход · Инвентаризация'
  }, [])

  if (loading) return <FullScreenStatus title="Проверяем сессию…" />
  if (session && recovery) return <Navigate to="/reset-password" replace />
  if (session) return <Navigate to={destinationFrom(location.state)} replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      setError('Введите корректный email.')
      return
    }
    if (!password) {
      setError('Введите пароль.')
      return
    }

    setPending(true)
    try {
      await signIn(trimmedEmail, password)
      toast.success('Вход выполнен')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Не удалось войти'
      setError(message)
      toast.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthScreen
      title="Вход"
      description="Email и пароль учётной записи. Самостоятельной регистрации нет."
    >
      {!configured ? (
        <SupabaseConfigNotice
          message={configMessage ?? 'Проверьте переменные окружения Supabase.'}
        />
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="password">Пароль</Label>
              <Link to="/reset-password" className="text-sm text-primary hover:underline">
                Забыли пароль?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                className="pr-10"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? 'Входим…' : 'Войти'}
          </Button>
          <p className="text-sm leading-6 text-muted-foreground">
            Новую учётную запись создаёт администратор. Кнопка регистрации здесь специально
            отсутствует.
          </p>
        </form>
      )}
    </AuthScreen>
  )
}
