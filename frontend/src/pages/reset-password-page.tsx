import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AuthScreen } from '@/components/auth/auth-screen'
import { FullScreenStatus } from '@/components/full-screen-status'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { readUrlAuthError } from '@/lib/auth-url'
import { useAuth } from '@/providers/auth-context'

export function ResetPasswordPage() {
  const {
    configured,
    configMessage,
    loading,
    session,
    requestPasswordReset,
    updatePassword,
    clearRecovery,
  } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(readUrlAuthError)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    document.title = 'Сброс пароля · Инвентаризация'
  }, [])

  if (loading) return <FullScreenStatus title="Проверяем ссылку…" />

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const trimmedEmail = email.trim()
    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      setError('Введите корректный email.')
      return
    }

    setPending(true)
    try {
      await requestPasswordReset(trimmedEmail)
      setSent(true)
      toast.success('Если адрес зарегистрирован, письмо уже отправлено')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Не удалось отправить письмо'
      setError(message)
      toast.error(message)
    } finally {
      setPending(false)
    }
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('Пароль должен быть не короче 6 символов.')
      return
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают.')
      return
    }

    setPending(true)
    try {
      await updatePassword(password)
      clearRecovery()
      toast.success('Пароль обновлён')
      navigate('/', { replace: true })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Не удалось обновить пароль'
      setError(message)
      toast.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthScreen
      title="Сброс пароля"
      description={
        session
          ? 'Задайте новый пароль для этой учётной записи.'
          : 'Отправим ссылку на email. Регистрации новых пользователей нет.'
      }
    >
      {!configured ? (
        <SupabaseConfigNotice
          message={configMessage ?? 'Проверьте переменные окружения Supabase.'}
        />
      ) : session ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => void handleUpdate(event)}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-password">Новый пароль</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-password">Повторите пароль</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? 'Сохраняем…' : 'Сохранить пароль'}
          </Button>
        </form>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => void handleRequest(event)}>
          {sent ? (
            <p className="text-sm leading-6" role="status">
              Если такой адрес есть в системе, на него ушло письмо со ссылкой. Откройте её на любом
              устройстве и задайте новый пароль. Адрес приложения должен быть разрешён в Supabase →
              Authentication → URL Configuration.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
          )}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {sent ? null : (
            <Button type="submit" disabled={pending}>
              {pending ? 'Отправляем…' : 'Отправить ссылку'}
            </Button>
          )}
          <Link to="/login" className="text-sm text-primary hover:underline">
            Вернуться ко входу
          </Link>
        </form>
      )}
    </AuthScreen>
  )
}
