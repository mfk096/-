import { Link } from 'react-router-dom'
import { journalEventLabel, placeLabel } from '@/lib/journal'
import { statusLabel } from '@/lib/labels'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { JournalEventRow } from '@/types/database'

export function HistoryTimeline({
  events,
  showUnit = false,
}: {
  events: JournalEventRow[]
  showUnit?: boolean
}) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">Записей пока нет.</p>
  }

  return (
    <ol className="flex flex-col">
      {events.map((event) => {
        const movement = event.event_kind === 'movement'
        return (
          <li
            key={`${event.event_kind}-${event.id}`}
            className="flex gap-3 pb-4 last:pb-0 [&:last-child_.timeline-line]:hidden"
          >
            <div className="flex w-4 shrink-0 flex-col items-center" aria-hidden="true">
              <span
                className={cn(
                  'mt-4 size-3 shrink-0 rounded-full ring-4 ring-background',
                  movement ? 'bg-primary' : 'bg-amber-500',
                )}
              />
              <span className="timeline-line mt-1 w-px flex-1 bg-border" />
            </div>
            <article className="min-w-0 flex-1 rounded-xl border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">
                {journalEventLabel(event.event_kind)}
              </p>
              {showUnit ? (
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Link
                    to={`/units/${event.equipment_code}`}
                    className="font-mono text-base font-semibold text-primary"
                  >
                    {event.equipment_code}
                  </Link>
                  <span className="text-sm text-muted-foreground">{event.nomenclature_name}</span>
                </p>
              ) : null}
              <p className="mt-2 break-words text-sm font-medium">
                {movement
                  ? `${placeLabel(event.from_path)} → ${placeLabel(event.to_path)}`
                  : `${event.from_status ? statusLabel(event.from_status) : 'Создание'} → ${statusLabel(event.to_status)}`}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDateTime(event.occurred_at)} · {event.actor_name}
              </p>
              {event.comment ? <p className="mt-2 text-sm">{event.comment}</p> : null}
            </article>
          </li>
        )
      })}
    </ol>
  )
}
