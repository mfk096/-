# Отчёт этапа 1

Каркас фронтенда, вход через Supabase и навигация. Схема базы и учёт оборудования не делались.

## Сделано

- `frontend/`: Vite, React 18, TypeScript 5.9 со `strict`, Tailwind CSS, shadcn/ui (button, input, label, card, sheet, dropdown-menu, avatar, sonner), React Router, TanStack Query, ESLint и Prettier. Алиас `@/` указывает на `src/`.
- Клиент Supabase читает только `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`. Пример — `frontend/.env.example`. Файлы `.env*` кроме `.env.example` в `.gitignore`. Если переменных нет или в них заглушки, страница входа объясняет, что заполнить, и приложение не падает.
- `/login`: email и пароль, без регистрации. Сброс пароля письмом на `/reset-password`. Выход из шапки. `AuthProvider`, `ProtectedRoute`, неавторизованных отправляет на `/login`.
- На широком экране боковое меню, на телефоне нижняя панель и шторка. Заглушки: `/`, `/units`, `/nomenclature`, `/locations`, `/verifications`, `/import-export`, `/scan`, `/labels`, `/users`. Интерфейс на русском.
- CI: `.github/workflows/ci.yml` — install, lint, typecheck, build.
- Журнал решений: `docs/decisions.md`. Черновик таблиц и ER-диаграмма: `docs/data-model.md`. Миграций нет.

Ключ `service_role` в репозиторий и во фронтенд не попадает. Локальный `.env.local` с anon key не коммитится.

## Проверено

- `npm run lint`, `npm run typecheck`, `npm run build` в `frontend/` проходят.
- `npm run dev` открывает `/login`. При заданных переменных форма входа есть, жёлтого предупреждения о пустой конфигурации нет.
- Неверный email и пароль на проекте Supabase: Auth отвечает `invalid_credentials` / `Invalid login credentials`, на форме красным написано «Неверный email или пароль.». Пользователи не создавались, `signUp` не вызывался.
- Успешный вход не проверялся: для него нужна учётная запись, а создавать её в этом этапе нельзя.

## Осталось

- Этап 2: миграции, RLS, номенклатура и единицы с атомарной выдачей кода.
- Дальше по порядку из README: места, перемещения и статусы, QR и печать этикеток, поверки и Excel, при необходимости Capacitor.
- Проверить успешный вход, выход и письмо сброса пароля, когда администратор заведёт первого пользователя и разрешит адрес `/reset-password` в URL Configuration.
