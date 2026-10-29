import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Field } from '@/components/field'
import { LocationPicker } from '@/components/location-picker'
import { StatusBadge } from '@/components/status-badge'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useEmployees, useLocations } from '@/hooks/use-catalogs'
import { useAccess } from '@/hooks/use-profile'
import { errorText } from '@/lib/errors'
import { asCount, unitsLabel } from '@/lib/format'
import {
  breadcrumb,
  descendantIds,
  kindOptions,
  placeResponsibleNote,
  responsibleNote,
  subtreeIds,
} from '@/lib/location-tree'
import { supabase, supabaseConfigMessage } from '@/lib/supabase'

export function LocationPage() {
  const { id = '' } = useParams()
  const access = useAccess()
  const queryClient = useQueryClient()
  const locations = useLocations()
  const employees = useEmployees(access.canEditCatalogs)
  const row = locations.data?.find((item) => item.id === id)
  const [name, setName] = useState<string | null>(null)
  const [kind, setKind] = useState<string | null>(null)
  const [parentId, setParentId] = useState<string | null>(null)
  const [responsibleId, setResponsibleId] = useState<string | null>(null)

  const nameValue = name ?? row?.name ?? ''
  const kindValue = kind ?? row?.kind ?? 'участок'
  const parentValue = parentId === null ? (row?.parent_id ?? '') : parentId
  const responsibleValue =
    responsibleId === null ? (row?.responsible_employee_id ?? '') : responsibleId

  const crumbs = useMemo(
    () => (row ? breadcrumb(locations.data ?? [], row.id) : []),
    [locations.data, row],
  )
  const blockedParents = useMemo(() => {
    if (!row) return new Set<string>()
    return new Set([row.id, ...descendantIds(locations.data ?? [], row.id)])
  }, [locations.data, row])
  const parentChoices = (locations.data ?? []).filter(
    (item) => !item.is_archived || item.id === (row?.parent_id ?? ''),
  )
  const subtree = useMemo(
    () => (row ? subtreeIds(locations.data ?? [], row.id) : []),
    [locations.data, row],
  )
  const responsibleOptions = (employees.data ?? []).filter(
    (employee) => !employee.is_archived || employee.id === responsibleValue,
  )

  const equipment = useQuery({
    queryKey: ['equipment', 'subtree', id, subtree],
    enabled: Boolean(supabase && row && subtree.length > 0),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('equipment_list')
        .select('*')
        .in('location_id', subtree)
        .order('code')
      if (error) throw error
      return data ?? []
    },
  })

  function resetDraft() {
    setName(null)
    setKind(null)
    setParentId(null)
    setResponsibleId(null)
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['locations'] })
    await queryClient.invalidateQueries({ queryKey: ['equipment'] })
  }

  const save = useMutation({
    mutationFn: async () => {
      const client = supabase
      if (!client || !row) throw new Error('Место не найдено.')
      const trimmed = nameValue.trim()
      if (!trimmed) throw new Error('Укажите название.')
      if (!kindValue.trim()) throw new Error('Выберите тип места.')
      const nextParent = parentValue || null
      if ((row.parent_id ?? null) !== nextParent) {
        const { error } = await client.rpc('move_location', {
          location_id: row.id,
          new_parent_id: nextParent,
        })
        if (error) throw error
      }
      const { error } = await client
        .from('locations')
        .update({
          name: trimmed,
          kind: kindValue,
          responsible_employee_id: responsibleValue || null,
        })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: async () => {
      resetDraft()
      await refresh()
      toast.success('Место сохранено')
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось сохранить место')),
  })

  const archive = useMutation({
    mutationFn: async (archived: boolean) => {
      const client = supabase
      if (!client || !row) throw new Error('Место не найдено.')
      const { error } = await client
        .from('locations')
        .update({ is_archived: archived })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: async (_data, archived) => {
      await refresh()
      toast.success(archived ? 'Место в архиве' : 'Место возвращено из архива')
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось изменить архив')),
  })

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <nav
          aria-label="Путь места"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
        >
          <Link to="/locations" className="text-primary">
            Места
          </Link>
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1
            return (
              <span key={crumb.id} className="flex min-w-0 items-center gap-2">
                <span className="text-muted-foreground" aria-hidden="true">
                  /
                </span>
                {last ? (
                  <span className="truncate font-medium">{crumb.name}</span>
                ) : (
                  <Link to={`/locations/${crumb.id}`} className="truncate text-primary">
                    {crumb.name}
                  </Link>
                )}
              </span>
            )
          })}
        </nav>
        <h1 className="mt-2 break-words text-2xl font-semibold tracking-tight">
          {row?.name ?? 'Место'}
        </h1>
      </div>

      {!supabase && supabaseConfigMessage ? (
        <SupabaseConfigNotice message={supabaseConfigMessage} />
      ) : null}

      {locations.isLoading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      {locations.error ? (
        <p className="text-sm text-destructive" role="alert">
          {errorText(locations.error, 'Не удалось открыть место')}
        </p>
      ) : null}

      {locations.isSuccess && !row ? (
        <Card>
          <CardHeader>
            <CardTitle>Место не найдено</CardTitle>
            <CardDescription>Такого узла в дереве нет.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {row ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{row.full_path || row.name}</CardTitle>
              <CardDescription>
                {row.kind}
                {row.is_archived ? ' · архив' : ''} · {unitsLabel(asCount(row.equipment_count))} с
                вложенными
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="text-muted-foreground">Ответственный</p>
              <p className="mt-1">{responsibleNote(row)}</p>
            </CardContent>
          </Card>

          {access.canEditCatalogs ? (
            <Card>
              <CardHeader>
                <CardTitle>Правка</CardTitle>
                <CardDescription>
                  Переименование, тип, перенос к другому родителю и свой ответственный. Цикл база не
                  примет.
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
                  <Field label="Название" htmlFor="place-name">
                    <Input
                      id="place-name"
                      className="h-11"
                      value={nameValue}
                      required
                      onChange={(event) => setName(event.target.value)}
                    />
                  </Field>
                  <Field label="Тип" htmlFor="place-kind">
                    <NativeSelect
                      id="place-kind"
                      value={kindValue}
                      onChange={(event) => setKind(event.target.value)}
                    >
                      {kindOptions(kindValue).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field
                    label="Родитель"
                    htmlFor="place-parent"
                    hint="Внутрь самого себя или вложенного узла перенести нельзя."
                  >
                    <LocationPicker
                      id="place-parent"
                      locations={parentChoices}
                      value={parentValue}
                      onChange={setParentId}
                      allowEmpty
                      emptyLabel="Корень, без родителя"
                      disabledIds={blockedParents}
                    />
                  </Field>
                  <Field
                    label="Свой ответственный"
                    htmlFor="place-responsible"
                    hint={
                      responsibleValue
                        ? 'Это собственное значение узла, оно перекрывает родителя.'
                        : row.responsible_employee_id
                          ? 'После сохранения ответственный будет унаследован, если он задан выше.'
                          : responsibleNote(row)
                    }
                  >
                    <NativeSelect
                      id="place-responsible"
                      value={responsibleValue}
                      onChange={(event) => setResponsibleId(event.target.value)}
                    >
                      <option value="">Не назначен</option>
                      {responsibleOptions.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.full_name}
                          {employee.position ? ` · ${employee.position}` : ''}
                          {employee.is_archived ? ' · архив' : ''}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button type="submit" className="h-11" disabled={save.isPending}>
                      {save.isPending ? 'Сохранение…' : 'Сохранить'}
                    </Button>
                    <Button asChild variant="outline" className="h-11">
                      <Link to={`/locations?parent=${row.id}`}>Добавить вложенное</Link>
                    </Button>
                    {row.is_archived ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11"
                        disabled={archive.isPending}
                        onClick={() => archive.mutate(false)}
                      >
                        Вернуть из архива
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11"
                        disabled={archive.isPending}
                        onClick={() => archive.mutate(true)}
                      >
                        В архив
                      </Button>
                    )}
                  </div>
                  {row.is_archived ? null : (
                    <p className="text-xs leading-5 text-muted-foreground">
                      Место с единицами или вложенными узлами архивировать нельзя: сначала
                      перенесите их. База напишет, чего именно не хватает.
                    </p>
                  )}
                </form>
              </CardContent>
            </Card>
          ) : null}

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Единицы в узле и ниже</h2>
            {equipment.isLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка…</p>
            ) : null}
            {equipment.error ? (
              <p className="text-sm text-destructive" role="alert">
                {errorText(equipment.error, 'Не удалось загрузить единицы')}
              </p>
            ) : null}
            {equipment.data && equipment.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">В этом месте и ниже единиц нет.</p>
            ) : null}
            <ul className="flex flex-col gap-3">
              {(equipment.data ?? []).map((item) => {
                const responsible = placeResponsibleNote(item)
                return (
                  <li key={item.id}>
                    <Link
                      to={`/units/${item.code}`}
                      className="block rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-mono text-lg font-semibold">{item.code}</p>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="mt-2 text-sm">{item.nomenclature_name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {item.location_path || 'Место не назначено'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {responsible ?? 'Ответственный не назначен'}
                      </p>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  )
}
