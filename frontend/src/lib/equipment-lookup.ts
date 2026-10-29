import { supabase } from '@/lib/supabase'

export type ScannedEquipment = {
  id: string
  code: string
  nomenclatureName: string
  status: string
  inventoryNumber: string | null
  serialNumber: string | null
}

export async function findEquipmentByCode(code: string): Promise<ScannedEquipment | null> {
  const client = supabase
  if (!client) throw new Error('Приложение не подключено к серверу.')
  const { data, error } = await client
    .from('equipment_list')
    .select('id, code, nomenclature_name, status, inventory_number, serial_number')
    .eq('code', code)
    .abortSignal(AbortSignal.timeout(8000))
    .maybeSingle()
  if (error) {
    if (/abort|timeout|signal/i.test(error.message)) {
      throw new Error('Сервер не ответил. Проверьте подключение и повторите.')
    }
    throw error
  }
  if (!data) return null
  return {
    id: data.id,
    code: data.code,
    nomenclatureName: data.nomenclature_name,
    status: data.status,
    inventoryNumber: data.inventory_number,
    serialNumber: data.serial_number,
  }
}
