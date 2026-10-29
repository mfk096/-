export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string
          role: Database['public']['Enums']['app_role']
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name: string
          role?: Database['public']['Enums']['app_role']
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          full_name?: string
          role?: Database['public']['Enums']['app_role']
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      employees: {
        Row: {
          id: string
          full_name: string
          position: string | null
          phone: string | null
          profile_id: string | null
          is_archived: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          full_name: string
          position?: string | null
          phone?: string | null
          profile_id?: string | null
          is_archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          full_name?: string
          position?: string | null
          phone?: string | null
          profile_id?: string | null
          is_archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'employees_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      locations: {
        Row: {
          id: string
          parent_id: string | null
          name: string
          kind: string
          responsible_employee_id: string | null
          is_archived: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          parent_id?: string | null
          name: string
          kind: string
          responsible_employee_id?: string | null
          is_archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          parent_id?: string | null
          name?: string
          kind?: string
          responsible_employee_id?: string | null
          is_archived?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'locations_parent_id_fkey'
            columns: ['parent_id']
            isOneToOne: false
            referencedRelation: 'locations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'locations_responsible_employee_id_fkey'
            columns: ['responsible_employee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
        ]
      }
      nomenclature: {
        Row: {
          id: string
          code_prefix: string
          name: string
          manufacturer: string | null
          model: string | null
          category: string | null
          requires_verification: boolean
          verification_interval_months: number | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          code_prefix: string
          name: string
          manufacturer?: string | null
          model?: string | null
          category?: string | null
          requires_verification?: boolean
          verification_interval_months?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          code_prefix?: string
          name?: string
          manufacturer?: string | null
          model?: string | null
          category?: string | null
          requires_verification?: boolean
          verification_interval_months?: number | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      code_counters: {
        Row: {
          prefix: string
          last_number: number
        }
        Insert: {
          prefix: string
          last_number?: number
        }
        Update: {
          last_number?: number
        }
        Relationships: [
          {
            foreignKeyName: 'code_counters_prefix_fkey'
            columns: ['prefix']
            isOneToOne: true
            referencedRelation: 'nomenclature'
            referencedColumns: ['code_prefix']
          },
        ]
      }
      equipment: {
        Row: {
          id: string
          nomenclature_id: string
          code: string
          serial_number: string | null
          inventory_number: string | null
          status: Database['public']['Enums']['equipment_status']
          location_id: string | null
          last_verification_date: string | null
          next_verification_date: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          nomenclature_id: string
          code?: string
          serial_number?: string | null
          inventory_number?: string | null
          status?: Database['public']['Enums']['equipment_status']
          location_id?: string | null
          last_verification_date?: string | null
          next_verification_date?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          serial_number?: string | null
          inventory_number?: string | null
          status?: Database['public']['Enums']['equipment_status']
          location_id?: string | null
          last_verification_date?: string | null
          next_verification_date?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'equipment_nomenclature_id_fkey'
            columns: ['nomenclature_id']
            isOneToOne: false
            referencedRelation: 'nomenclature'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'equipment_location_id_fkey'
            columns: ['location_id']
            isOneToOne: false
            referencedRelation: 'locations'
            referencedColumns: ['id']
          },
        ]
      }
      movements: {
        Row: {
          id: string
          equipment_id: string
          from_location_id: string | null
          to_location_id: string | null
          moved_at: string
          moved_by: string
          comment: string | null
        }
        Insert: {
          id?: string
          equipment_id: string
          from_location_id?: string | null
          to_location_id?: string | null
          moved_at?: string
          moved_by?: string
          comment?: string | null
        }
        Update: {
          comment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'movements_equipment_id_fkey'
            columns: ['equipment_id']
            isOneToOne: false
            referencedRelation: 'equipment'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'movements_from_location_id_fkey'
            columns: ['from_location_id']
            isOneToOne: false
            referencedRelation: 'locations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'movements_to_location_id_fkey'
            columns: ['to_location_id']
            isOneToOne: false
            referencedRelation: 'locations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'movements_moved_by_fkey'
            columns: ['moved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      status_changes: {
        Row: {
          id: string
          equipment_id: string
          from_status: Database['public']['Enums']['equipment_status'] | null
          to_status: Database['public']['Enums']['equipment_status']
          changed_at: string
          changed_by: string
          comment: string | null
        }
        Insert: {
          id?: string
          equipment_id: string
          from_status?: Database['public']['Enums']['equipment_status'] | null
          to_status: Database['public']['Enums']['equipment_status']
          changed_at?: string
          changed_by?: string
          comment?: string | null
        }
        Update: {
          comment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'status_changes_equipment_id_fkey'
            columns: ['equipment_id']
            isOneToOne: false
            referencedRelation: 'equipment'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'status_changes_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      verifications: {
        Row: {
          id: string
          equipment_id: string
          verified_at: string
          result: Database['public']['Enums']['verification_result']
          next_due_at: string | null
          certificate_number: string | null
          file_path: string | null
          comment: string | null
        }
        Insert: {
          id?: string
          equipment_id: string
          verified_at: string
          result: Database['public']['Enums']['verification_result']
          next_due_at?: string | null
          certificate_number?: string | null
          file_path?: string | null
          comment?: string | null
        }
        Update: {
          verified_at?: string
          result?: Database['public']['Enums']['verification_result']
          next_due_at?: string | null
          certificate_number?: string | null
          file_path?: string | null
          comment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'verifications_equipment_id_fkey'
            columns: ['equipment_id']
            isOneToOne: false
            referencedRelation: 'equipment'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      locations_with_path: {
        Row: {
          id: string
          parent_id: string | null
          name: string
          kind: string
          responsible_employee_id: string | null
          is_archived: boolean
          created_at: string
          updated_at: string
          full_path: string | null
          effective_responsible_employee_id: string | null
          effective_responsible_name: string | null
          responsible_source_location_id: string | null
          responsible_source_name: string | null
          responsible_is_inherited: boolean
          effective_responsible_archived: boolean
          equipment_count: number
          direct_equipment_count: number
          child_count: number
        }
        Relationships: []
      }
      employees_directory: {
        Row: {
          id: string
          full_name: string
          position: string | null
          phone: string | null
          profile_id: string | null
          is_archived: boolean
          created_at: string
          updated_at: string
          profile_name: string | null
          location_count: number
        }
        Relationships: []
      }
      nomenclature_with_counts: {
        Row: {
          id: string
          code_prefix: string
          name: string
          manufacturer: string | null
          model: string | null
          category: string | null
          requires_verification: boolean
          verification_interval_months: number | null
          notes: string | null
          created_at: string
          updated_at: string
          equipment_count: number
        }
        Relationships: []
      }
      equipment_list: {
        Row: {
          id: string
          code: string
          serial_number: string | null
          inventory_number: string | null
          status: Database['public']['Enums']['equipment_status']
          location_id: string | null
          nomenclature_id: string
          last_verification_date: string | null
          next_verification_date: string | null
          notes: string | null
          created_at: string
          updated_at: string
          nomenclature_name: string
          code_prefix: string
          manufacturer: string | null
          model: string | null
          category: string | null
          requires_verification: boolean
          verification_interval_months: number | null
          location_path: string | null
          location_responsible_name: string | null
          location_responsible_inherited: boolean
          location_responsible_source_name: string | null
        }
        Relationships: []
      }
      movement_history: {
        Row: {
          id: string
          equipment_id: string
          from_location_id: string | null
          to_location_id: string | null
          moved_at: string
          moved_by: string
          comment: string | null
          from_path: string | null
          to_path: string | null
          moved_by_name: string
        }
        Relationships: []
      }
      status_change_history: {
        Row: {
          id: string
          equipment_id: string
          from_status: Database['public']['Enums']['equipment_status'] | null
          to_status: Database['public']['Enums']['equipment_status']
          changed_at: string
          changed_by: string
          comment: string | null
          changed_by_name: string
        }
        Relationships: []
      }
      journal_events: {
        Row: {
          id: string
          event_kind: string
          occurred_at: string
          equipment_id: string
          equipment_code: string
          nomenclature_id: string
          nomenclature_name: string
          actor_id: string
          actor_name: string
          comment: string | null
          from_location_id: string | null
          to_location_id: string | null
          from_path: string | null
          to_path: string | null
          from_status: Database['public']['Enums']['equipment_status'] | null
          to_status: Database['public']['Enums']['equipment_status'] | null
          location_scope: string[]
          status_scope: Database['public']['Enums']['equipment_status'][]
        }
        Relationships: []
      }
      equipment_status_counts: {
        Row: {
          status: Database['public']['Enums']['equipment_status']
          equipment_count: number
        }
        Relationships: []
      }
      equipment_verification_queue: {
        Row: {
          id: string
          code: string
          status: Database['public']['Enums']['equipment_status']
          serial_number: string | null
          inventory_number: string | null
          location_id: string | null
          nomenclature_id: string
          last_verification_date: string | null
          next_verification_date: string | null
          nomenclature_name: string
          code_prefix: string
          verification_interval_months: number | null
          location_path: string | null
        }
        Relationships: []
      }
      verification_journal: {
        Row: {
          id: string
          equipment_id: string
          verified_at: string
          result: Database['public']['Enums']['verification_result']
          next_due_at: string | null
          certificate_number: string | null
          file_path: string | null
          comment: string | null
          equipment_code: string
          status: Database['public']['Enums']['equipment_status']
          nomenclature_id: string
          location_id: string | null
          nomenclature_name: string
          code_prefix: string
          location_path: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      move_equipment: {
        Args: {
          equipment_id: string
          to_location_id: string | null
          comment: string | null
        }
        Returns: Database['public']['Tables']['equipment']['Row']
      }
      change_equipment_status: {
        Args: {
          equipment_id: string
          new_status: Database['public']['Enums']['equipment_status']
          comment: string | null
        }
        Returns: Database['public']['Tables']['equipment']['Row']
      }
      current_role: {
        Args: Record<string, never>
        Returns: Database['public']['Enums']['app_role']
      }
      location_full_path: {
        Args: {
          p_location_id: string
        }
        Returns: string
      }
      effective_responsible_employee_id: {
        Args: {
          p_location_id: string
        }
        Returns: string
      }
      location_responsible_source: {
        Args: {
          p_location_id: string
        }
        Returns: {
          employee_id: string
          source_location_id: string
        }[]
      }
      move_location: {
        Args: {
          location_id: string
          new_parent_id: string | null
        }
        Returns: Database['public']['Tables']['locations']['Row']
      }
      move_equipment_bulk: {
        Args: {
          equipment_ids: string[]
          to_location_id: string | null
          comment: string | null
        }
        Returns: Database['public']['Tables']['equipment']['Row'][]
      }
      change_equipment_status_bulk: {
        Args: {
          equipment_ids: string[]
          new_status: Database['public']['Enums']['equipment_status']
          comment: string | null
        }
        Returns: Database['public']['Tables']['equipment']['Row'][]
      }
      location_ancestor_ids: {
        Args: {
          p_location_id: string
        }
        Returns: string[]
      }
      verification_summary: {
        Args: {
          p_soon_days?: number
        }
        Returns: {
          overdue: number
          soon: number
          ok: number
          no_data: number
        }[]
      }
      import_nomenclature: {
        Args: {
          p_rows: Json
        }
        Returns: Json
      }
      import_locations: {
        Args: {
          p_rows: Json
        }
        Returns: Json
      }
      import_employees: {
        Args: {
          p_rows: Json
        }
        Returns: Json
      }
      import_equipment: {
        Args: {
          p_rows: Json
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: 'admin' | 'editor' | 'viewer'
      equipment_status: 'in_work' | 'on_verification' | 'in_repair' | 'written_off' | 'reserve'
      verification_result: 'passed' | 'failed'
    }
    CompositeTypes: Record<string, never>
  }
}

export type AppRole = Database['public']['Enums']['app_role']
export type EquipmentStatus = Database['public']['Enums']['equipment_status']
export type NomenclatureRow = Database['public']['Views']['nomenclature_with_counts']['Row']
export type EquipmentListRow = Database['public']['Views']['equipment_list']['Row']
export type LocationPathRow = Database['public']['Views']['locations_with_path']['Row']
export type EmployeeDirectoryRow = Database['public']['Views']['employees_directory']['Row']
export type MovementHistoryRow = Database['public']['Views']['movement_history']['Row']
export type StatusHistoryRow = Database['public']['Views']['status_change_history']['Row']
export type JournalEventRow = Database['public']['Views']['journal_events']['Row']
export type EquipmentStatusCountRow = Database['public']['Views']['equipment_status_counts']['Row']
export type VerificationQueueRow =
  Database['public']['Views']['equipment_verification_queue']['Row']
export type VerificationJournalRow = Database['public']['Views']['verification_journal']['Row']
export type ProfileRow = Database['public']['Tables']['profiles']['Row']
