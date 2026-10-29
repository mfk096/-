import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { childrenMap, pathMatches, type LocationChoice } from '@/lib/location-tree'
import { cn } from '@/lib/utils'

const emptyBlocked = new Set<string>()

function PickerLevel({
  parentId,
  map,
  depth,
  expanded,
  onToggle,
  value,
  blocked,
  onSelect,
}: {
  parentId: string | null
  map: Map<string | null, LocationChoice[]>
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  value: string
  blocked: ReadonlySet<string>
  onSelect: (id: string) => void
}) {
  const nodes = map.get(parentId) ?? []
  if (nodes.length === 0) return null

  return (
    <ul className="flex flex-col">
      {nodes.map((node) => {
        const children = map.get(node.id) ?? []
        const hasChildren = children.length > 0
        const open = expanded.has(node.id)
        const disabled = blocked.has(node.id)
        const selected = value === node.id
        return (
          <li key={node.id}>
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
              <button
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                onClick={() => onSelect(node.id)}
                className={cn(
                  'flex min-h-11 min-w-0 flex-1 items-center rounded-md px-2 text-left',
                  selected ? 'bg-accent font-medium' : 'hover:bg-accent/40',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="min-w-0">
                  <span className="block break-words">{node.name}</span>
                  {disabled ? (
                    <span className="block text-xs text-muted-foreground">
                      нельзя: получится цикл
                    </span>
                  ) : null}
                </span>
              </button>
            </div>
            {hasChildren && open ? (
              <PickerLevel
                parentId={node.id}
                map={map}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                value={value}
                blocked={blocked}
                onSelect={onSelect}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export function LocationPicker({
  id,
  locations,
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = 'Не назначено',
  disabledIds,
}: {
  id: string
  locations: LocationChoice[]
  value: string
  onChange: (id: string) => void
  allowEmpty?: boolean
  emptyLabel?: string
  disabledIds?: ReadonlySet<string>
}) {
  const [search, setSearch] = useState('')
  const [openIds, setOpenIds] = useState<Set<string> | null>(null)
  const blocked = disabledIds ?? emptyBlocked
  const visible = useMemo(
    () => locations.filter((row) => !row.is_archived || row.id === value),
    [locations, value],
  )
  const map = useMemo(() => childrenMap(visible), [visible])
  const rootIds = useMemo(() => (map.get(null) ?? []).map((row) => row.id), [map])
  const needle = search.trim()
  const matches = useMemo(
    () =>
      visible
        .filter((row) => pathMatches(row, needle))
        .sort((a, b) => {
          const left = a.full_path ?? a.name
          const right = b.full_path ?? b.name
          return left.localeCompare(right, 'ru')
        }),
    [visible, needle],
  )
  const selected = locations.find((row) => row.id === value)
  const expanded = openIds ?? new Set(rootIds)

  function toggle(nodeId: string) {
    setOpenIds((current) => {
      const next = new Set(current ?? rootIds)
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="min-h-6 break-words text-sm font-medium" id={`${id}-current`}>
        {selected ? selected.full_path || selected.name : emptyLabel}
        {selected?.is_archived ? ' · архив' : ''}
      </p>
      <Input
        id={id}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault()
        }}
        placeholder="Поиск по пути"
        aria-label="Поиск места по пути"
        className="h-11"
        autoComplete="off"
      />
      <div className="max-h-[22rem] overflow-y-auto rounded-md border p-1">
        {allowEmpty ? (
          <button
            type="button"
            aria-pressed={value === ''}
            onClick={() => onChange('')}
            className={cn(
              'flex min-h-11 w-full items-center rounded-md px-3 text-left',
              value === '' ? 'bg-accent font-medium' : 'hover:bg-accent/40',
            )}
          >
            {emptyLabel}
          </button>
        ) : null}
        {needle ? (
          matches.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Ничего не найдено</p>
          ) : (
            <ul className="flex flex-col">
              {matches.map((row) => {
                const disabled = blocked.has(row.id)
                const selectedRow = value === row.id
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={selectedRow}
                      onClick={() => onChange(row.id)}
                      className={cn(
                        'flex min-h-11 w-full items-center rounded-md px-3 text-left',
                        selectedRow ? 'bg-accent font-medium' : 'hover:bg-accent/40',
                        disabled && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <span className="min-w-0 break-words">
                        {row.full_path || row.name}
                        {disabled ? (
                          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                            нельзя: получится цикл
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        ) : visible.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">Мест пока нет</p>
        ) : (
          <PickerLevel
            parentId={null}
            map={map}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            value={value}
            blocked={blocked}
            onSelect={onChange}
          />
        )}
      </div>
    </div>
  )
}
