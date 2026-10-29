import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { EmployeeDirectoryRow, LocationPathRow } from '@/types/database'

export function useLocations(enabled = true) {
  return useQuery({
    queryKey: ['locations'],
    enabled: Boolean(supabase) && enabled,
    queryFn: async (): Promise<LocationPathRow[]> => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('locations_with_path')
        .select('*')
        .order('full_path')
      if (error) throw error
      return data ?? []
    },
  })
}

export function useEmployees(enabled = true) {
  return useQuery({
    queryKey: ['employees'],
    enabled: Boolean(supabase) && enabled,
    queryFn: async (): Promise<EmployeeDirectoryRow[]> => {
      const client = supabase
      if (!client) throw new Error('Supabase не настроен.')
      const { data, error } = await client
        .from('employees_directory')
        .select('*')
        .order('full_name')
      if (error) throw error
      return data ?? []
    },
  })
}
