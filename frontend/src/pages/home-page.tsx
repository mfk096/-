import { Link } from 'react-router-dom'
import { navItems } from '@/config/navigation'
import { getUserDisplay } from '@/lib/user-label'
import { useAuth } from '@/providers/auth-context'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function HomePage() {
  const { user } = useAuth()
  const display = user ? getUserDisplay(user) : null
  const sections = navItems.filter((item) => item.to !== '/')

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Главная</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          {display
            ? `${display.title}, можно вести номенклатуру и единицы оборудования.`
            : 'Можно вести номенклатуру и единицы оборудования.'}
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Уже есть</CardTitle>
            <CardDescription>
              Вход, номенклатура и единицы с кодами вида KYOC-001. Меню удобно и на телефоне.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Дальше</CardTitle>
            <CardDescription>
              Места установки, QR и Android-приложение, поверки, Excel и переезд на сервер завода.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Доступ</CardTitle>
            <CardDescription>
              До десяти человек. Роли admin, editor и viewer. Регистрация закрыта.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        {sections.map((item) => {
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Card className="h-full transition-colors hover:bg-accent/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="size-4 text-primary" aria-hidden="true" />
                    {item.label}
                  </CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          )
        })}
      </section>
    </div>
  )
}
