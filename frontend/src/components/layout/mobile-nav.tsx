import { Menu } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { navItems } from '@/config/navigation'
import { cn } from '@/lib/utils'

export function MobileNav({ menuOpen, onOpenMenu }: { menuOpen: boolean; onOpenMenu: () => void }) {
  const shortcuts = navItems.filter((item) => item.mobile)

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Мобильная навигация"
    >
      <ul className="grid grid-cols-5">
        {shortcuts.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex h-16 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-none',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )
                }
              >
                <Icon className="size-5" aria-hidden="true" />
                <span className="max-w-full truncate">{item.label}</span>
              </NavLink>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            className="flex h-16 w-full flex-col items-center justify-center gap-1 px-1 text-[11px] leading-none text-muted-foreground"
            aria-expanded={menuOpen}
            aria-controls="mobile-sections"
            onClick={onOpenMenu}
          >
            <Menu className="size-5" aria-hidden="true" />
            Меню
          </button>
        </li>
      </ul>
    </nav>
  )
}
