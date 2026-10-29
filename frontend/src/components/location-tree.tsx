import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { asCount, unitsLabel } from '@/lib/format'
import { childrenMap, responsibleNote } from '@/lib/location-tree'
import { cn } from '@/lib/utils'
import type { LocationPathRow } from '@/types/database'

function TreeLevel({
  parentId,
  map,
  depth,
  expanded,
  onToggle,
}: {
  parentId: string | null
  map: Map<string | null, LocationPathRow[]>
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
}) {
  const nodes = map.get(parentId) ?? []
  if (nodes.length === 0) return null

  return (
    <ul role={depth === 0 ? 'tree' : 'group'} className={cn('flex flex-col', depth > 0 && 'ml-2')}>
      {nodes.map((node) => {
        const children = map.get(node.id) ?? []
        const hasChildren = children.length > 0
        const open = expanded.has(node.id)
        return (
          <li key={node.id} role="treeitem" aria-expanded={hasChildren ? open : undefined}>
            <div
              className="flex items-stretch gap-1"
              style={{ paddingLeft: `${Math.min(depth, 6) * 12}px` }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                  aria-label={open ? `Свернуть ${node.name}` : `Развернуть ${node.name}`}
                  onClick={() => onToggle(node.id)}
                >
                  <ChevronRight
                    className={cn('size-4 transition-transform', open && 'rotate-90')}
                    aria-hidden="true"
                  />
                </button>
              ) : (
                <span className="size-11 shrink-0" aria-hidden="true" />
              )}
              <Link
                to={`/locations/${node.id}`}
                className="flex min-h-11 min-w-0 flex-1 items-center rounded-md px-2 py-2 hover:bg-accent/40"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span
                      className={cn('font-medium', node.is_archived && 'text-muted-foreground')}
                    >
                      {node.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{node.kind}</span>
                    {node.is_archived ? (
                      <span className="text-xs text-muted-foreground">архив</span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {unitsLabel(asCount(node.equipment_count))}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {responsibleNote(node)}
                  </span>
                </span>
              </Link>
            </div>
            {hasChildren && open ? (
              <TreeLevel
                parentId={node.id}
                map={map}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export function LocationTree({
  rows,
  searchActive,
}: {
  rows: LocationPathRow[]
  searchActive: boolean
}) {
  const map = useMemo(() => childrenMap(rows), [rows])
  const rootIds = useMemo(() => (map.get(null) ?? []).map((row) => row.id), [map])
  const [openIds, setOpenIds] = useState<Set<string> | null>(null)

  const expanded = useMemo(() => {
    if (searchActive) {
      const next = new Set<string>()
      for (const row of rows) {
        if ((map.get(row.id) ?? []).length > 0) next.add(row.id)
      }
      return next
    }
    return openIds ?? new Set(rootIds)
  }, [searchActive, rows, map, openIds, rootIds])

  function toggle(id: string) {
    setOpenIds((current) => {
      const next = new Set(current ?? rootIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (rows.length === 0) return null

  return <TreeLevel parentId={null} map={map} depth={0} expanded={expanded} onToggle={toggle} />
}
