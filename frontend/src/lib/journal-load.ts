import { isIsoDate, isJournalEventKind, localDayStartIso, localNextDayIso } from '@/lib/journal'
import { isEquipmentStatus } from '@/lib/labels'
import { supabase } from '@/lib/supabase'
import type { JournalEventRow } from '@/types/database'

export type JournalExportFilters = {
  code: string
  from: string
  to: string
  eventType: string
  nomenclatureId: string
  locationId: string
  authorId: string
  status: string
}

export async function loadFilteredJournal(
  filters: JournalExportFilters,
): Promise<JournalEventRow[]> {
  const client = supabase
  if (!client) throw new Error('Supabase не настроен.')
  const pageSize = 1000
  const rows: JournalEventRow[] = []
  for (let page = 0; page < 20; page += 1) {
    let query = client
      .from('journal_events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
    const needle = filters.code.trim().replace(/[%_,]/g, '')
    if (needle) query = query.ilike('equipment_code', `%${needle}%`)
    if (isIsoDate(filters.from)) query = query.gte('occurred_at', localDayStartIso(filters.from))
    if (isIsoDate(filters.to)) query = query.lt('occurred_at', localNextDayIso(filters.to))
    if (isJournalEventKind(filters.eventType)) query = query.eq('event_kind', filters.eventType)
    if (filters.nomenclatureId) query = query.eq('nomenclature_id', filters.nomenclatureId)
    if (filters.locationId) query = query.contains('location_scope', [filters.locationId])
    if (filters.authorId) query = query.eq('actor_id', filters.authorId)
    if (isEquipmentStatus(filters.status)) query = query.contains('status_scope', [filters.status])
    const from = page * pageSize
    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw error
    const chunk = data ?? []
    rows.push(...chunk)
    if (chunk.length < pageSize) break
  }
  return rows
}
