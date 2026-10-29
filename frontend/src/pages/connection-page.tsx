import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { AuthScreen } from '@/components/auth/auth-screen'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAccess } from '@/hooks/use-profile'
import {
  PLACEHOLDER_KEY,
  PLACEHOLDER_URL,
  readDeviceConnection,
  readEnvDefaults,
  type ConnectionDraft,
} from '@/lib/connection'
import { useAuth } from '@/providers/auth-context'
import { useConnection } from '@/providers/connection-context'

function initialDraft(): ConnectionDraft {
  const device = readDeviceConnection()
  const env = readEnvDefaults()
  const draft = device ?? env
  return {
    url: draft.url === PLACEHOLDER_URL ? '' : draft.url,
    anonKey: draft.anonKey === PLACEHOLDER_KEY ? '' : draft.anonKey,
  }
}

export function ConnectionPage() {
  const { session, signOut } = useAuth()
  const access = useAccess()
  const connection = useConnection()
  const [draft, setDraft] = useState<ConnectionDraft>(() => initialDraft())
  const [showKey, setShowKey] = useState(false)
  const [pending, setPending] = useState<'check' | 'save' | 'reset' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [messageTone, setMessageTone] = useState<'ok' | 'error'>('ok')

  useEffect(() => {
    document.title = 'Настройки подключения · Инвентаризация'
  }, [])

  const waitingForRole = Boolean(session && !access.isFetched)
  const canEdit = !session || access.role === 'admin'

  async function handleCheck() {
    setPending('check')
    setMessage(null)
    try {
      const text = await connection.check(draft)
      setMessageTone('ok')
      setMessage(text)
    } catch (error) {
      setMessageTone('error')
      setMessage(error instanceof Error ? error.message : 'Не удалось проверить соединение')
    } finally {
      setPending(null)
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending('save')
    setMessage(null)
    try {
      await connection.save(draft)
      setMessageTone('ok')
      setMessage('Настройки сохранены на этом устройстве. При смене сервера сессия сбрасывается.')
      toast.success('Подключение сохранено')
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Не удалось сохранить'
      setMessageTone('error')
      setMessage(text)
      toast.error(text)
    } finally {
      setPending(null)
    }
  }

  async function handleReset() {
    setPending('reset')
    setMessage(null)
    try {
      await connection.resetToEnv()
      const env = readEnvDefaults()
      setDraft({
        url: env.url === PLACEHOLDER_URL ? '' : env.url,
        anonKey: env.anonKey === PLACEHOLDER_KEY ? '' : env.anonKey,
      })
      setMessageTone('ok')
      setMessage(
        'Локальная настройка удалена. Дальше используются значения сборки, если они заданы.',
      )
      toast.success('Возвращены значения сборки')
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Не удалось сбросить настройки'
      setMessageTone('error')
      setMessage(text)
    } finally {
      setPending(null)
    }
  }

  const sourceText =
    connection.source === 'device'
      ? 'Сейчас приложение берёт адрес с этого устройства.'
      : connection.configured
        ? 'Сейчас приложение берёт адрес из значений сборки.'
        : 'Подключение ещё не задано.'

  return (
    <AuthScreen
      title="Настройки подключения"
      description="Адрес Supabase и anon key хранятся на устройстве. Сборка APK их не зашивает навсегда: при переезде на сервер завода приложение пересобирать не нужно."
    >
      {waitingForRole ? <p className="text-sm text-muted-foreground">Проверяем права…</p> : null}

      {!waitingForRole && !canEdit ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-6">
            Менять адрес сервера может администратор. Выйдите из системы: экран настроек снова
            откроется до входа.
          </p>
          <Button type="button" variant="outline" onClick={() => void signOut()}>
            Выйти
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/">Назад</Link>
          </Button>
        </div>
      ) : null}

      {!waitingForRole && canEdit ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => void handleSave(event)}>
          <p className="text-sm leading-6 text-muted-foreground">{sourceText}</p>
          <div className="flex flex-col gap-2">
            <label htmlFor="connection-url" className="text-sm font-medium">
              Адрес сервера
            </label>
            <Input
              id="connection-url"
              name="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="http://10.0.0.5:8000"
              value={draft.url}
              onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Тот же адрес, что VITE_SUPABASE_URL. Для сервера в сети завода можно http://.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="connection-key" className="text-sm font-medium">
              Anon key
            </label>
            <div className="relative">
              <Input
                id="connection-key"
                name="anonKey"
                type={showKey ? 'text' : 'password'}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="pr-10"
                value={draft.anonKey}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, anonKey: event.target.value }))
                }
              />
              <button
                type="button"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
                aria-label={showKey ? 'Скрыть ключ' : 'Показать ключ'}
                onClick={() => setShowKey((value) => !value)}
              >
                {showKey ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Только anon key. Ключ service_role сюда вводить нельзя.
            </p>
          </div>
          {message ? (
            <p
              className={
                messageTone === 'error' ? 'text-sm text-destructive' : 'text-sm text-foreground'
              }
              role={messageTone === 'error' ? 'alert' : 'status'}
            >
              {message}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void handleCheck()}
          >
            {pending === 'check' ? 'Проверяем…' : 'Проверить соединение'}
          </Button>
          <Button type="submit" disabled={pending !== null}>
            {pending === 'save' ? 'Сохраняем…' : 'Сохранить на устройстве'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending !== null}
            onClick={() => void handleReset()}
          >
            {pending === 'reset' ? 'Сбрасываем…' : 'Вернуть значения сборки'}
          </Button>
          <Button variant="outline" asChild>
            <Link to={session ? '/' : '/login'}>{session ? 'Назад в приложение' : 'Ко входу'}</Link>
          </Button>
        </form>
      ) : null}
    </AuthScreen>
  )
}
