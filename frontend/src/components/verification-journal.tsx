import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Field } from '@/components/field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { errorText } from '@/lib/errors'
import { emptyToNull, formatDate, formatDateTime } from '@/lib/format'
import { resultText } from '@/lib/excel/model'
import { supabase } from '@/lib/supabase'
import {
  addCalendarMonths,
  certificateBucket,
  certificateObjectPath,
  certificateProblem,
  todayIso,
  verificationInstant,
} from '@/lib/verification'
import type { EquipmentStatus } from '@/types/database'

const results = [
  { value: 'passed', label: 'Годен' },
  { value: 'failed', label: 'Не годен' },
] as const

type Result = (typeof results)[number]['value']

export function VerificationJournal({
  equipmentId,
  status,
  intervalMonths,
  canEdit,
}: {
  equipmentId: string
  status: EquipmentStatus
  intervalMonths: number | null
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const [verifiedOn, setVerifiedOn] = useState(todayIso)
  const [result, setResult] = useState<Result>('passed')
  const [certificateNumber, setCertificateNumber] = useState('')
  const [nextDate, setNextDate] = useState(() =>
    intervalMonths ? addCalendarMonths(todayIso(), intervalMonths) : '',
  )
  const [nextTouched, setNextTouched] = useState(false)
  const [comment, setComment] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [offerReturn, setOfferReturn] = useState(false)

  const journal = useQuery({
    queryKey: ['verifications', equipmentId],
    enabled: Boolean(supabase && equipmentId),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('verifications')
        .select('*')
        .eq('equipment_id', equipmentId)
        .order('verified_at', { ascending: false })
        .order('id', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['verifications', equipmentId] })
    await queryClient.invalidateQueries({ queryKey: ['equipment'] })
    await queryClient.invalidateQueries({ queryKey: ['verification-summary'] })
    await queryClient.invalidateQueries({ queryKey: ['verification-queue'] })
    await queryClient.invalidateQueries({ queryKey: ['journal'] })
    await queryClient.invalidateQueries({ queryKey: ['equipment-status-counts'] })
  }

  const send = useMutation({
    mutationFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { error } = await client.rpc('change_equipment_status', {
        equipment_id: equipmentId,
        new_status: 'on_verification',
        comment: 'Отправлено на поверку',
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await refresh()
      toast.success('Статус изменён на «На поверке»')
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось отправить на поверку')),
  })

  const save = useMutation({
    mutationFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      if (!verifiedOn) throw new Error('Укажите дату поверки.')
      if (file) {
        const problem = certificateProblem(file)
        if (problem) throw new Error(problem)
      }
      const { data, error } = await client
        .from('verifications')
        .insert({
          equipment_id: equipmentId,
          verified_at: verificationInstant(verifiedOn),
          result,
          next_due_at: emptyToNull(nextDate),
          certificate_number: emptyToNull(certificateNumber),
          comment: emptyToNull(comment),
        })
        .select('id')
        .single()
      if (error) throw error
      if (!file) return
      const path = certificateObjectPath(equipmentId, data.id, file.name)
      const { error: uploadError } = await client.storage
        .from(certificateBucket)
        .upload(path, file, {
          contentType: file.type || undefined,
          upsert: false,
        })
      if (uploadError) {
        throw new Error(
          `Запись поверки сохранена, файл свидетельства не загрузился: ${uploadError.message}`,
        )
      }
      const { error: linkError } = await client
        .from('verifications')
        .update({ file_path: path })
        .eq('id', data.id)
      if (linkError) {
        throw new Error('Запись и файл сохранены, но путь к свидетельству не записался.')
      }
    },
    onSuccess: async () => {
      setCertificateNumber('')
      setComment('')
      setFile(null)
      setFileKey((current) => current + 1)
      setNextTouched(false)
      if (status === 'on_verification') setOfferReturn(true)
      await refresh()
      toast.success('Поверка записана')
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось записать поверку')),
  })

  const returnToWork = useMutation({
    mutationFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { error } = await client.rpc('change_equipment_status', {
        equipment_id: equipmentId,
        new_status: 'in_work',
        comment: 'Возврат после поверки',
      })
      if (error) throw error
    },
    onSuccess: async () => {
      setOfferReturn(false)
      await refresh()
      toast.success('Статус «В работе»')
    },
    onError: (error) => toast.error(errorText(error, 'Не удалось вернуть в работу')),
  })

  async function openFile(path: string) {
    const client = supabase
    if (!client) return
    const { data, error } = await client.storage.from(certificateBucket).download(path)
    if (error || !data) {
      toast.error(errorText(error, 'Не удалось открыть свидетельство'))
      return
    }
    const url = URL.createObjectURL(data)
    window.open(url, '_blank', 'noopener')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Поверки</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Журнал есть только у номенклатуры с флагом поверки. Даты на карточке берёт база из
            последней записи.
            {intervalMonths ? ` Интервал ${intervalMonths} мес.` : ''}
          </p>
        </div>
        {canEdit && status !== 'on_verification' ? (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending ? 'Отправка…' : 'Отправить на поверку'}
          </Button>
        ) : null}
      </div>

      {offerReturn ? (
        <Card>
          <CardHeader>
            <CardTitle>Вернуть в работу?</CardTitle>
            <CardDescription>
              Результат записан. Сейчас единица в статусе «На поверке». Можно сразу вернуть «В
              работе».
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              className="h-11"
              disabled={returnToWork.isPending}
              onClick={() => returnToWork.mutate()}
            >
              Вернуть статус «В работе»
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setOfferReturn(false)}
            >
              Оставить как есть
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Новая запись</CardTitle>
            <CardDescription>
              Следующая дата подставляется из интервала номенклатуры, её можно поправить.
              Свидетельство — PDF или фото, не больше 10 МБ.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault()
                save.mutate()
              }}
            >
              <Field label="Дата поверки" htmlFor="verify-date">
                <Input
                  id="verify-date"
                  type="date"
                  required
                  className="h-11"
                  value={verifiedOn}
                  onChange={(event) => {
                    const value = event.target.value
                    setVerifiedOn(value)
                    if (!nextTouched && value && intervalMonths) {
                      setNextDate(addCalendarMonths(value, intervalMonths))
                    }
                  }}
                />
              </Field>
              <Field label="Результат" htmlFor="verify-result">
                <NativeSelect
                  id="verify-result"
                  value={result}
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === 'passed' || value === 'failed') setResult(value)
                  }}
                >
                  {results.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="№ свидетельства" htmlFor="verify-certificate">
                <Input
                  id="verify-certificate"
                  className="h-11"
                  value={certificateNumber}
                  onChange={(event) => setCertificateNumber(event.target.value)}
                />
              </Field>
              <Field label="Следующая дата" htmlFor="verify-next">
                <Input
                  id="verify-next"
                  type="date"
                  className="h-11"
                  value={nextDate}
                  onChange={(event) => {
                    setNextTouched(true)
                    setNextDate(event.target.value)
                  }}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Комментарий" htmlFor="verify-comment">
                  <Textarea
                    id="verify-comment"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field
                  label="Файл свидетельства"
                  htmlFor="verify-file"
                  hint="Необязательно. PDF, JPG, PNG, WEBP или HEIC."
                >
                  <Input
                    id="verify-file"
                    key={fileKey}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif"
                    className="h-11"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" className="h-11" disabled={save.isPending}>
                  {save.isPending ? 'Сохранение…' : 'Добавить поверку'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {journal.isLoading ? (
        <p className="text-sm text-muted-foreground">Загрузка журнала…</p>
      ) : null}
      {journal.error ? (
        <p className="text-sm text-destructive" role="alert">
          {errorText(journal.error, 'Не удалось загрузить журнал поверок')}
        </p>
      ) : null}
      {journal.data && journal.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Записей поверки ещё нет.</p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {(journal.data ?? []).map((row) => (
          <li key={row.id} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{formatDateTime(row.verified_at)}</p>
              <p>{resultText(row.result)}</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Следующая: {formatDate(row.next_due_at)}
              {row.certificate_number ? ` · свидетельство ${row.certificate_number}` : ''}
            </p>
            {row.comment ? <p className="mt-2 text-sm">{row.comment}</p> : null}
            {row.file_path ? (
              <Button
                type="button"
                variant="outline"
                className="mt-3 h-11"
                onClick={() => {
                  const path = row.file_path
                  if (path) void openFile(path)
                }}
              >
                Открыть свидетельство
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
