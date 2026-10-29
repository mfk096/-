import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Field } from '@/components/field'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useAccess } from '@/hooks/use-profile'
import { errorText } from '@/lib/errors'
import { asCount, emptyToNull } from '@/lib/format'
import { supabase, supabaseConfigMessage } from '@/lib/supabase'
import type { NomenclatureRow } from '@/types/database'

type FormState = {
  code_prefix: string
  name: string
  manufacturer: string
  model: string
  category: string
  requires_verification: boolean
  verification_interval_months: string
  notes: string
}

const emptyForm: FormState = {
  code_prefix: '',
  name: '',
  manufacturer: '',
  model: '',
  category: '',
  requires_verification: false,
  verification_interval_months: '12',
  notes: '',
}

function formFromRow(row: NomenclatureRow): FormState {
  return {
    code_prefix: row.code_prefix,
    name: row.name,
    manufacturer: row.manufacturer ?? '',
    model: row.model ?? '',
    category: row.category ?? '',
    requires_verification: row.requires_verification,
    verification_interval_months: row.verification_interval_months
      ? String(row.verification_interval_months)
      : '12',
    notes: row.notes ?? '',
  }
}

export function NomenclaturePage() {
  const access = useAccess()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  const list = useQuery({
    queryKey: ['nomenclature'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('nomenclature_with_counts')
        .select('*')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const source = list.data ?? []
    if (!needle) return source
    return source.filter((row) =>
      [row.code_prefix, row.name, row.manufacturer, row.model, row.category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    )
  }, [list.data, search])

  const editing =
    rows.find((row) => row.id === editingId) ?? list.data?.find((row) => row.id === editingId)
  const [renameCodes, setRenameCodes] = useState<string[] | null>(null)
  const [confirmPrefix, setConfirmPrefix] = useState(false)

  const save = useMutation({
    mutationFn: async (confirmed: boolean) => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const prefix = form.code_prefix.trim().toUpperCase()
      if (!/^[A-Z0-9]{2,8}$/.test(prefix)) {
        throw new Error('Префикс: от 2 до 8 символов, только A–Z и цифры.')
      }
      const name = form.name.trim()
      if (!name) throw new Error('Укажите название.')
      let interval: number | null = null
      if (form.requires_verification) {
        const parsed = Number(form.verification_interval_months)
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error('Для поверки укажите интервал в месяцах больше нуля.')
        }
        interval = parsed
      }
      const details = {
        name,
        manufacturer: emptyToNull(form.manufacturer),
        model: emptyToNull(form.model),
        category: emptyToNull(form.category),
        requires_verification: form.requires_verification,
        verification_interval_months: interval,
        notes: emptyToNull(form.notes),
      }
      if (editingId && editing && prefix !== editing.code_prefix) {
        if (asCount(editing.equipment_count) > 0 && !confirmed) {
          throw new Error('Подтвердите смену префикса.')
        }
        const { data, error } = await client.rpc('rename_nomenclature_prefix', {
          p_id: editingId,
          p_prefix: prefix,
        })
        if (error) throw error
        const { error: detailsError } = await client
          .from('nomenclature')
          .update(details)
          .eq('id', editingId)
        if (detailsError) throw detailsError
        return {
          renamed: true as const,
          codes: (data ?? []).map((item) => item.new_code),
        }
      }
      const payload = { code_prefix: prefix, ...details }
      if (editingId) {
        const { error } = await client.from('nomenclature').update(payload).eq('id', editingId)
        if (error) throw error
        return { renamed: false as const, codes: [] as string[] }
      }
      const { error } = await client.from('nomenclature').insert(payload)
      if (error) throw error
      return { renamed: false as const, codes: [] as string[] }
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['nomenclature'] })
      await queryClient.invalidateQueries({ queryKey: ['equipment'] })
      setConfirmPrefix(false)
      setRenameCodes(result.renamed && result.codes.length > 0 ? result.codes : null)
      toast.success(
        result.renamed
          ? 'Префикс и коды единиц обновлены. Этикетки нужно перепечатать.'
          : editingId
            ? 'Номенклатура сохранена'
            : 'Номенклатура создана',
      )
      if (!result.renamed) {
        setCreating(false)
        setEditingId(null)
        setForm(emptyForm)
      }
    },
    onError: (error) => {
      toast.error(errorText(error, 'Не удалось сохранить номенклатуру'))
    },
  })

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setCreating(true)
  }

  function openEdit(row: NomenclatureRow) {
    setCreating(false)
    setEditingId(row.id)
    setForm(formFromRow(row))
  }

  function closeForm() {
    setCreating(false)
    setEditingId(null)
    setForm(emptyForm)
    setConfirmPrefix(false)
    setRenameCodes(null)
  }

  const showForm = creating || Boolean(editingId)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Номенклатура</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Типы и модели оборудования. У каждой позиции свой префикс кода, например KYOC.
          </p>
        </div>
        {access.canEditCatalogs ? (
          <Button type="button" className="h-11 w-full sm:w-auto" onClick={openCreate}>
            Добавить
          </Button>
        ) : null}
      </header>

      {!supabase && supabaseConfigMessage ? (
        <SupabaseConfigNotice message={supabaseConfigMessage} />
      ) : null}

      {access.isSuccess && !access.data ? (
        <p className="text-sm text-muted-foreground">
          Профиль не найден или доступ отключён. Обратитесь к администратору.
        </p>
      ) : null}

      {access.data && !access.canEditCatalogs ? (
        <p className="text-sm text-muted-foreground">
          {access.role === 'editor'
            ? 'Справочник меняет только администратор. Редактор ведёт единицы, статусы и перемещения.'
            : 'У вас доступ только на просмотр.'}
        </p>
      ) : null}

      {supabase ? (
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Поиск по префиксу, названию, производителю, модели или категории"
          aria-label="Поиск номенклатуры"
          className="h-11"
        />
      ) : null}

      {showForm && access.canEditCatalogs ? (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Редактирование' : 'Новая позиция'}</CardTitle>
            <CardDescription>
              Префикс можно сменить. Уже выданные коды получат новый префикс с теми же номерами,
              включая списанные. Старые QR-этикетки после этого нужно перепечатать.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault()
                const prefix = form.code_prefix.trim().toUpperCase()
                const affected = editing ? asCount(editing.equipment_count) : 0
                if (editing && prefix !== editing.code_prefix && affected > 0 && !confirmPrefix) {
                  setRenameCodes(null)
                  setConfirmPrefix(true)
                  return
                }
                save.mutate(confirmPrefix || affected === 0)
              }}
            >
              <Field
                label="Префикс"
                htmlFor="code_prefix"
                hint="2–8 символов: латинские буквы и цифры. Пример: KYOC."
              >
                <Input
                  id="code_prefix"
                  value={form.code_prefix}
                  disabled={save.isPending}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      code_prefix: event.target.value.toUpperCase(),
                    }))
                  }
                  className="h-11 font-mono uppercase"
                  autoComplete="off"
                  required
                />
              </Field>
              <Field label="Название" htmlFor="name">
                <Input
                  id="name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  className="h-11"
                  required
                />
              </Field>
              <Field label="Производитель" htmlFor="manufacturer">
                <Input
                  id="manufacturer"
                  value={form.manufacturer}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, manufacturer: event.target.value }))
                  }
                  className="h-11"
                />
              </Field>
              <Field label="Модель" htmlFor="model">
                <Input
                  id="model"
                  value={form.model}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, model: event.target.value }))
                  }
                  className="h-11"
                />
              </Field>
              <Field label="Категория" htmlFor="category">
                <Input
                  id="category"
                  value={form.category}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, category: event.target.value }))
                  }
                  className="h-11"
                  placeholder="Принтеры, весы, компьютеры"
                />
              </Field>
              <div className="flex flex-col justify-end gap-3">
                <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={form.requires_verification}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        requires_verification: event.target.checked,
                      }))
                    }
                  />
                  Требует поверки
                </label>
                {form.requires_verification ? (
                  <Field label="Интервал, месяцев" htmlFor="interval">
                    <Input
                      id="interval"
                      inputMode="numeric"
                      value={form.verification_interval_months}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          verification_interval_months: event.target.value,
                        }))
                      }
                      className="h-11"
                      required
                    />
                  </Field>
                ) : null}
              </div>
              <div className="sm:col-span-2">
                <Field label="Заметки" htmlFor="notes">
                  <Textarea
                    id="notes"
                    value={form.notes}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </Field>
              </div>
              {confirmPrefix && editing ? (
                <div className="sm:col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                  <p>
                    Сменится код у {asCount(editing.equipment_count)} ед., включая списанные. Номер
                    сохранится: {editing.code_prefix}-001 станет{' '}
                    {form.code_prefix.trim().toUpperCase()}-001. QR-этикетки этих единиц нужно
                    перепечатать.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 h-11"
                    onClick={() => setConfirmPrefix(false)}
                  >
                    Отмена
                  </Button>
                </div>
              ) : null}
              {renameCodes && renameCodes.length > 0 ? (
                <div className="sm:col-span-2">
                  <Button asChild className="h-11 w-full sm:w-auto">
                    <Link to={`/labels?codes=${encodeURIComponent(renameCodes.join(','))}`}>
                      Печать новых этикеток
                    </Link>
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
                <Button type="submit" className="h-11" disabled={save.isPending}>
                  {save.isPending ? 'Сохранение…' : 'Сохранить'}
                </Button>
                <Button type="button" variant="outline" className="h-11" onClick={closeForm}>
                  Отмена
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {list.isLoading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {list.error ? (
        <p className="text-sm text-destructive" role="alert">
          {errorText(list.error, 'Не удалось загрузить номенклатуру')}
        </p>
      ) : null}

      {list.data && rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Ничего не найдено</CardTitle>
            <CardDescription>
              {search.trim()
                ? 'Измените запрос или сбросьте поиск.'
                : 'Справочник пуст. Администратор может добавить первую модель.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm text-primary">{row.code_prefix}</p>
                <h2 className="mt-1 text-base font-semibold">{row.name}</h2>
              </div>
              <Link
                to={`/units?nomenclature=${row.id}`}
                className="shrink-0 text-sm font-medium text-primary"
              >
                {asCount(row.equipment_count)} шт.
              </Link>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {[row.manufacturer, row.model, row.category].filter(Boolean).join(' · ') ||
                'Без уточнений'}
            </p>
            <p className="mt-1 text-sm">
              {row.requires_verification
                ? `Поверка каждые ${row.verification_interval_months} мес.`
                : 'Без поверки'}
            </p>
            {access.canEditCatalogs ? (
              <Button
                type="button"
                variant="outline"
                className="mt-3 h-11 w-full"
                onClick={() => openEdit(row)}
              >
                Изменить
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {rows.length > 0 ? (
        <div className="hidden overflow-x-auto rounded-xl border md:block">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Префикс</th>
                <th className="px-4 py-3 font-medium">Название</th>
                <th className="px-4 py-3 font-medium">Производитель / модель</th>
                <th className="px-4 py-3 font-medium">Категория</th>
                <th className="px-4 py-3 font-medium">Поверка</th>
                <th className="px-4 py-3 font-medium">Единиц</th>
                {access.canEditCatalogs ? <th className="px-4 py-3 font-medium" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-mono">{row.code_prefix}</td>
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className="px-4 py-3">
                    {[row.manufacturer, row.model].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-4 py-3">{row.category || '—'}</td>
                  <td className="px-4 py-3">
                    {row.requires_verification
                      ? `Каждые ${row.verification_interval_months} мес.`
                      : 'Нет'}
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/units?nomenclature=${row.id}`} className="text-primary">
                      {asCount(row.equipment_count)}
                    </Link>
                  </td>
                  {access.canEditCatalogs ? (
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(row)}
                      >
                        Изменить
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
