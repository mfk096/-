import { statusLabel } from '@/lib/labels'
import type { EquipmentStatus } from '@/types/database'

const tones: Record<EquipmentStatus, string> = {
  in_work: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  on_verification: 'bg-amber-50 text-amber-950 ring-amber-200',
  in_repair: 'bg-orange-50 text-orange-950 ring-orange-200',
  written_off: 'bg-zinc-100 text-zinc-700 ring-zinc-200',
  reserve: 'bg-sky-50 text-sky-950 ring-sky-200',
}

export function StatusBadge({ status }: { status: EquipmentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${tones[status]}`}
    >
      {statusLabel(status)}
    </span>
  )
}
