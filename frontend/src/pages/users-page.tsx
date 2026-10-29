import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Field } from '@/components/field'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useAccess } from '@/hooks/use-profile'
import { errorText } from '@/lib/errors'
import { appRoles, roleLabel } from '@/lib/labels'
import { supabase, supabaseConfigMessage } from '@/lib/supabase'
import { inviteAppUser, type InviteResult } from '@/lib/users'
import { useAuth } from '@/providers/auth-context'
import type { AppRole } from '@/types/database'

const activeLimit = 10

export function UsersPage() {
  const { user } = useAuth()
  const access = useAccess()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<AppRole>('viewer')
  const [formError, setFormError] = useState<string | null>(null)
  const [issued, setIssued] = useState<InviteResult | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const users = useQuery({
    queryKey: ['profiles', 'directory'],
    enabled: Boolean(supabase && access.role === 'admin'),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, email, role, is_active, created_at')
        .order('full_name')
      if (error) throw error
      return data ?? []
    },
  })

  const invite = useMutation({
    mutationFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      return inviteAppUser(client, { email, fullName, role })
    },
    onSuccess: async (result) => {
      setIssued(result)
      setEmail('')
      setFullName('')
      setRole('viewer')
      setFormError(null)
      await queryClient.invalidateQueries({ queryKey: ['profiles'] })
      toast.success(result.delivery === 'email' ? 'Приглашение отправлено' : 'Пользователь создан')
    },
    onError: (error) => {
      const message = errorText(error, 'Не удалось пригласить пользователя')
      setFormError(message)
      toast.error(message)
    },
  })

  const saveRole = useMutation({
    mutationFn: async (input: { id: string; role: AppRole }) => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { error } = await client
        .from('profiles')
        .update({ role: input.role })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profiles'] })
      toast.success('Роль сохранена')
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось сменить роль')),
  })

  const saveActive = useMutation({
    mutationFn: async (input: { id: string; isActive: boolean }) => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { error } = await client
        .from('profiles')
        .update({ is_active: input.isActive })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: async (_data, input) => {
      setConfirmId(null)
      await queryClient.invalidateQueries({ queryKey: ['profiles'] })
      toast.success(input.isActive ? 'Учётная запись включена' : 'Учётная запись отключена')
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось изменить доступ')),
  })

  function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setIssued(null)
    const trimmedEmail = email.trim()
    const trimmedName = fullName.trim()
    if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      setFormError('Введите корректный email.')
      return
    }
    if (trimmedName.length < 1) {
      setFormError('Укажите имя.')
      return
    }
    const active = (users.data ?? []).filter((item) => item.is_active).length
    if (active >= activeLimit) {
      setFormError('Одновременно может быть не больше 10 активных пользователей.')
      return
    }
    invite.mutate()
  }

  async function copyPassword(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Пароль скопирован')
    } catch {
      toast.error('Не удалось скопировать. Выделите пароль и скопируйте вручную.')
    }
  }

  if (access.isSuccess && access.role !== 'admin') {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Пользователи</h1>
        <Card>
          <CardHeader>
            <CardTitle>Только для администратора</CardTitle>
            <CardDescription>
              Список, приглашения и роли открыты роли «Администратор». Остальные работают со своими
              единицами и могут сменить свой пароль в меню.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const rows = users.data ?? []
  const activeCount = rows.filter((item) => item.is_active).length

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Пользователи</h1>
        <p className="mt-2 text-muted-foreground">
          Регистрация закрыта. Администратор приглашает человека по email. Одновременно не больше{' '}
          {activeLimit} активных учётных записей
          {users.data ? ` (сейчас ${activeCount}).` : '.'}
        </p>
      </header>

      {!supabase && supabaseConfigMessage ? (
        <SupabaseConfigNotice message={supabaseConfigMessage} />
      ) : null}

      {access.role === 'admin' ? (
        <Card>
          <CardHeader>
            <CardTitle>Пригласить</CardTitle>
            <CardDescription>
              Сначала уходит письмо со ссылкой, чтобы человек сам задал пароль. Если почта сервера
              недоступна, здесь один раз покажется временный пароль — передайте его лично.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={(event) => handleInvite(event)}>
              <Field label="Email" htmlFor="invite-email">
                <Input
                  id="invite-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  required
                  className="h-11"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Field label="Имя" htmlFor="invite-name">
                <Input
                  id="invite-name"
                  required
                  className="h-11"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </Field>
              <Field label="Роль" htmlFor="invite-role">
                <NativeSelect
                  id="invite-role"
                  value={role}
                  onChange={(event) => setRole(event.target.value as AppRole)}
                >
                  {appRoles.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {formError ? (
                <p className="text-sm text-destructive" role="alert">
                  {formError}
                </p>
              ) : null}
              <Button type="submit" className="h-11 w-full sm:w-auto" disabled={invite.isPending}>
                {invite.isPending ? 'Отправляем…' : 'Пригласить'}
              </Button>
            </form>
            {issued?.temporaryPassword ? (
              <div className="mt-4 rounded-lg border bg-muted/50 p-4" role="status">
                <p className="text-sm">{issued.message}</p>
                <p className="mt-3 font-mono text-lg break-all">{issued.temporaryPassword}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 h-11"
                  onClick={() => void copyPassword(issued.temporaryPassword ?? '')}
                >
                  Скопировать пароль
                </Button>
              </div>
            ) : null}
            {issued && !issued.temporaryPassword ? (
              <p className="mt-4 text-sm" role="status">
                {issued.message}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {users.isLoading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {users.error ? (
        <p className="text-sm text-destructive" role="alert">
          {errorText(users.error, 'Не удалось загрузить пользователей')}
        </p>
      ) : null}

      {users.data && rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Пользователей пока нет</CardTitle>
            <CardDescription>Пригласите первого человека формой выше.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <ul className="flex flex-col gap-3">
        {rows.map((item) => {
          const self = item.id === user?.id
          const busy = saveRole.isPending || saveActive.isPending
          return (
            <li key={item.id}>
              <Card>
                <CardHeader className="gap-1">
                  <CardTitle className="text-base break-words">{item.full_name}</CardTitle>
                  <CardDescription className="break-all">
                    {item.email || 'Email появится после миграции профилей'}
                    {self ? ' · это вы' : ''}
                    {item.is_active ? '' : ' · отключён'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Field
                    label="Роль"
                    htmlFor={`role-${item.id}`}
                    hint={self ? 'Свою роль сменить нельзя.' : undefined}
                  >
                    <NativeSelect
                      id={`role-${item.id}`}
                      value={item.role}
                      disabled={self || busy || !item.is_active}
                      aria-label={`Роль: ${item.full_name}`}
                      onChange={(event) => {
                        const next = event.target.value as AppRole
                        if (next !== item.role) saveRole.mutate({ id: item.id, role: next })
                      }}
                    >
                      {appRoles.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <p className="text-xs text-muted-foreground">Сейчас: {roleLabel(item.role)}</p>
                  {self ? (
                    <p className="text-sm text-muted-foreground">
                      Свою учётную запись отключить нельзя.
                    </p>
                  ) : item.is_active ? (
                    confirmId === item.id ? (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          variant="destructive"
                          className="h-11"
                          disabled={busy}
                          onClick={() => saveActive.mutate({ id: item.id, isActive: false })}
                        >
                          Подтвердить отключение
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11"
                          onClick={() => setConfirmId(null)}
                        >
                          Отмена
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 w-full sm:w-auto"
                        disabled={busy}
                        onClick={() => setConfirmId(item.id)}
                      >
                        Отключить
                      </Button>
                    )
                  ) : (
                    <Button
                      type="button"
                      className="h-11 w-full sm:w-auto"
                      disabled={busy || activeCount >= activeLimit}
                      onClick={() => saveActive.mutate({ id: item.id, isActive: true })}
                    >
                      {activeCount >= activeLimit ? 'Лимит 10 человек' : 'Включить'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
