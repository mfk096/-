import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { SupabaseConfigNotice } from '@/components/supabase-config-notice'
import { UnitBulkActions } from '@/components/unit-bulk-actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useLocations } from '@/hooks/use-catalogs'
import { useAccess } from '@/hooks/use-profile'
import { changeEquipmentStatusBulk, moveEquipmentBulk } from '@/lib/equipment-bulk'
import { findEquipmentByCode } from '@/lib/equipment-lookup'
import { errorText } from '@/lib/errors'
import { unitsLabel } from '@/lib/format'
import { equipmentBulkLimit } from '@/lib/journal'
import { normalizeScannedCode } from '@/lib/scan-code'
import {
  scannerImplementationLabel,
  startBarcodeScanner,
  usesNativeBarcodeScanner,
  type BarcodeScanSession,
} from '@/lib/scanner'
import { cameraErrorText } from '@/lib/scanners/web-scanner'
import { supabase, supabaseConfigMessage } from '@/lib/supabase'
import type { EquipmentStatus } from '@/types/database'

type ScanMode = 'single' | 'batch'

type BatchItem = {
  code: string
  found: boolean
  id?: string
  name?: string
}

export function ScanPage() {
  const navigate = useNavigate()
  const access = useAccess()
  const queryClient = useQueryClient()
  const locations = useLocations(access.canEditEquipment)
  const [mode, setMode] = useState<ScanMode>('single')
  const [manual, setManual] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [batch, setBatch] = useState<BatchItem[]>([])
  const sessionRef = useRef<BarcodeScanSession | null>(null)
  const modeRef = useRef<ScanMode>('single')
  const batchRef = useRef<BatchItem[]>([])
  const lastRef = useRef<{ code: string; at: number } | null>(null)
  const native = usesNativeBarcodeScanner()

  modeRef.current = mode
  batchRef.current = batch

  async function stopScanner() {
    const session = sessionRef.current
    sessionRef.current = null
    setScanning(false)
    if (session) await session.stop()
  }

  useEffect(() => {
    return () => {
      void sessionRef.current?.stop()
      sessionRef.current = null
    }
  }, [])

  async function lookup(code: string) {
    const row = await findEquipmentByCode(code)
    if (modeRef.current === 'single') {
      if (!row) {
        setHint(`Единица с кодом ${code} не найдена.`)
        return
      }
      await stopScanner()
      navigate(`/units/${row.code}`)
      return
    }

    if (batchRef.current.some((item) => item.code === code)) {
      setHint(`Код ${code} уже в списке.`)
      return
    }
    if (batchRef.current.length >= equipmentBulkLimit) {
      setHint(`В списке уже ${equipmentBulkLimit} кодов. Выполните операцию или уберите лишние.`)
      return
    }
    const next = [
      ...batchRef.current,
      row
        ? { code: row.code, found: true, id: row.id, name: row.nomenclatureName }
        : { code, found: false },
    ]
    batchRef.current = next
    setBatch(next)
    setHint(
      row ? `Добавлено: ${row.code}` : `Единица с кодом ${code} не найдена. В пакет она не войдёт.`,
    )
  }

  async function acceptRaw(raw: string, fromCamera: boolean) {
    const code = normalizeScannedCode(raw)
    if (!code) return
    if (fromCamera) {
      const now = Date.now()
      if (lastRef.current && lastRef.current.code === code && now - lastRef.current.at < 1800)
        return
      lastRef.current = { code, at: now }
    }
    try {
      await lookup(code)
    } catch (error) {
      setHint(errorText(error, 'Не удалось проверить код'))
    }
  }

  const acceptRef = useRef(acceptRaw)
  acceptRef.current = acceptRaw

  async function startCamera() {
    if (sessionRef.current) return
    setHint(null)
    try {
      const session = await startBarcodeScanner({
        elementId: 'barcode-reader',
        onCode: (value) => {
          void acceptRef.current(value, true)
        },
      })
      sessionRef.current = session
      setScanning(true)
    } catch (error) {
      setScanning(false)
      setHint(cameraErrorText(error))
    }
  }

  async function refreshLists() {
    await queryClient.invalidateQueries({ queryKey: ['equipment'] })
    await queryClient.invalidateQueries({ queryKey: ['journal'] })
    await queryClient.invalidateQueries({ queryKey: ['equipment-status-counts'] })
    await queryClient.invalidateQueries({ queryKey: ['locations'] })
  }

  const found = batch.filter((item) => item.found && item.id)
  const foundIds = found.flatMap((item) => (item.id ? [item.id] : []))
  const locationChoices = (locations.data ?? []).filter((item) => !item.is_archived)

  const moveBulk = useMutation({
    mutationFn: (input: { locationId: string | null; comment: string }) =>
      moveEquipmentBulk(foundIds, input.locationId, input.comment),
    onSuccess: async (count) => {
      setBatch([])
      batchRef.current = []
      setHint(null)
      await refreshLists()
      toast.success(`Перемещение записано: ${unitsLabel(count)}`)
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось переместить')),
  })

  const statusBulk = useMutation({
    mutationFn: (input: { status: EquipmentStatus; comment: string }) =>
      changeEquipmentStatusBulk(foundIds, input.status, input.comment),
    onSuccess: async (count) => {
      setBatch([])
      batchRef.current = []
      setHint(null)
      await refreshLists()
      toast.success(`Статус изменён: ${unitsLabel(count)}`)
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось сменить статус')),
  })

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Сканер</h1>
        <p className="mt-2 text-muted-foreground">
          Камера читает QR с кодом единицы. Сейчас используется {scannerImplementationLabel()}. Если
          камера недоступна, код можно ввести вручную.
        </p>
      </header>

      {!supabase && supabaseConfigMessage ? (
        <SupabaseConfigNotice message={supabaseConfigMessage} />
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          className="h-11"
          variant={mode === 'single' ? 'default' : 'outline'}
          onClick={() => setMode('single')}
        >
          Одна единица
        </Button>
        <Button
          type="button"
          className="h-11"
          variant={mode === 'batch' ? 'default' : 'outline'}
          onClick={() => setMode('batch')}
        >
          Инвентаризация
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {mode === 'single'
          ? 'После распознавания откроется карточка. Если кода нет в базе, сканер останется на этом экране.'
          : 'Сканируйте несколько единиц подряд. Затем переместите или смените статус всему списку сразу.'}
      </p>

      {native && scanning ? (
        <div className="barcode-scanner-modal fixed inset-0 z-50 flex flex-col bg-transparent">
          <div className="flex flex-1 items-center justify-center">
            <div className="h-56 w-56 rounded-2xl border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
          <div className="flex flex-col gap-3 bg-black/80 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white">
            <p className="text-center text-sm">
              Наведите камеру на QR. В коде только номер единицы.
            </p>
            <Button
              type="button"
              className="h-11"
              variant="secondary"
              onClick={() => void stopScanner()}
            >
              Остановить камеру
            </Button>
          </div>
        </div>
      ) : null}

      {native ? null : (
        <div id="barcode-reader" className="min-h-56 overflow-hidden rounded-xl border bg-black" />
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {scanning && !native ? (
          <Button
            type="button"
            className="h-11"
            variant="outline"
            onClick={() => void stopScanner()}
          >
            Остановить камеру
          </Button>
        ) : (
          <Button
            type="button"
            className="h-11"
            disabled={scanning && native}
            onClick={() => void startCamera()}
          >
            Запустить камеру
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ручной ввод</CardTitle>
          <CardDescription>
            Если QR не читается, введите код с этикетки, например KYOC-001.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault()
              void acceptRaw(manual, false)
              setManual('')
            }}
          >
            <Input
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="KYOC-001"
              aria-label="Код единицы"
              autoCapitalize="characters"
              className="h-11 font-mono"
            />
            <Button type="submit" className="h-11">
              {mode === 'single' ? 'Открыть' : 'Добавить'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {hint ? (
        <p className="text-sm" role="status">
          {hint}
        </p>
      ) : null}

      {mode === 'batch' ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Список сканирования</h2>
          {batch.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Пока пусто. Сканируйте этикетки одну за другой.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {batch.map((item) => (
                <li
                  key={item.code}
                  className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block font-mono font-semibold">{item.code}</span>
                    <span className="block text-sm text-muted-foreground">
                      {item.found ? item.name : 'Нет в базе'}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11"
                    onClick={() => {
                      const next = batchRef.current.filter((row) => row.code !== item.code)
                      batchRef.current = next
                      setBatch(next)
                    }}
                  >
                    Убрать
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted-foreground">
            В пакете {found.length}
            {batch.length !== found.length ? `, без карточки ${batch.length - found.length}` : ''}.
          </p>
          {access.canEditEquipment && foundIds.length > 0 ? (
            <UnitBulkActions
              selectedCount={foundIds.length}
              shownCount={foundIds.length}
              allSelected
              someSelected={false}
              locations={locationChoices}
              pending={moveBulk.isPending || statusBulk.isPending}
              hideSelection
              onToggleAll={() => undefined}
              onClear={() => {
                setBatch([])
                batchRef.current = []
              }}
              onMove={(locationId, comment) => moveBulk.mutate({ locationId, comment })}
              onChangeStatus={(nextStatus, comment) =>
                statusBulk.mutate({ status: nextStatus, comment })
              }
            />
          ) : null}
          {access.isSuccess && access.data && !access.canEditEquipment && found.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Переместить список или сменить статус могут редактор и администратор.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
