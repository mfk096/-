# Система инвентаризации оборудования

Веб-приложение для полного учёта оборудования IT-отдела завода (принтеры, весы, компьютеры, периферия и т.д.).

Журнал решений: [docs/decisions.md](docs/decisions.md). Черновик таблиц: [docs/data-model.md](docs/data-model.md).

## Основные возможности

- Справочник номенклатуры (типы/модели оборудования)
- Учёт конкретных единиц с читаемыми уникальными кодами и QR
- Иерархия мест установки + ответственные лица
- Статусы (В работе / На поверке / В ремонте / Списано / Резерв)
- График поверок (только для номенклатуры с флагом)
- Перемещения и полная история
- Импорт и экспорт Excel
- Сканирование QR с мобильного (позже Capacitor для Android)
- Многопользовательский режим (до 10 человек)

## Роли

Регистрация закрыта: учётные записи создаёт администратор, одновременно не больше 10 человек. Работать можно с компьютера и с телефона.

| Роль | Возможности |
| --- | --- |
| admin | Всё, включая пользователей и импорт |
| editor | Единицы, перемещения, статусы, поверки |
| viewer | Просмотр и экспорт |

## Стек

- Frontend: React + TypeScript + Tailwind + shadcn/ui + React Router + TanStack Query
- Backend / DB / Auth: Supabase
- QR: html5-qrcode или @zxing/library
- Мобильное: Capacitor, Android-приложение на этапе 5. К локальному серверу допускается cleartext HTTP

Во фронтенд попадает только anon key. Ключ `service_role` в клиент и в репозиторий не кладётся.

## Структура проекта

```
/
├── README.md
├── .gitignore
├── .github/workflows/ci.yml
├── docs/
│   ├── architecture.md
│   ├── data-model.md
│   ├── decisions.md
│   └── stages/
├── frontend/          # Vite + React приложение
└── supabase/
    ├── migrations/
    └── seed.sql
```

## Этапы разработки

1. Базовая структура + авторизация Supabase + навигация
2. Номенклатура + единицы + уникальные коды
3. Места установки + ответственные
4. Перемещения и статусы
5. QR + сканер + печать этикеток + Android-приложение (Capacitor)
6. Поверки + Excel импорт/экспорт
7. Переезд на локальный сервер завода (self-hosted Supabase), перенос данных, сборка APK

## Статус этапов

| Этап | Статус |
| --- | --- |
| 1. Каркас, авторизация, навигация | Сделан. Сборка зелёная. Неверный пароль на реальном проекте Supabase показывает русскую ошибку. Ключи в репозиторий не входят |
| 2. Номенклатура и единицы | Сделан. Миграции, RLS, коды, разделы «Номенклатура» и «Единицы». Боевой проект не менялся |
| 3. Места установки | Не начат |
| 4. Перемещения и статусы | Не начат |
| 5. QR, сканер, печать этикеток и Android | Не начат |
| 6. Поверки и Excel | Не начат |
| 7. Переезд на сервер завода и сборка APK | Не начат |

Отчёт этапа 1: [docs/stages/stage-01-report.md](docs/stages/stage-01-report.md). Отчёт этапа 2: [docs/stages/stage-02-report.md](docs/stages/stage-02-report.md).

## Локальный запуск

Нужен Node.js 22.

```bash
cd frontend
cp .env.example .env.local
```

В `.env.local` укажите `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` (Supabase → Project Settings → API, anon key). Если ключей ещё нет, файл можно не создавать: страница входа объяснит, что заполнить, и приложение не упадёт.

Дальше:

```bash
npm install
npm run dev
```

Проверки из каталога `frontend`:

```bash
npm run lint
npm run typecheck
npm run build
```

Вход по email и паролю появится после реальных ключей. Учётные записи создаются в Supabase, самостоятельной регистрации в интерфейсе нет. Адрес приложения для письма сброса пароля нужно разрешить в Authentication → URL Configuration, путь `/reset-password`.

## Миграции

Схема — файлы `supabase/migrations/*.sql`. Их применяют по порядку имени к пустому проекту. На боевой Supabase их накатывает координатор после ревью. Ключ `service_role` в репозиторий и во фронтенд не кладётся: адрес и anon key только в переменных окружения.

Порядок файлов:

1. `supabase/migrations/20261029120000_enums_and_updated_at.sql`
2. `supabase/migrations/20261029120100_tables.sql`
3. `supabase/migrations/20261029120200_codes_and_guards.sql`
4. `supabase/migrations/20261029120300_history.sql`
5. `supabase/migrations/20261029120400_verifications.sql`
6. `supabase/migrations/20261029120500_locations_and_views.sql`
7. `supabase/migrations/20261029120600_profiles_auth.sql`
8. `supabase/migrations/20261029120700_rls.sql`
9. `supabase/migrations/20261029120800_backfill_profiles.sql`
10. `supabase/migrations/20261029120900_lock_down_functions.sql` — снимает `EXECUTE` у триггерных функций и `backfill_profiles` с `anon` и `authenticated`. `current_role`, `move_equipment` и `change_equipment_status` остаются у `authenticated`.

В облаке держат тестовые данные. Реальные данные завода появляются после переезда на self-hosted Supabase, см. [docs/decisions.md](docs/decisions.md).

Локально через Supabase CLI, если есть Docker:

```bash
supabase db reset
```

Команда применяет миграции и затем `supabase/seed.sql`. Seed только для разработки: завод, цеха, участки, Kyocera с префиксом `KYOC`, весы с поверкой. Учётные записи `demo.admin@plant.local`, `demo.editor@plant.local`, `demo.viewer@plant.local`, пароль `demo-local-password`.

Без Docker — пустой Postgres 15 или новее. На Supabase схема `auth` уже есть. Для голого Postgres сначала заглушка `supabase/tests/00_auth_stub.sql` (на боевой проект её не применяют):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/00_auth_stub.sql
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

Проверка схемы:

```bash
./supabase/tests/run.sh
```

Нужен локальный Postgres от имени `postgres`. Скрипт создаёт пустые базы, прогоняет миграции, SQL-тесты и seed.

## Важные договорённости

- Уникальные коды читаемые (пример: `KYOC-001`). Номера **не переиспользуются**.
- Перемещение разрешено при любом статусе.
- Поля поверки появляются только у номенклатуры с флагом «Требует поверки».
- Интерфейс на русском языке.

Полный список — в [docs/decisions.md](docs/decisions.md).
