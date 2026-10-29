import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function StubPage({
  title,
  description,
  stage,
}: {
  title: string
  description: string
  stage: string
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-muted-foreground">{description}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Раздел ещё не заполнен</CardTitle>
          <CardDescription>{stage}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          На этом этапе работают вход, выход и навигация. Таблицы, учёт единиц и остальные операции
          сюда пока не входят.
        </CardContent>
      </Card>
    </div>
  )
}
