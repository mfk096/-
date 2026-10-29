# Этап 1: Каркас + авторизация

Этап 1: каркас фронтенда, авторизация Supabase, навигация.
Проект: система инвентаризации оборудования завода, репо mfk096/-. Структура папок по README.md.

В frontend/:
1. Vite + React 18 + TypeScript (strict), Tailwind, shadcn/ui (button, input, label, card, sheet, dropdown-menu, avatar, sonner), React Router, TanStack Query, ESLint + Prettier, алиас @/ на src/.
2. src/lib/supabase.ts: клиент из VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY; .env.example; .env* в .gitignore.
3. Вход по email и паролю без регистрации, выход, сброс пароля, AuthProvider, ProtectedRoute, редирект на /login.
4. Layout: боковое меню на ПК, Sheet или нижняя панель на телефоне; в шапке имя пользователя и кнопка выхода.
5. Заглушки маршрутов: /, /units, /nomenclature, /locations, /verifications, /import-export, /scan, /users.
6. Интерфейс на русском.
7. .github/workflows/ci.yml: install, lint, typecheck, build.
Схему БД и бизнес-логику не трогать, это этап 2.

Готово, когда: npm run dev работает, вход и выход работают с реальным Supabase, маршруты закрыты без входа, меню удобно на 375px и 1440px, CI зелёный. В конце короткий отчёт и обновлённый README.
