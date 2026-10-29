import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function NotFoundPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Страница не найдена</h1>
        <p className="mt-2 text-muted-foreground">Такого раздела нет. Вернитесь на главную.</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Ссылка не открывает раздел</CardTitle>
          <CardDescription>
            Проверьте адрес. Карточка единицы открывается по коду, например KYOC-001.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="h-11 w-full sm:w-auto" asChild>
            <Link to="/">На главную</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
