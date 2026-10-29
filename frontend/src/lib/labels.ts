import type { AppRole, EquipmentStatus } from '@/types/database'

export const equipmentStatuses: { value: EquipmentStatus; label: string }[] = [
  { value: 'in_work', label: 'В работе' },
  { value: 'on_verification', label: 'На поверке' },
  { value: 'in_repair', label: 'В ремонте' },
  { value: 'written_off', label: 'Списано' },
  { value: 'reserve', label: 'Резерв' },
]

const statusLabels: Record<EquipmentStatus, string> = {
  in_work: 'В работе',
  on_verification: 'На поверке',
  in_repair: 'В ремонте',
  written_off: 'Списано',
  reserve: 'Резерв',
}

export const appRoles: { value: AppRole; label: string }[] = [
  { value: 'admin', label: 'Администратор' },
  { value: 'editor', label: 'Редактор' },
  { value: 'viewer', label: 'Просмотр' },
]

const roleLabels: Record<AppRole, string> = {
  admin: 'Администратор',
  editor: 'Редактор',
  viewer: 'Просмотр',
}

export function statusLabel(status: EquipmentStatus | null | undefined): string {
  if (!status) return '—'
  return statusLabels[status]
}

export function roleLabel(role: AppRole | null | undefined): string {
  if (!role) return 'Нет доступа'
  return roleLabels[role]
}

export function isEquipmentStatus(value: string): value is EquipmentStatus {
  return equipmentStatuses.some((item) => item.value === value)
}
