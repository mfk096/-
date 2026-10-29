import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function AuthScreen({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-sidebar px-12 py-12 text-sidebar-foreground lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'linear-gradient(to right, oklch(1 0 0 / 6%) 1px, transparent 1px), linear-gradient(to bottom, oklch(1 0 0 / 6%) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="relative">
          <p className="text-sm font-medium tracking-wide text-sidebar-primary">IT-отдел завода</p>
          <h1 className="mt-4 max-w-lg text-4xl font-semibold tracking-tight">
            Инвентаризация оборудования
          </h1>
          <p className="mt-4 max-w-md text-base leading-7 text-sidebar-foreground/80">
            Номенклатура, единицы с кодами вроде KYOC-001, места установки, поверки и QR-этикетки.
            До десяти сотрудников — с компьютера и с телефона.
          </p>
        </div>
        <p className="relative text-sm text-sidebar-foreground/70">
          Самостоятельной регистрации нет. Учётную запись выдаёт администратор.
        </p>
      </section>

      <section className="flex items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-md">
          <p className="mb-4 text-sm font-medium text-primary lg:hidden">
            Инвентаризация оборудования
          </p>
          <Card>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>{children}</CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}
