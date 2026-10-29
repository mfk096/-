# Frontend

Vite + React 18 + TypeScript. Как запустить локально и что уже готово — в [корневом README](../README.md).

Ключи Supabase по умолчанию лежат в `.env.local` (см. `.env.example`). Экран «Настройки подключения» может заменить их локально. Ключ `service_role` сюда не кладётся.

Android: `npm run android:sync`, затем `cd android && ./gradlew assembleDebug`. Подробности — в [docs/android.md](../docs/android.md).
