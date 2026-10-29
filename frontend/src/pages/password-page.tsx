import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Field } from '@/components/field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/providers/auth-context'

export function PasswordPage() {
  const { user, updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      setPassword('')
      setConfirmPassword('')
      toast.success('Пароль обновлён')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Не удалось обновить пароль'
      setError(message)
      toast.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Сменить пароль</h1>
        <p className="mt-2 break-all text-muted-foreground">
          {user?.email
            ? `Новый пароль для ${user.email}.`
            : 'Новый пароль для текущей учётной записи.'}
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Новый пароль</CardTitle>
          <CardDescription>
            Если вы вошли по временному паролю, задайте здесь свой. Забыли текущий — запросите
            письмо со ссылкой.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
            <Field label="Новый пароль" htmlFor="account-password">
              <Input
                id="account-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                className="h-11"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="Повторите пароль" htmlFor="account-password-confirm">
              <Input
                id="account-password-confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                className="h-11"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </Field>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="h-11 w-full sm:w-auto" disabled={pending}>
              {pending ? 'Сохраняем…' : 'Сохранить пароль'}
            </Button>
          </form>
          <p className="mt-4 text-sm">
            <Link to="/reset-password" className="text-primary hover:underline">
              Запросить ссылку на email
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
