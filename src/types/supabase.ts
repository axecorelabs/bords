export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      board_documents: {
        Row: {
          background_blur_level: number | null
          background_color: string | null
          background_image: string | null
          background_opacity: number | null
          background_overlay: boolean | null
          background_overlay_color: string | null
          background_type: string | null
          background_value: string | null
          checklists: Json
          comments: Json
          connection_line_settings: Json
          connections: Json
          content_hash: string | null
          context_type: string
          created_at: string
          custom_background_image: string | null
          drawings: Json
          grid_settings: Json
          id: string
          item_ids: Json
          kanban_boards: Json
          last_synced_at: string | null
          local_board_id: string
          media_items: Json
          native_tldraw: Json | null
          organization_id: string | null
          owner_id: string
          public_url: string | null
          reminders: Json
          share_token: string | null
          shared_with: Json
          sticky_notes: Json
          tables: Json
          text_elements: Json
          theme_settings: Json
          title: string
          updated_at: string
          version: number
          visibility: string
          workspace_id: string | null
          z_index_data: Json
        }
        Insert: {
          background_blur_level?: number | null
          background_color?: string | null
          background_image?: string | null
          background_opacity?: number | null
          background_overlay?: boolean | null
          background_overlay_color?: string | null
          background_type?: string | null
          background_value?: string | null
          checklists?: Json
          comments?: Json
          connection_line_settings?: Json
          connections?: Json
          content_hash?: string | null
          context_type?: string
          created_at?: string
          custom_background_image?: string | null
          drawings?: Json
          grid_settings?: Json
          id?: string
          item_ids?: Json
          kanban_boards?: Json
          last_synced_at?: string | null
          local_board_id: string
          media_items?: Json
          native_tldraw?: Json | null
          organization_id?: string | null
          owner_id: string
          public_url?: string | null
          reminders?: Json
          share_token?: string | null
          shared_with?: Json
          sticky_notes?: Json
          tables?: Json
          text_elements?: Json
          theme_settings?: Json
          title?: string
          updated_at?: string
          version?: number
          visibility?: string
          workspace_id?: string | null
          z_index_data?: Json
        }
        Update: {
          background_blur_level?: number | null
          background_color?: string | null
          background_image?: string | null
          background_opacity?: number | null
          background_overlay?: boolean | null
          background_overlay_color?: string | null
          background_type?: string | null
          background_value?: string | null
          checklists?: Json
          comments?: Json
          connection_line_settings?: Json
          connections?: Json
          content_hash?: string | null
          context_type?: string
          created_at?: string
          custom_background_image?: string | null
          drawings?: Json
          grid_settings?: Json
          id?: string
          item_ids?: Json
          kanban_boards?: Json
          last_synced_at?: string | null
          local_board_id?: string
          media_items?: Json
          native_tldraw?: Json | null
          organization_id?: string | null
          owner_id?: string
          public_url?: string | null
          reminders?: Json
          share_token?: string | null
          shared_with?: Json
          sticky_notes?: Json
          tables?: Json
          text_elements?: Json
          theme_settings?: Json
          title?: string
          updated_at?: string
          version?: number
          visibility?: string
          workspace_id?: string | null
          z_index_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "board_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_documents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      board_metadata: {
        Row: {
          background_color: string | null
          background_image: string | null
          board_id: string
          created_at: string
          deadlines: Json | null
          fingerprints: Json | null
          id: string
          item_counts: Json | null
          last_modified_at: string | null
          last_modified_by: string | null
          mentions: Json | null
          owner_id: string
          schema_version: number | null
          searchable_text: Json | null
          title: string
        }
        Insert: {
          background_color?: string | null
          background_image?: string | null
          board_id: string
          created_at?: string
          deadlines?: Json | null
          fingerprints?: Json | null
          id?: string
          item_counts?: Json | null
          last_modified_at?: string | null
          last_modified_by?: string | null
          mentions?: Json | null
          owner_id: string
          schema_version?: number | null
          searchable_text?: Json | null
          title?: string
        }
        Update: {
          background_color?: string | null
          background_image?: string | null
          board_id?: string
          created_at?: string
          deadlines?: Json | null
          fingerprints?: Json | null
          id?: string
          item_counts?: Json | null
          last_modified_at?: string | null
          last_modified_by?: string | null
          mentions?: Json | null
          owner_id?: string
          schema_version?: number | null
          searchable_text?: Json | null
          title?: string
        }
        Relationships: []
      }
      bord_access_list: {
        Row: {
          bord_id: string
          created_at: string
          id: string
          permission: string
          user_id: string
        }
        Insert: {
          bord_id: string
          created_at?: string
          id?: string
          permission: string
          user_id: string
        }
        Update: {
          bord_id?: string
          created_at?: string
          id?: string
          permission?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bord_access_list_bord_id_fkey"
            columns: ["bord_id"]
            isOneToOne: false
            referencedRelation: "bords"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bord_access_list_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bord_members: {
        Row: {
          bord_id: string
          can_manage_employees: boolean
          can_publish: boolean
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          bord_id: string
          can_manage_employees?: boolean
          can_publish?: boolean
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          bord_id?: string
          can_manage_employees?: boolean
          can_publish?: boolean
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bord_members_bord_id_fkey"
            columns: ["bord_id"]
            isOneToOne: false
            referencedRelation: "bords"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bord_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bords: {
        Row: {
          context_type: string
          created_at: string
          id: string
          last_published_at: string | null
          local_board_id: string
          organization_id: string | null
          owner_id: string
          title: string
          updated_at: string
        }
        Insert: {
          context_type?: string
          created_at?: string
          id?: string
          last_published_at?: string | null
          local_board_id: string
          organization_id?: string | null
          owner_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          context_type?: string
          created_at?: string
          id?: string
          last_published_at?: string | null
          local_board_id?: string
          organization_id?: string | null
          owner_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bords_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bords_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          board_id: string
          created_at: string
          ended_at: string | null
          id: string
          metadata: Json | null
          participants: Json | null
          peak_participant_count: number
          room_name: string
          started_at: string
          started_by: Json
          status: string
          updated_at: string
        }
        Insert: {
          board_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          metadata?: Json | null
          participants?: Json | null
          peak_participant_count?: number
          room_name: string
          started_at?: string
          started_by?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          board_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          metadata?: Json | null
          participants?: Json | null
          peak_participant_count?: number
          room_name?: string
          started_at?: string
          started_by?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      employee_memberships: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friends: {
        Row: {
          created_at: string
          email: string | null
          friend_user_id: string
          id: string
          nickname: string | null
          owner_id: string
          status: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          friend_user_id: string
          id?: string
          nickname?: string | null
          owner_id: string
          status?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          friend_user_id?: string
          id?: string
          nickname?: string | null
          owner_id?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friends_friend_user_id_fkey"
            columns: ["friend_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friends_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friends_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          bord_id: string | null
          collaborator_role: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organization_id: string
          role: string
          status: string
          token: string
        }
        Insert: {
          bord_id?: string | null
          collaborator_role?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          organization_id: string
          role: string
          status?: string
          token: string
        }
        Update: {
          bord_id?: string | null
          collaborator_role?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organization_id?: string
          role?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_bord_id_fkey"
            columns: ["bord_id"]
            isOneToOne: false
            referencedRelation: "bords"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          metadata: Json | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          metadata?: Json | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          metadata?: Json | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          metadata: Json
          paid_at: string | null
          paystack_access_code: string | null
          paystack_reference: string | null
          plan_id: string | null
          status: string
          subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          paid_at?: string | null
          paystack_access_code?: string | null
          paystack_reference?: string | null
          plan_id?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json
          paid_at?: string | null
          paystack_access_code?: string | null
          paystack_reference?: string | null
          plan_id?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          features: string[]
          id: string
          interval: string
          is_active: boolean
          max_boards: number
          max_collaborators: number
          max_organizations: number
          max_tasks_per_board: number
          name: string
          price: number
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          features?: string[]
          id?: string
          interval?: string
          is_active?: boolean
          max_boards?: number
          max_collaborators?: number
          max_organizations?: number
          max_tasks_per_board?: number
          name: string
          price?: number
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          features?: string[]
          id?: string
          interval?: string
          is_active?: boolean
          max_boards?: number
          max_collaborators?: number
          max_organizations?: number
          max_tasks_per_board?: number
          name?: string
          price?: number
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          first_name: string
          id: string
          image: string | null
          last_login_at: string | null
          last_login_ip: unknown
          last_name: string
          lock_until: string | null
          login_attempts: number
          mfa_enabled: boolean
          provider: string
          provider_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          first_name?: string
          id: string
          image?: string | null
          last_login_at?: string | null
          last_login_ip?: unknown
          last_name?: string
          lock_until?: string | null
          login_attempts?: number
          mfa_enabled?: boolean
          provider?: string
          provider_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          image?: string | null
          last_login_at?: string | null
          last_login_ip?: unknown
          last_name?: string
          lock_until?: string | null
          login_attempts?: number
          mfa_enabled?: boolean
          provider?: string
          provider_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      publish_snapshots: {
        Row: {
          bord_id: string
          id: string
          new_assignments: number
          published_at: string
          published_by: string
          reassignments: number
          unassignments: number
          version_number: number
        }
        Insert: {
          bord_id: string
          id?: string
          new_assignments?: number
          published_at?: string
          published_by: string
          reassignments?: number
          unassignments?: number
          version_number: number
        }
        Update: {
          bord_id?: string
          id?: string
          new_assignments?: number
          published_at?: string
          published_by?: string
          reassignments?: number
          unassignments?: number
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "publish_snapshots_bord_id_fkey"
            columns: ["bord_id"]
            isOneToOne: false
            referencedRelation: "bords"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publish_snapshots_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sent_reminders: {
        Row: {
          board_doc_id: string
          id: string
          interval_label: string
          item_id: string
          key: string
          recipient_email: string
          sent_at: string
          sent_by: string
          source: string
        }
        Insert: {
          board_doc_id: string
          id?: string
          interval_label: string
          item_id: string
          key: string
          recipient_email: string
          sent_at?: string
          sent_by: string
          source: string
        }
        Update: {
          board_doc_id?: string
          id?: string
          interval_label?: string
          item_id?: string
          key?: string
          recipient_email?: string
          sent_at?: string
          sent_by?: string
          source?: string
        }
        Relationships: []
      }
      subscription_history: {
        Row: {
          action: string
          created_at: string
          from_plan_id: string | null
          id: string
          metadata: Json
          subscription_id: string | null
          to_plan_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          from_plan_id?: string | null
          id?: string
          metadata?: Json
          subscription_id?: string | null
          to_plan_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          from_plan_id?: string | null
          id?: string
          metadata?: Json
          subscription_id?: string | null
          to_plan_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_history_from_plan_id_fkey"
            columns: ["from_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_history_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_history_to_plan_id_fkey"
            columns: ["to_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          canceled_at: string | null
          cancellation_reason: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          end_date: string | null
          id: string
          paystack_customer_code: string | null
          paystack_email_token: string | null
          paystack_subscription_code: string | null
          plan_id: string
          start_date: string
          status: string
          trial_end: string | null
          trial_start: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          canceled_at?: string | null
          cancellation_reason?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          end_date?: string | null
          id?: string
          paystack_customer_code?: string | null
          paystack_email_token?: string | null
          paystack_subscription_code?: string | null
          plan_id: string
          start_date?: string
          status?: string
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          canceled_at?: string | null
          cancellation_reason?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          end_date?: string | null
          id?: string
          paystack_customer_code?: string | null
          paystack_email_token?: string | null
          paystack_subscription_code?: string | null
          plan_id?: string
          start_date?: string
          status?: string
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignments: {
        Row: {
          assigned_by: string
          assigned_to: string
          available_columns: Json | null
          bord_id: string | null
          column_id: string | null
          column_title: string | null
          completed_at: string | null
          content: string
          context_type: string
          created_at: string
          due_date: string | null
          employee_updates: Json | null
          execution_note: string | null
          id: string
          is_deleted: boolean
          organization_id: string | null
          priority: string
          published_at: string | null
          source_id: string
          source_type: string
          status: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          assigned_by: string
          assigned_to: string
          available_columns?: Json | null
          bord_id?: string | null
          column_id?: string | null
          column_title?: string | null
          completed_at?: string | null
          content: string
          context_type?: string
          created_at?: string
          due_date?: string | null
          employee_updates?: Json | null
          execution_note?: string | null
          id?: string
          is_deleted?: boolean
          organization_id?: string | null
          priority?: string
          published_at?: string | null
          source_id: string
          source_type: string
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          assigned_by?: string
          assigned_to?: string
          available_columns?: Json | null
          bord_id?: string | null
          column_id?: string | null
          column_title?: string | null
          completed_at?: string | null
          content?: string
          context_type?: string
          created_at?: string
          due_date?: string | null
          employee_updates?: Json | null
          execution_note?: string | null
          id?: string
          is_deleted?: boolean
          organization_id?: string | null
          priority?: string
          published_at?: string | null
          source_id?: string
          source_type?: string
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_bord_id_fkey"
            columns: ["bord_id"]
            isOneToOne: false
            referencedRelation: "bords"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      unpublished_change_tracker: {
        Row: {
          bord_id: string
          change_count: number
          id: string
          last_modified_at: string
        }
        Insert: {
          bord_id: string
          change_count?: number
          id?: string
          last_modified_at?: string
        }
        Update: {
          bord_id?: string
          change_count?: number
          id?: string
          last_modified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unpublished_change_tracker_bord_id_fkey"
            columns: ["bord_id"]
            isOneToOne: true
            referencedRelation: "bords"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          owner_id: string
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      yjs_documents: {
        Row: {
          board_id: string
          connected_clients: number
          created_at: string
          id: string
          last_modified_by: string | null
          state: string | null
          state_vector: string | null
          updated_at: string
          version: number
        }
        Insert: {
          board_id: string
          connected_clients?: number
          created_at?: string
          id?: string
          last_modified_by?: string | null
          state?: string | null
          state_vector?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          board_id?: string
          connected_clients?: number
          created_at?: string
          id?: string
          last_modified_by?: string | null
          state?: string | null
          state_vector?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: {
        Args: { p_token: string; p_user_id: string }
        Returns: Json
      }
      cleanup_sent_reminders: { Args: never; Returns: undefined }
      find_boards_with_deadlines: {
        Args: { p_deadline_before: string }
        Returns: {
          board_doc_id: string
          checklists: Json
          kanban_boards: Json
          local_board_id: string
          owner_email: string
          owner_id: string
          reminders: Json
        }[]
      }
      publish_board: {
        Args: {
          p_assignments?: Json
          p_bord_id: string
          p_published_by: string
          p_unassign_ids?: string[]
        }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
