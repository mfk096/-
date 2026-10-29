import { Capacitor } from '@capacitor/core'
import { Link } from 'react-router-dom'

export function SupabaseConfigNotice({ message }: { message: string }) {
  const native = Capacitor.isNativePlatform()

  return (
    <div
      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
      role="status"
    >
      <p className="font-medium">Приложение не подключено к Supabase</p>
      <p className="mt-2">{message}</p>
      {native ? (
        <p className="mt-3">
          Укажите адрес сервера и anon key в настройках подключения. Они сохраняются на телефоне,
          APK для смены сервера пересобирать не нужно.
        </p>
      ) : (
        <>
          <ol className="mt-3 list-decimal space-y-1 pl-5">
            <li>
              Скопируйте <code className="font-mono text-xs">frontend/.env.example</code> в{' '}
              <code className="font-mono text-xs">frontend/.env.local</code>.
            </li>
            <li>Вставьте URL проекта и anon key: Supabase → Project Settings → API.</li>
            <li>Ключ service_role в это приложение подставлять нельзя.</li>
            <li>
              Перезапустите <code className="font-mono text-xs">npm run dev</code>.
            </li>
          </ol>
          <p className="mt-3">
            Либо откройте настройки подключения и сохраните адрес на этом устройстве. Пока ключей
            нет, страница входа остаётся на экране и приложение не завершается с ошибкой.
          </p>
        </>
      )}
      <p className="mt-3">
        <Link to="/connection" className="font-medium underline">
          Настройки подключения
        </Link>
      </p>
    </div>
  )
}
