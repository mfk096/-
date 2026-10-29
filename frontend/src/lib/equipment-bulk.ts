import { emptyToNull } from '@/lib/format'
import { equipmentBulkLimit } from '@/lib/journal'
import { supabase } from '@/lib/supabase'
import type { EquipmentStatus } from '@/types/database'

function assertBulk(ids: string[]) {
  const client = supabase
  if (!client) throw new Error('Приложение не подключено к серверу.')
  if (ids.length === 0) throw new Error('Выберите хотя бы одну единицу.')
  if (ids.length > equipmentBulkLimit) {
    throw new Error(`За один раз можно изменить не больше ${equipmentBulkLimit} единиц`)
  }
  return client
}

export async function moveEquipmentBulk(ids: string[], locationId: string | null, comment: string) {
  const client = assertBulk(ids)
  const { error } = await client.rpc('move_equipment_bulk', {
    equipment_ids: ids,
    to_location_id: locationId,
    comment: emptyToNull(comment),
  })
  if (error) throw error
  return ids.length
}

export async function changeEquipmentStatusBulk(
  ids: string[],
  status: EquipmentStatus,
  comment: string,
) {
  const client = assertBulk(ids)
  const { error } = await client.rpc('change_equipment_status_bulk', {
    equipment_ids: ids,
    new_status: status,
    comment: emptyToNull(comment),
  })
  if (error) throw error
  return ids.length
}
