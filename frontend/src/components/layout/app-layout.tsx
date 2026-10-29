import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { navItems } from '@/config/navigation'
import { MobileNav } from '@/components/layout/mobile-nav'
import { SidebarNav } from '@/components/layout/sidebar-nav'
import { UserMenu } from '@/components/layout/user-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()
  const current = navItems.find((item) =>
    item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`),
  )

  useEffect(() => {
    document.title = current ? `${current.label} · Инвентаризация` : 'Инвентаризация оборудования'
  }, [current])

  return (
    <div className="flex min-h-svh bg-background">
      <div className="no-print sticky top-0 hidden h-svh w-64 shrink-0 md:block">
        <SidebarNav />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b bg-background/95 px-3 backdrop-blur md:px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{current?.label ?? 'Инвентаризация'}</p>
          </div>
          <UserMenu />
        </header>
        <main className="app-main flex-1 px-4 py-6 pb-24 md:px-8 md:pb-8">
          <Outlet />
        </main>
      </div>
      <MobileNav menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} />
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent id="mobile-sections" side="left" className="no-print w-72 gap-0 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Разделы</SheetTitle>
          </SheetHeader>
          <SidebarNav onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  )
}
