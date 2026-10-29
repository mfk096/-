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

## Релиз 1.0

Релиз 1.0 — итог этапа 7: функции учёта из этапов 1–6, тестовый бесплатный хостинг веб-версии и APK для проверки.

До 1.0 разработка идёт автономно, по этапам 1–7 по порядку. После 1.0 работа итеративная: каждую доработку сначала согласуют с владельцем, проверку проводит тестировщик. Состав бэклога — в разделе ниже и в [docs/decisions.md](docs/decisions.md) (решение 24).

## Этапы до релиза 1.0

1. Базовая структура + авторизация Supabase + навигация
2. Номенклатура + единицы + уникальные коды
3. Места установки + ответственные
4. Перемещения и статусы
5. QR + сканер + печать этикеток + Android-приложение (Capacitor)
6. Поверки + Excel импорт/экспорт
7. Тестовый бесплатный хостинг веб-версии (для проверки владельцем) и выдача APK для проверки. Это и есть релиз 1.0

## Статус этапов

| Этап | Статус |
| --- | --- |
| 1. Каркас, авторизация, навигация | Сделан. Сборка зелёная. Неверный пароль на реальном проекте Supabase показывает русскую ошибку. Ключи в репозиторий не входят |
| 2. Номенклатура и единицы | Сделан. Миграции, RLS, коды, разделы «Номенклатура» и «Единицы». Боевой проект не менялся |
| 3. Места установки и ответственные | Сделан. Дерево мест, сотрудники, выбор места из дерева. Новая миграция в репозитории, на боевой проект не применялась |
| 4. Перемещения и статусы | Сделан. Журнал `/history`, массовые операции в списке единиц, лента на карточке, сводка на главной. Новая миграция в репозитории, на боевой проект не применялась |
| 5. QR, сканер, печать этикеток и Android | Сделан. QR содержит только код единицы. Этикетки, сканер, оболочка Capacitor и workflow debug APK. Новых миграций нет, боевой проект не менялся |
| 6. Поверки и Excel | Сделан. График `/verifications`, журнал на карточке, счётчики на главной, импорт и экспорт Excel. Новые миграции в репозитории, на боевой проект не применялись |
| 7. Релиз 1.0: тестовый хостинг и выдача APK | Не начат. Бесплатный хостинг веб-версии и APK, чтобы владелец мог проверить |

Отчёт этапа 1: [docs/stages/stage-01-report.md](docs/stages/stage-01-report.md). Отчёт этапа 2: [docs/stages/stage-02-report.md](docs/stages/stage-02-report.md). Отчёт этапа 3: [docs/stages/stage-03-report.md](docs/stages/stage-03-report.md). Отчёт этапа 4: [docs/stages/stage-04-report.md](docs/stages/stage-04-report.md). Отчёт этапа 5: [docs/stages/stage-05-report.md](docs/stages/stage-05-report.md). Отчёт этапа 6: [docs/stages/stage-06-report.md](docs/stages/stage-06-report.md). Формат Excel: [docs/excel-format.md](docs/excel-format.md). Как поставить Android: [docs/android.md](docs/android.md).

## После 1.0 (бэклог)

После релиза 1.0 эти пункты сами не начинаются. Каждую доработку согласуют с владельцем, затем её проверяет тестировщик.

- **Этап 8. Переезд на сервер завода.** Self-hosted Supabase и перенос данных. Только по отдельному распоряжению владельца.
- **Документы при перемещении на сотрудника.** Автоматически готовить акт приёма-передачи и служебную записку, когда оборудование перемещают на сотрудника. Печать и PDF по шаблонам завода, данные берутся из журнала перемещений. Для вёрстки нужны образцы этих документов от владельца.
- **Правки по итогам тестирования.** Доработки, которые появятся после проверки релиза 1.0.

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

Тот же адрес и anon key можно ввести на экране «Настройки подключения» (`/connection`), не правя `.env.local`. Локальная настройка перекрывает переменные окружения. Ключ `service_role` туда вводить нельзя.

## Android

Оболочка Capacitor лежит в `frontend/android`. Имя приложения — «Инвентаризация», пакет `ru.factory.inventory`. Debug APK собирает GitHub Actions (push в `main` и ручной запуск) и кладёт его в артефакты. Как скачать APK, поставить на телефон и указать сервер — в [docs/android.md](docs/android.md).

Локально, если установлен Android SDK:

```bash
cd frontend
npm run android:sync
cd android && ./gradlew assembleDebug
```

Готовый файл: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`. Keystore в репозиторий не кладётся. Release в Actions подписывается, только если заданы секреты `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` и `ANDROID_KEY_PASSWORD`.

## Миграции

Схема — файлы `supabase/migrations/*.sql`. Их применяют по порядку имени к пустому проекту. На боевой Supabase их накатывает координатор после ревью. Ключ `service_role` в репозиторий и во фронтенд не кладётся. Адрес и anon key по умолчанию берутся из окружения, на устройстве их можно заменить в настройках подключения. Этап 5 новых миграций не добавляет: единица ищется по уже существующему коду.

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
11. `supabase/migrations/20261029121000_locations_and_responsibles.sql`
12. `supabase/migrations/20261029121100_revoke_anon_functions.sql`
13. `supabase/migrations/20261029121200_journal_and_bulk.sql`
14. `supabase/migrations/20261029121300_verification_queue.sql` — очередь поверок, журнал и сводка
15. `supabase/migrations/20261029121400_verification_certificates.sql` — приватный бакет свидетельств и политики `storage.objects`
16. `supabase/migrations/20261029121500_excel_import.sql` — атомарный импорт номенклатуры, мест, сотрудников и единиц

В облаке держат тестовые данные. Реальные данные завода появляются после переезда на self-hosted Supabase, см. [docs/decisions.md](docs/decisions.md).

Локально через Supabase CLI, если есть Docker:

```bash
supabase db reset
```

Команда применяет миграции и затем `supabase/seed.sql`. Seed только для разработки: завод, цеха, участки, Kyocera с префиксом `KYOC`, весы с поверкой. Учётные записи `demo.admin@plant.local`, `demo.editor@plant.local`, `demo.viewer@plant.local`, пароль `demo-local-password`.

Без Docker — пустой Postgres 15 или новее. На Supabase схема `auth` уже есть, схема `storage` тоже. Для голого Postgres сначала заглушка `supabase/tests/00_auth_stub.sql` (на боевой проект её не применяют). Она создаёт роли, `auth.uid()` и минимальные `storage.buckets` / `storage.objects`, чтобы миграция бакета проверялась локально:

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
