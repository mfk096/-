import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Field } from '@/components/field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useEmployees } from '@/hooks/use-catalogs'
import { errorText } from '@/lib/errors'
import { asCount, emptyToNull, placesPhrase } from '@/lib/format'
import { roleLabel } from '@/lib/labels'
import { supabase } from '@/lib/supabase'
import type { EmployeeDirectoryRow } from '@/types/database'

type FormState = {
  fullName: string
  position: string
  phone: string
  profileId: string
}

const emptyForm: FormState = {
  fullName: '',
  position: '',
  phone: '',
  profileId: '',
}

function formFromRow(row: EmployeeDirectoryRow): FormState {
  return {
    fullName: row.full_name,
    position: row.position ?? '',
    phone: row.phone ?? '',
    profileId: row.profile_id ?? '',
  }
}

export function EmployeeDirectory({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient()
  const employees = useEmployees()
  const profiles = useQuery({
    queryKey: ['profiles', 'options'],
    enabled: Boolean(supabase && canEdit),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, role, is_active')
        .order('full_name')
      if (error) throw error
      return data ?? []
    },
  })
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const archivedCount = (employees.data ?? []).filter((row) => row.is_archived).length
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (employees.data ?? []).filter((row) => {
      if (!showArchived && row.is_archived) return false
      if (!needle) return true
      return [row.full_name, row.position, row.phone, row.profile_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    })
  }, [employees.data, search, showArchived])

  const editing = employees.data?.find((row) => row.id === editingId) ?? null
  const takenProfiles = useMemo(() => {
    const taken = new Set<string>()
    for (const row of employees.data ?? []) {
      if (row.profile_id && row.id !== editingId) taken.add(row.profile_id)
    }
    return taken
  }, [employees.data, editingId])

  const profileOptions = (profiles.data ?? []).filter(
    (profile) => profile.is_active || profile.id === form.profileId,
  )

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['employees'] })
    await queryClient.invalidateQueries({ queryKey: ['locations'] })
  }

  function closeForm() {
    setCreating(false)
    setEditingId(null)
    setForm(emptyForm)
    setConfirmDelete(false)
  }

  const save = useMutation({
    mutationFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const fullName = form.fullName.trim()
      if (!fullName) throw new Error('Укажите ФИО.')
      const payload = {
        full_name: fullName,
        position: emptyToNull(form.position),
        phone: emptyToNull(form.phone),
        profile_id: form.profileId || null,
      }
      if (editingId) {
        const { error } = await client.from('employees').update(payload).eq('id', editingId)
        if (error) throw error
        return
      }
      const { error } = await client.from('employees').insert(payload)
      if (error) throw error
    },
    onSuccess: async () => {
      await refresh()
      toast.success(editingId ? 'Сотрудник сохранён' : 'Сотрудник добавлен')
      closeForm()
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось сохранить сотрудника')),
  })

  const archive = useMutation({
    mutationFn: async (archived: boolean) => {
      const client = supabase
      if (!client || !editingId) throw new Error('Сотрудник не выбран.')
      const { error } = await client
        .from('employees')
        .update({ is_archived: archived })
        .eq('id', editingId)
      if (error) throw error
    },
    onSuccess: async (_data, archived) => {
      await refresh()
      toast.success(archived ? 'Сотрудник в архиве' : 'Сотрудник возвращён из архива')
      closeForm()
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось изменить архив')),
  })

  const remove = useMutation({
    mutationFn: async () => {
      const client = supabase
      if (!client || !editingId) throw new Error('Сотрудник не выбран.')
      const { error } = await client.from('employees').delete().eq('id', editingId)
      if (error) throw error
    },
    onSuccess: async () => {
      await refresh()
      toast.success('Сотрудник удалён')
      closeForm()
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось удалить сотрудника')),
  })

  const showForm = creating || Boolean(editingId)
  const referenceCount = asCount(editing?.location_count)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ФИО, должность или телефон"
          aria-label="Поиск сотрудника"
          className="h-11"
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0"
          aria-pressed={showArchived}
          onClick={() => setShowArchived((current) => !current)}
        >
          {showArchived ? 'Скрыть архив' : `Архив (${archivedCount})`}
        </Button>
        {canEdit ? (
          <Button
            type="button"
            className="h-11 shrink-0"
            onClick={() => {
              setEditingId(null)
              setForm(emptyForm)
              setConfirmDelete(false)
              setCreating(true)
            }}
          >
            Добавить
          </Button>
        ) : null}
      </div>

      {employees.isLoading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {employees.error ? (
        <p className="text-sm text-destructive" role="alert">
          {errorText(employees.error, 'Не удалось загрузить сотрудников')}
        </p>
      ) : null}

      {showForm && canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? 'Карточка сотрудника' : 'Новый сотрудник'}</CardTitle>
            <CardDescription>
              Учётная запись не обязательна. Если на человека есть ссылки, его архивируют, а не
              удаляют.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                save.mutate()
              }}
            >
              <Field label="ФИО" htmlFor="employee-name">
                <Input
                  id="employee-name"
                  className="h-11"
                  value={form.fullName}
                  required
                  onChange={(event) =>
                    setForm((current) => ({ ...current, fullName: event.target.value }))
                  }
                />
              </Field>
              <Field label="Должность" htmlFor="employee-position">
                <Input
                  id="employee-position"
                  className="h-11"
                  value={form.position}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, position: event.target.value }))
                  }
                />
              </Field>
              <Field label="Телефон" htmlFor="employee-phone">
                <Input
                  id="employee-phone"
                  className="h-11"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, phone: event.target.value }))
                  }
                />
              </Field>
              <Field
                label="Пользователь приложения"
                htmlFor="employee-profile"
                hint="Необязательно. Один пользователь — один сотрудник."
              >
                <NativeSelect
                  id="employee-profile"
                  value={form.profileId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, profileId: event.target.value }))
                  }
                >
                  <option value="">Без учётной записи</option>
                  {profileOptions.map((profile) => (
                    <option
                      key={profile.id}
                      value={profile.id}
                      disabled={takenProfiles.has(profile.id)}
                    >
                      {profile.full_name} · {roleLabel(profile.role)}
                      {takenProfiles.has(profile.id) ? ' · уже привязан' : ''}
                      {!profile.is_active ? ' · доступ отключён' : ''}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {editing && referenceCount > 0 ? (
                <p className="text-sm text-muted-foreground">
                  Указан ответственным {placesPhrase(referenceCount)}. Удаление база не примет —
                  архивируйте карточку.
                </p>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button type="submit" className="h-11" disabled={save.isPending}>
                  {save.isPending ? 'Сохранение…' : 'Сохранить'}
                </Button>
                <Button type="button" variant="outline" className="h-11" onClick={closeForm}>
                  Отмена
                </Button>
                {editing && !editing.is_archived ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={archive.isPending}
                    onClick={() => archive.mutate(true)}
                  >
                    В архив
                  </Button>
                ) : null}
                {editing?.is_archived ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    disabled={archive.isPending}
                    onClick={() => archive.mutate(false)}
                  >
                    Вернуть из архива
                  </Button>
                ) : null}
                {editing && referenceCount === 0 ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-11"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (!confirmDelete) {
                        setConfirmDelete(true)
                        return
                      }
                      remove.mutate()
                    }}
                  >
                    {confirmDelete ? 'Удалить безвозвратно' : 'Удалить'}
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {employees.data && rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Никого не найдено</CardTitle>
            <CardDescription>
              {archivedCount > 0 && !showArchived
                ? 'Архивные скрыты. Измените поиск или откройте архив.'
                : 'Добавьте сотрудника, чтобы назначать его ответственным.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.id}>
            <article className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {row.full_name}
                    {row.is_archived ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">архив</span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[row.position, row.phone].filter(Boolean).join(' · ') ||
                      'Должность не указана'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {row.profile_name
                      ? `Учётная запись: ${row.profile_name}`
                      : 'Без учётной записи'}
                    {asCount(row.location_count) > 0
                      ? ` · ответственный ${placesPhrase(asCount(row.location_count))}`
                      : ''}
                  </p>
                </div>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => {
                      setCreating(false)
                      setEditingId(row.id)
                      setForm(formFromRow(row))
                      setConfirmDelete(false)
                    }}
                  >
                    Изменить
                  </Button>
                ) : null}
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  )
}
