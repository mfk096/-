import { NavLink } from 'react-router-dom'
import { navItems } from '@/config/navigation'
import { cn } from '@/lib/utils'

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-4 py-4">
        <p className="text-xs tracking-wide text-sidebar-primary">IT-отдел завода</p>
        <p className="mt-1 text-base font-semibold">Инвентаризация</p>
      </div>
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Разделы">
        <ul className="flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
                    )
                  }
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
