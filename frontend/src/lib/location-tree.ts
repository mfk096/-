export type TreeFields = {
  id: string
  parent_id: string | null
  name: string
}

export type LocationChoice = TreeFields & {
  kind: string
  full_path: string | null
  is_archived: boolean
}

export const locationKinds = [
  'завод',
  'цех',
  'участок',
  'помещение',
  'склад',
  'линия',
  'рабочее место',
]

export function kindOptions(current: string): string[] {
  if (current && !locationKinds.includes(current)) return [current, ...locationKinds]
  return [...locationKinds]
}

export function childrenMap<T extends TreeFields>(rows: T[]): Map<string | null, T[]> {
  const ids = new Set(rows.map((row) => row.id))
  const map = new Map<string | null, T[]>()
  for (const row of rows) {
    const parent = row.parent_id && ids.has(row.parent_id) ? row.parent_id : null
    const list = map.get(parent) ?? []
    list.push(row)
    map.set(parent, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }
  return map
}

export function ancestorIds<T extends TreeFields>(rows: T[], id: string): string[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const ids: string[] = []
  const seen = new Set<string>()
  let parentId = byId.get(id)?.parent_id ?? null
  while (parentId) {
    if (seen.has(parentId)) break
    seen.add(parentId)
    ids.push(parentId)
    parentId = byId.get(parentId)?.parent_id ?? null
  }
  return ids
}

export function descendantIds<T extends TreeFields>(rows: T[], id: string): string[] {
  const map = childrenMap(rows)
  const result: string[] = []
  const stack = [...(map.get(id) ?? [])]
  const seen = new Set<string>([id])
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || seen.has(node.id)) continue
    seen.add(node.id)
    result.push(node.id)
    stack.push(...(map.get(node.id) ?? []))
  }
  return result
}

export function subtreeIds<T extends TreeFields>(rows: T[], id: string): string[] {
  return [id, ...descendantIds(rows, id)]
}

export function filterByName<T extends TreeFields>(rows: T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return rows
  const visible = new Set<string>()
  for (const row of rows) {
    if (!row.name.toLowerCase().includes(needle)) continue
    visible.add(row.id)
    for (const ancestorId of ancestorIds(rows, row.id)) visible.add(ancestorId)
  }
  return rows.filter((row) => visible.has(row.id))
}

export function breadcrumb<T extends TreeFields>(rows: T[], id: string): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const chain: T[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    chain.push(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return chain.reverse()
}

export function pathMatches(row: LocationChoice, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const path = (row.full_path ?? row.name).toLowerCase()
  return path.includes(needle) || row.name.toLowerCase().includes(needle)
}

type ResponsibleFields = {
  effective_responsible_name: string | null
  responsible_is_inherited: boolean
  responsible_source_name: string | null
  effective_responsible_archived?: boolean
}

export function responsibleNote(row: ResponsibleFields): string {
  if (!row.effective_responsible_name) return 'Ответственный не назначен'
  const archived = row.effective_responsible_archived ? ' (в архиве)' : ''
  if (row.responsible_is_inherited) {
    const from = row.responsible_source_name?.trim() || 'родителя'
    return `${row.effective_responsible_name}${archived}, унаследован от ${from}`
  }
  return `${row.effective_responsible_name}${archived}`
}

export function placeResponsibleNote(row: {
  location_responsible_name: string | null
  location_responsible_inherited: boolean
  location_responsible_source_name: string | null
}): string | null {
  if (!row.location_responsible_name) return null
  if (row.location_responsible_inherited) {
    const from = row.location_responsible_source_name?.trim() || 'родителя'
    return `${row.location_responsible_name}, унаследован от ${from}`
  }
  return row.location_responsible_name
}
