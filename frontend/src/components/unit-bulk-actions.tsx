import { useEffect, useRef, useState } from 'react'
import { Field } from '@/components/field'
import { LocationPicker } from '@/components/location-picker'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { equipmentBulkLimit } from '@/lib/journal'
import type { LocationChoice } from '@/lib/location-tree'
import { equipmentStatuses, isEquipmentStatus } from '@/lib/labels'
import { unitsLabel } from '@/lib/format'
import type { EquipmentStatus } from '@/types/database'

export function UnitBulkActions({
  selectedCount,
  shownCount,
  allSelected,
  someSelected,
  locations,
  pending,
  onToggleAll,
  onClear,
  onMove,
  onChangeStatus,
  onPrintLabels,
  allowChanges = true,
  hideSelection = false,
}: {
  selectedCount: number
  shownCount: number
  allSelected: boolean
  someSelected: boolean
  locations: LocationChoice[]
  pending: boolean
  onToggleAll: () => void
  onClear: () => void
  onMove: (locationId: string | null, comment: string) => void
  onChangeStatus: (status: EquipmentStatus, comment: string) => void
  onPrintLabels?: () => void
  allowChanges?: boolean
  hideSelection?: boolean
}) {
  const [mode, setMode] = useState<'move' | 'status' | null>(null)
  const [locationId, setLocationId] = useState('')
  const [moveComment, setMoveComment] = useState('')
  const [status, setStatus] = useState<EquipmentStatus | ''>('')
  const [statusComment, setStatusComment] = useState('')
  const formRef = useRef<HTMLDivElement>(null)
  const allRef = useRef<HTMLInputElement>(null)
  const overLimit = selectedCount > equipmentBulkLimit

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someSelected && !allSelected
  }, [someSelected, allSelected])

  useEffect(() => {
    if (selectedCount === 0) setMode(null)
  }, [selectedCount])

  useEffect(() => {
    if (!mode) return
    formRef.current?.scrollIntoView({ block: 'nearest' })
  }, [mode])

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-14 z-10 flex flex-col gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur">
        {hideSelection ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                ref={allRef}
                type="checkbox"
                className="size-5"
                checked={allSelected}
                disabled={shownCount === 0 || pending}
                aria-label="Выбрать показанные единицы"
                onChange={onToggleAll}
              />
              Выбрать показанные
            </label>
            <p className="text-sm text-muted-foreground">
              Выбрано: {selectedCount}
              {shownCount > 0 ? ` из ${shownCount}` : ''}
            </p>
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          {allowChanges ? (
            <Button
              type="button"
              className="h-11"
              variant={mode === 'move' ? 'default' : 'outline'}
              disabled={selectedCount === 0 || pending || overLimit}
              onClick={() => setMode((current) => (current === 'move' ? null : 'move'))}
            >
              Переместить
            </Button>
          ) : null}
          {allowChanges ? (
            <Button
              type="button"
              className="h-11"
              variant={mode === 'status' ? 'default' : 'outline'}
              disabled={selectedCount === 0 || pending || overLimit}
              onClick={() => setMode((current) => (current === 'status' ? null : 'status'))}
            >
              Сменить статус
            </Button>
          ) : null}
          {onPrintLabels ? (
            <Button
              type="button"
              className="h-11"
              variant="outline"
              disabled={selectedCount === 0 || pending || overLimit}
              onClick={onPrintLabels}
            >
              Этикетки
            </Button>
          ) : null}
          {selectedCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11"
              disabled={pending}
              onClick={onClear}
            >
              {hideSelection ? 'Очистить список' : 'Снять выбор'}
            </Button>
          ) : null}
        </div>
        {allowChanges && overLimit ? (
          <p className="text-sm text-destructive" role="alert">
            За один раз можно изменить не больше {equipmentBulkLimit} единиц. Снимите лишние.
          </p>
        ) : null}
        {allowChanges && !overLimit ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Если хотя бы у одной выбранной единицы операция не пройдёт, не изменится ни одна.
            История пишется по каждой. Переносить можно при любом статусе.
          </p>
        ) : null}
        {!allowChanges && overLimit ? (
          <p className="text-sm text-destructive" role="alert">
            За один раз можно напечатать не больше {equipmentBulkLimit} этикеток.
          </p>
        ) : null}
      </div>

      {mode === 'move' ? (
        <div ref={formRef}>
          <Card>
            <CardHeader>
              <CardTitle>Переместить выбранные</CardTitle>
              <CardDescription>
                В пакете {unitsLabel(selectedCount)}. Одно место и один комментарий. Место
                выбирается из дерева.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  onMove(locationId || null, moveComment)
                }}
              >
                <Field label="Куда" htmlFor="bulk-location">
                  <LocationPicker
                    id="bulk-location"
                    locations={locations}
                    value={locationId}
                    onChange={setLocationId}
                    allowEmpty
                    emptyLabel="Не назначено"
                  />
                </Field>
                <Field label="Комментарий" htmlFor="bulk-move-comment">
                  <Textarea
                    id="bulk-move-comment"
                    value={moveComment}
                    onChange={(event) => setMoveComment(event.target.value)}
                  />
                </Field>
                <Button
                  type="submit"
                  className="h-11 w-full sm:w-auto"
                  disabled={pending || overLimit}
                >
                  {pending ? 'Перемещение…' : 'Переместить выбранные'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {mode === 'status' ? (
        <div ref={formRef}>
          <Card>
            <CardHeader>
              <CardTitle>Сменить статус выбранных</CardTitle>
              <CardDescription>
                В пакете {unitsLabel(selectedCount)}. Если у единицы уже стоит выбранный статус,
                пакет целиком не выполнится.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!status) return
                  onChangeStatus(status, statusComment)
                }}
              >
                <Field label="Новый статус" htmlFor="bulk-status">
                  <NativeSelect
                    id="bulk-status"
                    value={status}
                    required
                    onChange={(event) => {
                      const value = event.target.value
                      if (!isEquipmentStatus(value)) {
                        setStatus('')
                        return
                      }
                      setStatus(value)
                    }}
                  >
                    <option value="">Выберите статус</option>
                    {equipmentStatuses.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Комментарий" htmlFor="bulk-status-comment">
                  <Textarea
                    id="bulk-status-comment"
                    value={statusComment}
                    onChange={(event) => setStatusComment(event.target.value)}
                  />
                </Field>
                <Button
                  type="submit"
                  className="h-11 w-full sm:w-auto"
                  disabled={pending || !status || overLimit}
                >
                  {pending ? 'Сохранение…' : 'Сменить статус выбранных'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
