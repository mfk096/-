import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/providers/auth-context'
import type { AppRole, ProfileRow } from '@/types/database'

export function useProfile() {
  const { user } = useAuth()
  const userId = user?.id

  return useQuery({
    queryKey: ['profile', userId],
    enabled: Boolean(userId && supabase),
    queryFn: async (): Promise<ProfileRow | null> => {
      const client = supabase
      if (!client || !userId) throw new Error('Нет сессии')
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, email, role, is_active, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

export function useAccess() {
  const query = useProfile()
  const role: AppRole | null = query.data?.is_active ? query.data.role : null

  return {
    ...query,
    role,
    canEditEquipment: role === 'admin' || role === 'editor',
    canEditCatalogs: role === 'admin',
  }
}
