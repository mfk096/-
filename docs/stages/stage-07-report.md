# Отчёт этапа 7

Релиз 1.0: тестовый хостинг, APK, пользователи и правки владельца по местам, префиксу и обязательным полям единицы. Миграции до `20261029121500` включительно не менялись. На боевой Supabase этот этап ничего не отправлял.

Pull request: https://github.com/mfk096/-/pull/9 (база `main`).

## Сделано

- Workflow `.github/workflows/deploy-pages.yml`: push в `main` и ручной запуск, `npm ci`, сборка с `base` из GitHub Pages (`/-/`), `VITE_SUPABASE_*` и `VITE_PUBLIC_APP_URL` из repository variables. Прямые ссылки: `frontend/public/404.html` по схеме spa-github-pages, `index.html` возвращает адрес. HashRouter не использовался, чтобы QR был обычной ссылкой.
- QR и письмо сброса пароля смотрят на публичный адрес. По умолчанию `https://mfk096.github.io/-`. В APK страница открыта как localhost, поэтому туда тоже подставляется этот адрес, если переменная пустая.
- Debug APK: в workflow Android адрес тестового Supabase по умолчанию и anon key из тех же variables. Файл выкладывается в pre-release `latest-apk`. Тег `v1.0.0` создаётся один раз на `main`.
- Раздел «Пользователи» только для admin. Edge Function `supabase/functions/manage-users`: сначала приглашение письмом, если почта не ушла — временный пароль один раз на экране. Роль и отключение идут через RLS. Свой пароль — `/password`.
- Места: тип уровня убран из интерфейса, колонка `kind` может быть пустой. Есть перенос родителя и «вставить уровень выше».
- Смена префикса: `rename_nomenclature_prefix`, одна транзакция, только admin. Коды всех единиц, включая списанные, становятся `НОВЫЙ-тот же номер`. Счётчик переезжает. Старые коды в `equipment_former_codes` и больше не выдаются. Скан, поиск и адрес со старым кодом открывают единицу и показывают «Этикетка устарела…» с кнопкой печати.
- Новая и изменяемая единица требует место. Уже лежащие строки с пустым местом миграция не переписывает. Импорт без места — ошибка строки. Склад — место плюс статус «Резерв».
- Инструкции: [user-guide.md](../user-guide.md), [test-checklist.md](../test-checklist.md).

## Сайт и APK

Адрес сайта: https://mfk096.github.io/-/

На момент отчёта по этому адресу ответ GitHub **404**. Страница входа не открывается: Pages не включены, а у агента нет права создать сайт и переменные (`POST /repos/mfk096/-/pages` и `gh variable set` вернули `403 Resource not accessible by integration`). Anon key в облачном проекте `wehdetsnxqbfjrfhopzh` есть (legacy anon, не отключён), в репозиторий он не записан.

Ссылка на APK: https://github.com/mfk096/-/releases/download/latest-apk/app-debug.apk

Файла ещё нет: релиз создаёт workflow после попадания в `main`. До этого скачивание не работает.

## Миграции по порядку

Уже применённые файлы `20261029120000` … `20261029121500` не менялись.

Новые:

1. `supabase/migrations/20261029121600_profiles_admin.sql`
2. `supabase/migrations/20261029121700_prefix_places_labels.sql`

Оба идемпотентны. `anon` не получает `EXECUTE`. `storage.objects` не меняется.

## Что сделать владельцу, по шагам

1. GitHub → репозиторий `mfk096/-` → **Settings → Secrets and variables → Actions → Variables → New repository variable**. Три переменные, не Secrets:
   - `VITE_SUPABASE_URL` = `https://wehdetsnxqbfjrfhopzh.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = Supabase → Project Settings → API Keys → ключ **anon** / legacy anon. Не `service_role`.
   - `VITE_PUBLIC_APP_URL` = `https://mfk096.github.io/-`
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.** Сохранить.
3. После слияния этого PR в `main` дождаться зелёных **Deploy GitHub Pages** и **Android APK**. Если переменные добавили позже: Actions → нужный workflow → **Run workflow** на `main`.
4. Проверить, что https://mfk096.github.io/-/ показывает вход, и что APK скачивается по ссылке выше.
5. Supabase → **Authentication → URL Configuration**:
   - Site URL: `https://mfk096.github.io/-/`
   - Redirect URLs: `https://mfk096.github.io/-/**`
6. Применить к облаку, по порядку, два новых файла миграций (SQL Editor или ваш обычный способ). Старые файлы повторно не гонять, они и так идемпотентны, но достаточно новых.
7. Опубликовать функцию пользователей. Service role в команду не подставлять, Supabase даёт его функции сам:

```bash
npx supabase login
npx supabase functions deploy manage-users --project-ref wehdetsnxqbfjrfhopzh
```

По желанию, чтобы письмо вело на сайт, а не на адрес по умолчанию из кода функции:

```bash
npx supabase secrets set PUBLIC_APP_URL=https://mfk096.github.io/- --project-ref wehdetsnxqbfjrfhopzh
```

8. Authentication → Providers → Email: самостоятельная регистрация выключена. Приглашение идёт через функцию, не через открытую форму.

## Проверено

`./supabase/tests/run.sh` на локальном Postgres 16, включая прежние правила и новые: перепись кодов со списанной единицей, старый номер не выдаётся снова, вставка уровня, отказ единицы без места, anon не вызывает новые функции.

`npm test`, `npm run lint`, `npm run typecheck`, `npm run build` во `frontend/`.

Живой сайт и APK с телефона здесь не открывались: Pages и релиз создаются только после шагов владельца и зелёного прогона на `main`.

## Спорные моменты

- QR — ссылка на тестовый сайт, не голый код. Так камера телефона открывает карточку. Сканер по-прежнему понимает и голый код. После смены префикса старая наклейка находится через таблицу старых кодов, но её просят заменить.
- Счётчик переезжает вместе с префиксом. Старый префикс, если его займут заново, продолжает нумерацию после уже использованных номеров, а не с нуля.
- `locations.kind` не удалён, только перестал быть обязательным и исчез из экранов. Старые подписи в базе остаются.
- Приглашение сначала шлёт письмо. Временный пароль — запасной путь, если SMTP или разрешённый адрес письма не настроены. Пароль показывается один раз.
- Единица, которая уже лежит без места, при смене префикса не требует место. Любое другое сохранение такой строки место потребует.
- Debug APK не подписан магазином. Release без keystore по-прежнему не собирается.
