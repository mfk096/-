// Приглашение пользователя. service_role берётся из окружения функции на Supabase
// и в репозиторий не кладётся. Вызывать может только активный admin.
// Регистрация в проекте закрыта: inviteUserByEmail и createUser идут через Admin API.
// Если письмо не ушло, возвращаем временный пароль один раз.
// 1.0.1: создание по логину и паролю без почты (технический адрес <логин>@inventory.local,
// писем нет) и смена пароля любому пользователю (action: 'set_password').

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const roles = new Set(['admin', 'editor', 'viewer'])
const loginPattern = /^[a-z0-9._-]{3,32}$/
const technicalDomain = 'inventory.local'
const minPassword = 8

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function publicAppUrl(): string {
  const raw = (Deno.env.get('PUBLIC_APP_URL') ?? 'https://mfk096.github.io/-').trim()
  return raw.replace(/\/+$/, '') || 'https://mfk096.github.io/-'
}

function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  let body = ''
  for (const byte of bytes) body += alphabet[byte % alphabet.length]
  return body
}

function isAlreadyRegistered(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('already') ||
    lower.includes('registered') ||
    lower.includes('exists') ||
    lower.includes('duplicate')
  )
}

function safeMessage(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('eyj') || lower.includes('service_role') || lower.includes('secret')) {
    return 'Не удалось создать пользователя. Подробности есть в журнале функции.'
  }
  if (isAlreadyRegistered(message)) return 'Пользователь с таким email уже есть.'
  if (lower.includes('invalid') && lower.includes('email')) return 'Проверьте email: адрес выглядит неверно.'
  if (lower.includes('rate') || lower.includes('too many')) {
    return 'Слишком много запросов к почте. Подождите немного и повторите.'
  }
  if (lower.includes('10 активных') || lower.includes('не больше 10')) {
    return 'Одновременно может быть не больше 10 активных пользователей.'
  }
  return 'Не удалось создать пользователя. Проверьте email и повторите.'
}

async function findUserId(admin: SupabaseClient, email: string): Promise<string | null> {
  const needle = email.toLowerCase()
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(error.message)
    const found = data.users.find((user) => (user.email ?? '').toLowerCase() === needle)
    if (found) return found.id
    if (data.users.length < 200) return null
  }
  return null
}

async function ensureProfile(
  admin: SupabaseClient,
  userId: string,
  fullName: string,
  role: string,
  email: string,
) {
  const withEmail = await admin
    .from('profiles')
    .update({ full_name: fullName, role, email })
    .eq('id', userId)
  if (!withEmail.error) return

  const withoutEmail = await admin.from('profiles').update({ full_name: fullName, role }).eq('id', userId)
  if (withoutEmail.error) {
    throw new Error(withoutEmail.error.message)
  }
}

async function activeCount(admin: SupabaseClient): Promise<number> {
  const { count, error } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
  if (error) throw new Error('Не удалось посчитать пользователей.')
  return count ?? 0
}

async function setPassword(admin: SupabaseClient, payload: Record<string, unknown>) {
  const userId = typeof payload.user_id === 'string' ? payload.user_id : ''
  const password = typeof payload.password === 'string' ? payload.password : ''
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return json(400, { error: 'Не выбран пользователь.' })
  if (password.length < minPassword || password.length > 72) {
    return json(400, { error: `Пароль от ${minPassword} до 72 символов.` })
  }
  const updated = await admin.auth.admin.updateUserById(userId, { password })
  if (updated.error) {
    console.error('manage-users set_password', updated.error.message)
    return json(500, { error: 'Не удалось сменить пароль.' })
  }
  return json(200, { message: 'Пароль изменён. Передайте его человеку лично.' })
}

async function createByLogin(
  admin: SupabaseClient,
  login: string,
  realEmail: string,
  password: string,
  fullName: string,
  role: string,
) {
  if (!loginPattern.test(login)) {
    return json(400, { error: 'Логин: 3–32 символа, латиница, цифры, точка, дефис, подчёркивание.' })
  }
  if (password.length < minPassword || password.length > 72) {
    return json(400, { error: `Пароль от ${minPassword} до 72 символов.` })
  }
  if (realEmail && (!realEmail.includes('@') || !realEmail.slice(realEmail.indexOf('@')).includes('.'))) {
    return json(400, { error: 'Проверьте email или оставьте поле пустым.' })
  }
  if (realEmail.toLowerCase().endsWith(`@${technicalDomain}`)) {
    return json(400, { error: 'Этот адрес зарезервирован. Оставьте email пустым.' })
  }

  const { data: taken, error: takenError } = await admin
    .from('profiles')
    .select('id')
    .eq('username', login)
    .limit(1)
  if (takenError) return json(500, { error: 'Не удалось проверить логин.' })
  if ((taken ?? []).length > 0) return json(409, { error: 'Такой логин уже занят.' })

  const email = realEmail || `${login}@${technicalDomain}`
  if (await findUserId(admin, email)) {
    return json(409, { error: realEmail ? 'Пользователь с таким email уже есть.' : 'Такой логин уже занят.' })
  }
  if ((await activeCount(admin)) >= 10) {
    return json(400, { error: 'Одновременно может быть не больше 10 активных пользователей.' })
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, username: login },
  })
  if (created.error || !created.data.user) {
    const message = created.error?.message ?? ''
    if (isAlreadyRegistered(message)) return json(409, { error: 'Такой логин или email уже занят.' })
    return json(500, { error: safeMessage(message) })
  }
  const userId = created.data.user.id
  const updated = await admin
    .from('profiles')
    .update({ full_name: fullName, role, email, username: login })
    .eq('id', userId)
  if (updated.error) throw new Error(updated.error.message)

  return json(200, {
    delivery: 'login',
    login,
    message: `Учётная запись создана. Вход: логин «${login}» и заданный пароль.`,
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json(405, { error: 'Нужен запрос POST.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { error: 'На сервере не заданы ключи функции. service_role в репозиторий не кладётся.' })
  }

  const authHeader = request.headers.get('Authorization') ?? ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json(401, { error: 'Нет сессии. Войдите снова.' })
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json(401, { error: 'Сессия недействительна. Войдите снова.' })

  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileError) return json(500, { error: 'Не удалось проверить роль.' })
  if (!profile || profile.role !== 'admin' || !profile.is_active) {
    return json(403, { error: 'Управлять пользователями может только администратор.' })
  }

  let payload: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object') return json(400, { error: 'Пустой запрос.' })
    payload = parsed as Record<string, unknown>
  } catch {
    return json(400, { error: 'Не удалось прочитать запрос.' })
  }

  if (payload.action === 'set_password') {
    try {
      return await setPassword(admin, payload)
    } catch (error) {
      console.error('manage-users', error instanceof Error ? error.message : '')
      return json(500, { error: 'Не удалось сменить пароль.' })
    }
  }

  const email = typeof payload.email === 'string' ? payload.email.trim() : ''
  const fullName = typeof payload.full_name === 'string' ? payload.full_name.trim() : ''
  const role = typeof payload.role === 'string' ? payload.role : 'viewer'
  const login = typeof payload.login === 'string' ? payload.login.trim().toLowerCase() : ''

  if (login) {
    if (!fullName || fullName.length > 200) return json(400, { error: 'Укажите имя, не длиннее 200 символов.' })
    if (!roles.has(role)) return json(400, { error: 'Роль должна быть admin, editor или viewer.' })
    const password = typeof payload.password === 'string' ? payload.password : ''
    try {
      return await createByLogin(admin, login, email, password, fullName, role)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      console.error('manage-users', message)
      return json(500, { error: safeMessage(message) })
    }
  }

  if (!email.includes('@') || !email.slice(email.indexOf('@')).includes('.')) {
    return json(400, { error: 'Введите корректный email.' })
  }
  if (!fullName || fullName.length > 200) return json(400, { error: 'Укажите имя, не длиннее 200 символов.' })
  if (!roles.has(role)) return json(400, { error: 'Роль должна быть admin, editor или viewer.' })

  try {
    const existing = await findUserId(admin, email)
    if (existing) return json(409, { error: 'Пользователь с таким email уже есть.' })

    const { count, error: countError } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
    if (countError) return json(500, { error: 'Не удалось посчитать пользователей.' })
    if ((count ?? 0) >= 10) {
      return json(400, { error: 'Одновременно может быть не больше 10 активных пользователей.' })
    }

    const redirectTo = `${publicAppUrl()}/reset-password`
    const invited = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: fullName },
    })

    if (!invited.error && invited.data.user) {
      await ensureProfile(admin, invited.data.user.id, fullName, role, email)
      return json(200, {
        delivery: 'email',
        message:
          'Письмо со ссылкой отправлено. Человек открывает её и задаёт пароль. Если письма нет, проверьте «Спам» и адрес сайта в Supabase → Authentication → URL Configuration.',
      })
    }

    const inviteMessage = invited.error?.message ?? ''
    if (isAlreadyRegistered(inviteMessage)) {
      return json(409, { error: 'Пользователь с таким email уже есть.' })
    }

    const password = temporaryPassword()
    let userId = await findUserId(admin, email)
    if (userId) {
      const updated = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
      })
      if (updated.error) return json(500, { error: safeMessage(updated.error.message) })
    } else {
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (created.error || !created.data.user) {
        const message = created.error?.message ?? ''
        if (isAlreadyRegistered(message)) return json(409, { error: 'Пользователь с таким email уже есть.' })
        return json(500, { error: safeMessage(message) })
      }
      userId = created.data.user.id
    }

    await ensureProfile(admin, userId, fullName, role, email)
    return json(200, {
      delivery: 'temporary_password',
      temporary_password: password,
      message:
        'Письмо отправить не удалось. Передайте временный пароль лично. После входа его нужно сменить. Повторно пароль не показывается.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    console.error('manage-users', message)
    return json(500, { error: safeMessage(message) })
  }
})
