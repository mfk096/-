import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { EmployeeDirectory } from '@/components/employee-directory'
import { Field } from '@/components/field'
import { LocationPicker } from '@/components/location-picker'
import { LocationTree } from '@/components/location-tree'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useEmployees, useLocations } from '@/hooks/use-catalogs'
import { useAccess } from '@/hooks/use-profile'
import { errorText } from '@/lib/errors'
import { filterByName, kindOptions } from '@/lib/location-tree'
import { supabase, supabaseConfigMessage } from '@/lib/supabase'
import { cn } from '@/lib/utils'

export function LocationsPage() {
  const access = useAccess()
  const queryClient = useQueryClient()
  const locations = useLocations()
  const employees = useEmployees(access.canEditCatalogs)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'employees' ? 'employees' : 'tree'
  const parentFromQuery = params.get('parent') ?? ''
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('завод')
  const [parentId, setParentId] = useState('')
  const [responsibleId, setResponsibleId] = useState('')

  useEffect(() => {
    if (!parentFromQuery) return
    setCreating(true)
    setParentId(parentFromQuery)
    setKind('участок')
  }, [parentFromQuery])

  const archivedCount = (locations.data ?? []).filter((row) => row.is_archived).length
  const visible = useMemo(() => {
    const source = (locations.data ?? []).filter((row) => showArchived || !row.is_archived)
    return filterByName(source, search)
  }, [locations.data, showArchived, search])
  const parentChoices = (locations.data ?? []).filter((row) => !row.is_archived)
  const responsibleOptions = (employees.data ?? []).filter(
    (row) => !row.is_archived || row.id === responsibleId,
  )

  function setTab(next: 'tree' | 'employees') {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next === 'employees') updated.set('tab', 'employees')
        else updated.delete('tab')
        return updated
      },
      { replace: true },
    )
  }

  function closeCreate() {
    setCreating(false)
    setName('')
    setKind('завод')
    setParentId('')
    setResponsibleId('')
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        updated.delete('parent')
        return updated
      },
      { replace: true },
    )
  }

  const create = useMutation({
    mutationFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const trimmed = name.trim()
      if (!trimmed) throw new Error('Укажите название.')
      if (!kind.trim()) throw new Error('Выберите тип места.')
      const { error } = await client.from('locations').insert({
        name: trimmed,
        kind,
        parent_id: parentId || null,
        responsible_employee_id: responsibleId || null,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['locations'] })
      toast.success('Место создано')
      closeCreate()
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось создать место')),
  })

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Места установки</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Дерево произвольной глубины. Если у узла нет своего ответственного, он берётся у
          ближайшего родителя.
        </p>
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
            ? 'Места и сотрудников меняет только администратор. Редактор выбирает место у единицы.'
            : 'У вас доступ только на просмотр.'}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Раздел мест">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'tree'}
          className={cn(
            'h-11 rounded-md border text-sm font-medium',
            tab === 'tree' ? 'bg-primary text-primary-foreground' : 'bg-card',
          )}
          onClick={() => setTab('tree')}
        >
          Дерево
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'employees'}
          className={cn(
            'h-11 rounded-md border text-sm font-medium',
            tab === 'employees' ? 'bg-primary text-primary-foreground' : 'bg-card',
          )}
          onClick={() => setTab('employees')}
        >
          Сотрудники
        </button>
      </div>

      {tab === 'employees' ? <EmployeeDirectory canEdit={access.canEditCatalogs} /> : null}

      {tab === 'tree' ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по названию"
              aria-label="Поиск места по названию"
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
            {access.canEditCatalogs ? (
              <Button
                type="button"
                className="h-11 shrink-0"
                onClick={() => {
                  setName('')
                  setKind('завод')
                  setParentId('')
                  setResponsibleId('')
                  setCreating(true)
                  setParams(
                    (current) => {
                      const updated = new URLSearchParams(current)
                      updated.delete('parent')
                      return updated
                    },
                    { replace: true },
                  )
                }}
              >
                Добавить место
              </Button>
            ) : null}
          </div>

          {locations.isLoading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
          {locations.error ? (
            <p className="text-sm text-destructive" role="alert">
              {errorText(locations.error, 'Не удалось загрузить места')}
            </p>
          ) : null}

          {creating && access.canEditCatalogs ? (
            <Card>
              <CardHeader>
                <CardTitle>Новое место</CardTitle>
                <CardDescription>
                  Родитель может быть пустым — тогда место станет корнем. Тип выбирается из списка,
                  в базе это подпись уровня.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    create.mutate()
                  }}
                >
                  <Field label="Название" htmlFor="location-name">
                    <Input
                      id="location-name"
                      className="h-11"
                      value={name}
                      required
                      onChange={(event) => setName(event.target.value)}
                    />
                  </Field>
                  <Field label="Тип" htmlFor="location-kind">
                    <NativeSelect
                      id="location-kind"
                      value={kind}
                      onChange={(event) => setKind(event.target.value)}
                    >
                      {kindOptions(kind).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field
                    label="Родитель"
                    htmlFor="location-parent"
                    hint="Пустой родитель — корень дерева."
                  >
                    <LocationPicker
                      id="location-parent"
                      locations={parentChoices}
                      value={parentId}
                      onChange={setParentId}
                      allowEmpty
                      emptyLabel="Корень, без родителя"
                    />
                  </Field>
                  <Field
                    label="Ответственный"
                    htmlFor="location-responsible"
                    hint="Если не выбрать, ответственный возьмётся у ближайшего родителя."
                  >
                    <NativeSelect
                      id="location-responsible"
                      value={responsibleId}
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
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button type="submit" className="h-11" disabled={create.isPending}>
                      {create.isPending ? 'Сохранение…' : 'Создать'}
                    </Button>
                    <Button type="button" variant="outline" className="h-11" onClick={closeCreate}>
                      Отмена
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {locations.isSuccess && visible.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Ничего не найдено</CardTitle>
                <CardDescription>
                  {search.trim()
                    ? 'Измените поиск. Совпадения ищутся по названию узла.'
                    : archivedCount > 0 && !showArchived
                      ? 'Активных мест нет. Архивные скрыты.'
                      : 'Добавьте корень, например завод, и вложите в него цеха.'}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <LocationTree rows={visible} searchActive={search.trim().length > 0} />
          )}
        </div>
      ) : null}
    </div>
  )
}
