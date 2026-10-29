# Архитектура

Журнал решений: [decisions.md](decisions.md). Черновик таблиц: [data-model.md](data-model.md).

## Сейчас (этап 1)

- SPA в `frontend/`: Vite, React 18, TypeScript 5.9 (`strict`), Tailwind CSS, shadcn/ui, React Router, TanStack Query.
- Вход через Supabase Auth: email и пароль. Формы регистрации нет. Сброс пароля — письмо со ссылкой на `/reset-password`.
- Клиент создаётся в `frontend/src/lib/supabase.ts` только из `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. Ключ `service_role` во фронтенд не попадает.
- Если переменные не заданы или в них остались заглушки, страница входа показывает инструкцию. Приложение при старте не падает.
- Сессию держит `AuthProvider`. Разделы закрыты `ProtectedRoute`: без сессии браузер уходит на `/login`.
- На широком экране разделы в боковом меню. На телефоне — нижняя панель и шторка со всем списком. В шапке email или имя и выход.

Схема Postgres, RLS и учёт оборудования — следующий этап. Миграции в этом изменении не добавлялись.

## Позже

- QR-код единицы, печать этикеток и сканер камерой телефона.
- При необходимости — оболочка Capacitor для Android.
