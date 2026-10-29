import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { HistoryTimeline } from '@/components/history-timeline'
import { StatusBadge } from '@/components/status-badge'
import { Card, CardHeader } from '@/components/ui/card'
import { errorText } from '@/lib/errors'
import { asCount } from '@/lib/format'
import { equipmentStatuses } from '@/lib/labels'
import { supabase } from '@/lib/supabase'
import { getUserDisplay } from '@/lib/user-label'
import { useAuth } from '@/providers/auth-context'
import type { EquipmentStatus } from '@/types/database'

export function HomePage() {
  const { user } = useAuth()
  const display = user ? getUserDisplay(user) : null

  const counts = useQuery({
    queryKey: ['equipment-status-counts'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client.from('equipment_status_counts').select('*')
      if (error) throw error
      const byStatus = new Map<EquipmentStatus, number>()
      for (const row of data ?? []) byStatus.set(row.status, asCount(row.equipment_count))
      return byStatus
    },
  })

  const recent = useQuery({
    queryKey: ['journal', 'recent'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('journal_events')
        .select('*')
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(10)
      if (error) throw error
      return data ?? []
    },
  })

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Главная</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          {display
            ? `${display.title}, сводка единиц и последние события журнала.`
            : 'Сводка единиц и последние события журнала.'}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Единицы по статусам</h2>
        {counts.isLoading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
        {counts.error ? (
          <p className="text-sm text-destructive" role="alert">
            {errorText(counts.error, 'Не удалось посчитать единицы')}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {equipmentStatuses.map((item) => (
            <Link
              key={item.value}
              to={`/units?status=${item.value}`}
              className="rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Card className="h-full transition-colors hover:bg-accent/40">
                <CardHeader className="gap-3">
                  <p className="text-3xl font-semibold tabular-nums">
                    {counts.data?.get(item.value) ?? 0}
                  </p>
                  <StatusBadge status={item.value} />
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">Последние события</h2>
          <Link to="/history" className="text-sm text-primary">
            Весь журнал
          </Link>
        </div>
        {recent.isLoading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
        {recent.error ? (
          <p className="text-sm text-destructive" role="alert">
            {errorText(recent.error, 'Не удалось загрузить журнал')}
          </p>
        ) : null}
        {recent.data ? <HistoryTimeline events={recent.data} showUnit /> : null}
      </section>
    </div>
  )
}
