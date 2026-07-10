export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_attachments: {
        Row: {
          archived_at: string | null
          created_at: string
          extracted_text: string | null
          extracted_text_chars: number | null
          extracted_text_status: string
          id: string
          mime_type: string
          org_id: string
          original_filename: string
          owner_id: string
          size_bytes: number
          storage_path: string
          thread_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          extracted_text?: string | null
          extracted_text_chars?: number | null
          extracted_text_status?: string
          id?: string
          mime_type: string
          org_id?: string
          original_filename: string
          owner_id?: string
          size_bytes: number
          storage_path: string
          thread_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          extracted_text?: string | null
          extracted_text_chars?: number | null
          extracted_text_status?: string
          id?: string
          mime_type?: string
          org_id?: string
          original_filename?: string
          owner_id?: string
          size_bytes?: number
          storage_path?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_attachments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_attachments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_attachments_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "agent_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_automations: {
        Row: {
          archived_at: string | null
          condition: string | null
          created_at: string
          enabled: boolean
          id: string
          kind: string
          last_fired_at: string | null
          org_id: string
          owner_id: string
          prompt: string
          schedule: string | null
          timeout_s: number
          trigger_on: Json | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          condition?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          kind: string
          last_fired_at?: string | null
          org_id?: string
          owner_id?: string
          prompt: string
          schedule?: string | null
          timeout_s?: number
          trigger_on?: Json | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          condition?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          kind?: string
          last_fired_at?: string | null
          org_id?: string
          owner_id?: string
          prompt?: string
          schedule?: string | null
          timeout_s?: number
          trigger_on?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_automations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_automations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_dispatch_watermarks: {
        Row: {
          last_seen_at: string | null
          last_seen_id: string | null
          source: string
          updated_at: string
        }
        Insert: {
          last_seen_at?: string | null
          last_seen_id?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          last_seen_at?: string | null
          last_seen_id?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      agent_events: {
        Row: {
          created_at: string
          downvote_reason: string | null
          id: string
          org_id: string
          owner_id: string
          payload: Json | null
          rating: string | null
          run_id: string
          seq: number
          text: string | null
          tool_args_hash: string | null
          tool_name: string | null
          tool_status: string | null
          type: string
        }
        Insert: {
          created_at?: string
          downvote_reason?: string | null
          id?: string
          org_id?: string
          owner_id?: string
          payload?: Json | null
          rating?: string | null
          run_id: string
          seq: number
          text?: string | null
          tool_args_hash?: string | null
          tool_name?: string | null
          tool_status?: string | null
          type: string
        }
        Update: {
          created_at?: string
          downvote_reason?: string | null
          id?: string
          org_id?: string
          owner_id?: string
          payload?: Json | null
          rating?: string | null
          run_id?: string
          seq?: number
          text?: string | null
          tool_args_hash?: string | null
          tool_name?: string | null
          tool_status?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          created_at: string
          id: string
          last_progress_at: string | null
          org_id: string
          owner_id: string
          progress: number | null
          progress_step: string | null
          status: string
          thread_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_progress_at?: string | null
          org_id?: string
          owner_id?: string
          progress?: number | null
          progress_step?: string | null
          status?: string
          thread_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_progress_at?: string | null
          org_id?: string
          owner_id?: string
          progress?: number | null
          progress_step?: string | null
          status?: string
          thread_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "agent_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_threads: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          org_id: string
          owner_id: string
          pinned_at: string | null
          scope: Json | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          org_id?: string
          owner_id?: string
          pinned_at?: string | null
          scope?: Json | null
          title?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          org_id?: string
          owner_id?: string
          pinned_at?: string | null
          scope?: Json | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_threads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_threads_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_usage: {
        Row: {
          action: string
          cached_tokens: number
          completion_tokens: number
          cost: number
          created_at: string
          id: string
          model: string
          org_id: string
          owner_id: string
          prompt_tokens: number
          provider_cost_usd: number
          reasoning_tokens: number
          run_id: string | null
        }
        Insert: {
          action?: string
          cached_tokens?: number
          completion_tokens?: number
          cost?: number
          created_at?: string
          id?: string
          model: string
          org_id?: string
          owner_id?: string
          prompt_tokens?: number
          provider_cost_usd?: number
          reasoning_tokens?: number
          run_id?: string | null
        }
        Update: {
          action?: string
          cached_tokens?: number
          completion_tokens?: number
          cost?: number
          created_at?: string
          id?: string
          model?: string
          org_id?: string
          owner_id?: string
          prompt_tokens?: number
          provider_cost_usd?: number
          reasoning_tokens?: number
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_usage_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_usage_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_usage_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_line_items: {
        Row: {
          actual_amount: number
          budget_version_id: string
          budgeted_amount: number
          category: Database["public"]["Enums"]["budget_category"]
          description: string | null
          id: string
          org_id: string
        }
        Insert: {
          actual_amount?: number
          budget_version_id: string
          budgeted_amount?: number
          category: Database["public"]["Enums"]["budget_category"]
          description?: string | null
          id?: string
          org_id?: string
        }
        Update: {
          actual_amount?: number
          budget_version_id?: string
          budgeted_amount?: number
          category?: Database["public"]["Enums"]["budget_category"]
          description?: string | null
          id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_line_items_budget_version_id_fkey"
            columns: ["budget_version_id"]
            isOneToOne: false
            referencedRelation: "budget_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_line_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_versions: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          project_id: string
          status: Database["public"]["Enums"]["budget_status"]
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id?: string
          project_id: string
          status?: Database["public"]["Enums"]["budget_status"]
          version: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          project_id?: string
          status?: Database["public"]["Enums"]["budget_status"]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "budget_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          name: string
          org_id: string
          type: Database["public"]["Enums"]["company_type"]
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name: string
          org_id?: string
          type: Database["public"]["Enums"]["company_type"]
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          type?: Database["public"]["Enums"]["company_type"]
        }
        Relationships: [
          {
            foreignKeyName: "companies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          archived_at: string | null
          company_id: string
          created_at: string
          email: string | null
          full_name: string
          id: string
          notes: string | null
          org_id: string
          phone: string | null
          title: string | null
        }
        Insert: {
          archived_at?: string | null
          company_id: string
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          title?: string | null
        }
        Update: {
          archived_at?: string | null
          company_id?: string
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      credits: {
        Row: {
          amount: number
          created_at: string
          granted_by: string
          id: string
          note: string | null
          org_id: string
          owner_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          granted_by?: string
          id?: string
          note?: string | null
          org_id?: string
          owner_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          granted_by?: string
          id?: string
          note?: string | null
          org_id?: string
          owner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credits_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credits_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_activities: {
        Row: {
          body: string | null
          company_id: string | null
          contact_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["crm_activity_kind"]
          logged_by_id: string | null
          occurred_at: string
          org_id: string
          project_id: string | null
          subject: string | null
        }
        Insert: {
          body?: string | null
          company_id?: string | null
          contact_id: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["crm_activity_kind"]
          logged_by_id?: string | null
          occurred_at?: string
          org_id?: string
          project_id?: string | null
          subject?: string | null
        }
        Update: {
          body?: string | null
          company_id?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["crm_activity_kind"]
          logged_by_id?: string | null
          occurred_at?: string
          org_id?: string
          project_id?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_logged_by_id_fkey"
            columns: ["logged_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_reports: {
        Row: {
          created_at: string
          description: string | null
          id: string
          incident_date: string
          location: string | null
          org_id: string
          project_id: string | null
          reported_by: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          status: Database["public"]["Enums"]["incident_status"]
          type: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          incident_date: string
          location?: string | null
          org_id?: string
          project_id?: string | null
          reported_by?: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          status?: Database["public"]["Enums"]["incident_status"]
          type: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          incident_date?: string
          location?: string | null
          org_id?: string
          project_id?: string | null
          reported_by?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"]
          status?: Database["public"]["Enums"]["incident_status"]
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_reports_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          metadata: Json | null
          org_id: string
          owner_id: string
          read_at: string | null
          severity: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          org_id?: string
          owner_id?: string
          read_at?: string | null
          severity?: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          org_id?: string
          owner_id?: string
          read_at?: string | null
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_features: {
        Row: {
          enabled: boolean
          feature_key: string
          org_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled: boolean
          feature_key: string
          org_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          feature_key?: string
          org_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_features_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_features_updated_by_fkey"
            columns: ["updated_by"]
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
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      payment_files: {
        Row: {
          archived_at: string | null
          created_at: string
          file_path: string | null
          id: string
          org_id: string
          payment_id: string
          title: string | null
          uploaded_by_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          org_id?: string
          payment_id: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          org_id?: string
          payment_id?: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_files_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_files_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number | null
          created_at: string
          date: string | null
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          invoice_id: string | null
          org_id: string
          pay_number: string | null
          procurement_id: string
          reference_number: string | null
          status: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          date?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          invoice_id?: string | null
          org_id?: string
          pay_number?: string | null
          procurement_id: string
          reference_number?: string | null
          status?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          date?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          invoice_id?: string | null
          org_id?: string
          pay_number?: string | null
          procurement_id?: string
          reference_number?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "procurement_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_procurement_id_fkey"
            columns: ["procurement_id"]
            isOneToOne: false
            referencedRelation: "procurements"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stage_config: {
        Row: {
          org_id: string
          status: Database["public"]["Enums"]["project_status"]
          win_probability: number
        }
        Insert: {
          org_id?: string
          status: Database["public"]["Enums"]["project_status"]
          win_probability: number
        }
        Update: {
          org_id?: string
          status?: Database["public"]["Enums"]["project_status"]
          win_probability?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stage_config_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_operators: {
        Row: {
          granted_at: string
          granted_by: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_operators_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_operators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_doc_counters: {
        Row: {
          doc_date: string
          last_seq: number
          org_id: string
          prefix: string
        }
        Insert: {
          doc_date: string
          last_seq: number
          org_id?: string
          prefix: string
        }
        Update: {
          doc_date?: string
          last_seq?: number
          org_id?: string
          prefix?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_doc_counters_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_documents: {
        Row: {
          date: string | null
          id: string
          link: string | null
          org_id: string
          procurement_id: string
          reference_number: string | null
          status: Database["public"]["Enums"]["doc_status"]
          type: string
        }
        Insert: {
          date?: string | null
          id?: string
          link?: string | null
          org_id?: string
          procurement_id: string
          reference_number?: string | null
          status?: Database["public"]["Enums"]["doc_status"]
          type: string
        }
        Update: {
          date?: string | null
          id?: string
          link?: string | null
          org_id?: string
          procurement_id?: string
          reference_number?: string | null
          status?: Database["public"]["Enums"]["doc_status"]
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_documents_procurement_id_fkey"
            columns: ["procurement_id"]
            isOneToOne: false
            referencedRelation: "procurements"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_invoice_files: {
        Row: {
          archived_at: string | null
          created_at: string
          file_path: string | null
          id: string
          invoice_id: string
          org_id: string
          title: string | null
          uploaded_by_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          invoice_id: string
          org_id?: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          invoice_id?: string
          org_id?: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_invoice_files_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "procurement_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_invoice_files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_invoice_files_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_invoices: {
        Row: {
          amount: number | null
          created_at: string
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          invoice_date: string | null
          org_id: string
          po_id: string | null
          procurement_id: string
          reference_number: string | null
          status: Database["public"]["Enums"]["procurement_invoice_status"]
          vi_number: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          invoice_date?: string | null
          org_id?: string
          po_id?: string | null
          procurement_id: string
          reference_number?: string | null
          status: Database["public"]["Enums"]["procurement_invoice_status"]
          vi_number?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          invoice_date?: string | null
          org_id?: string
          po_id?: string | null
          procurement_id?: string
          reference_number?: string | null
          status?: Database["public"]["Enums"]["procurement_invoice_status"]
          vi_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_invoices_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_invoices_procurement_id_fkey"
            columns: ["procurement_id"]
            isOneToOne: false
            referencedRelation: "procurements"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_items: {
        Row: {
          amount: number | null
          description: string | null
          id: string
          name: string
          org_id: string
          procurement_id: string
          quantity: number
          rate: number
        }
        Insert: {
          amount?: number | null
          description?: string | null
          id?: string
          name: string
          org_id?: string
          procurement_id: string
          quantity?: number
          rate?: number
        }
        Update: {
          amount?: number | null
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          procurement_id?: string
          quantity?: number
          rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "procurement_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_items_procurement_id_fkey"
            columns: ["procurement_id"]
            isOneToOne: false
            referencedRelation: "procurements"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_quotation_files: {
        Row: {
          archived_at: string | null
          created_at: string
          file_path: string | null
          id: string
          org_id: string
          quotation_id: string
          title: string | null
          uploaded_by_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          org_id?: string
          quotation_id: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          org_id?: string
          quotation_id?: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_quotation_files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_quotation_files_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "procurement_quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_quotation_files_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_quotations: {
        Row: {
          file_url: string | null
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          is_selected: boolean
          org_id: string
          procurement_id: string
          received_date: string | null
          reference: string | null
          rfq_id: string | null
          total_amount: number
          valid_until: string | null
          vendor_id: string
          vq_number: string | null
        }
        Insert: {
          file_url?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          is_selected?: boolean
          org_id?: string
          procurement_id: string
          received_date?: string | null
          reference?: string | null
          rfq_id?: string | null
          total_amount?: number
          valid_until?: string | null
          vendor_id: string
          vq_number?: string | null
        }
        Update: {
          file_url?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          is_selected?: boolean
          org_id?: string
          procurement_id?: string
          received_date?: string | null
          reference?: string | null
          rfq_id?: string | null
          total_amount?: number
          valid_until?: string | null
          vendor_id?: string
          vq_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_quotations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_quotations_procurement_id_fkey"
            columns: ["procurement_id"]
            isOneToOne: false
            referencedRelation: "procurements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_quotations_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_quotations_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_receipt_files: {
        Row: {
          archived_at: string | null
          created_at: string
          file_path: string | null
          id: string
          org_id: string
          receipt_id: string
          title: string | null
          uploaded_by_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          org_id?: string
          receipt_id: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          org_id?: string
          receipt_id?: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_receipt_files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_receipt_files_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "procurement_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_receipt_files_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_receipts: {
        Row: {
          created_at: string
          gr_number: string | null
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          org_id: string
          po_id: string | null
          procurement_id: string
          receipt_date: string | null
          reference_number: string | null
          status: Database["public"]["Enums"]["procurement_receipt_status"]
        }
        Insert: {
          created_at?: string
          gr_number?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          org_id?: string
          po_id?: string | null
          procurement_id: string
          receipt_date?: string | null
          reference_number?: string | null
          status: Database["public"]["Enums"]["procurement_receipt_status"]
        }
        Update: {
          created_at?: string
          gr_number?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          org_id?: string
          po_id?: string | null
          procurement_id?: string
          receipt_date?: string | null
          reference_number?: string | null
          status?: Database["public"]["Enums"]["procurement_receipt_status"]
        }
        Relationships: [
          {
            foreignKeyName: "procurement_receipts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_receipts_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_receipts_procurement_id_fkey"
            columns: ["procurement_id"]
            isOneToOne: false
            referencedRelation: "procurements"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_status_events: {
        Row: {
          actor_id: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["procurement_status"] | null
          id: string
          notes: string | null
          org_id: string
          procurement_id: string
          to_status: Database["public"]["Enums"]["procurement_status"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["procurement_status"] | null
          id?: string
          notes?: string | null
          org_id?: string
          procurement_id: string
          to_status: Database["public"]["Enums"]["procurement_status"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["procurement_status"] | null
          id?: string
          notes?: string | null
          org_id?: string
          procurement_id?: string
          to_status?: Database["public"]["Enums"]["procurement_status"]
        }
        Relationships: [
          {
            foreignKeyName: "procurement_status_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_status_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_status_events_procurement_id_fkey"
            columns: ["procurement_id"]
            isOneToOne: false
            referencedRelation: "procurements"
            referencedColumns: ["id"]
          },
        ]
      }
      procurements: {
        Row: {
          approval_notes: string | null
          approved_by_id: string | null
          code: string | null
          created_at: string
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          org_id: string
          po_number: string | null
          pr_number: string | null
          project_id: string | null
          rejection_notes: string | null
          requested_by_id: string | null
          status: Database["public"]["Enums"]["procurement_status"]
          title: string
          total_value: number
          updated_at: string
          vendor_id: string | null
          vendor_invoiced_at: string | null
        }
        Insert: {
          approval_notes?: string | null
          approved_by_id?: string | null
          code?: string | null
          created_at?: string
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          org_id?: string
          po_number?: string | null
          pr_number?: string | null
          project_id?: string | null
          rejection_notes?: string | null
          requested_by_id?: string | null
          status?: Database["public"]["Enums"]["procurement_status"]
          title: string
          total_value?: number
          updated_at?: string
          vendor_id?: string | null
          vendor_invoiced_at?: string | null
        }
        Update: {
          approval_notes?: string | null
          approved_by_id?: string | null
          code?: string | null
          created_at?: string
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          org_id?: string
          po_number?: string | null
          pr_number?: string | null
          project_id?: string | null
          rejection_notes?: string | null
          requested_by_id?: string | null
          status?: Database["public"]["Enums"]["procurement_status"]
          title?: string
          total_value?: number
          updated_at?: string
          vendor_id?: string | null
          vendor_invoiced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurements_approved_by_id_fkey"
            columns: ["approved_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurements_requested_by_id_fkey"
            columns: ["requested_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurements_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_id: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          location: string | null
          manager_id: string | null
          org_id: string
          role: Database["public"]["Enums"]["user_role"]
          skills: string[]
          status: Database["public"]["Enums"]["profile_status"]
          title: string | null
          updated_at: string
          utilization: number | null
        }
        Insert: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          location?: string | null
          manager_id?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          skills?: string[]
          status?: Database["public"]["Enums"]["profile_status"]
          title?: string | null
          updated_at?: string
          utilization?: number | null
        }
        Update: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          location?: string | null
          manager_id?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          skills?: string[]
          status?: Database["public"]["Enums"]["profile_status"]
          title?: string | null
          updated_at?: string
          utilization?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_documents: {
        Row: {
          author_id: string | null
          category: string
          code: string | null
          created_at: string
          doc_date: string | null
          file_path: string | null
          id: string
          org_id: string
          parent_document_id: string | null
          project_id: string
          revision: string | null
          status: Database["public"]["Enums"]["doc_status"]
          title: string
        }
        Insert: {
          author_id?: string | null
          category: string
          code?: string | null
          created_at?: string
          doc_date?: string | null
          file_path?: string | null
          id?: string
          org_id?: string
          parent_document_id?: string | null
          project_id: string
          revision?: string | null
          status?: Database["public"]["Enums"]["doc_status"]
          title: string
        }
        Update: {
          author_id?: string | null
          category?: string
          code?: string | null
          created_at?: string
          doc_date?: string | null
          file_path?: string | null
          id?: string
          org_id?: string
          parent_document_id?: string | null
          project_id?: string
          revision?: string | null
          status?: Database["public"]["Enums"]["doc_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_documents_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_parent_document_id_fkey"
            columns: ["parent_document_id"]
            isOneToOne: false
            referencedRelation: "project_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_milestones: {
        Row: {
          created_at: string
          id: string
          input_pct: number | null
          name: string
          org_id: string
          project_id: string
          sort_order: number
          target_date: string | null
          weight: number
        }
        Insert: {
          created_at?: string
          id?: string
          input_pct?: number | null
          name: string
          org_id?: string
          project_id: string
          sort_order?: number
          target_date?: string | null
          weight?: number
        }
        Update: {
          created_at?: string
          id?: string
          input_pct?: number | null
          name?: string
          org_id?: string
          project_id?: string
          sort_order?: number
          target_date?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_milestones_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          budget: number
          client_id: string | null
          code: string | null
          contract_date: string | null
          contract_value: number
          created_at: string
          customer_contract_ref: string | null
          decided_at: string | null
          end_date: string | null
          id: string
          last_update: string
          name: string
          org_id: string
          project_manager_id: string | null
          spent: number
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
        }
        Insert: {
          archived_at?: string | null
          budget?: number
          client_id?: string | null
          code?: string | null
          contract_date?: string | null
          contract_value?: number
          created_at?: string
          customer_contract_ref?: string | null
          decided_at?: string | null
          end_date?: string | null
          id?: string
          last_update?: string
          name: string
          org_id?: string
          project_manager_id?: string | null
          spent?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
        }
        Update: {
          archived_at?: string | null
          budget?: number
          client_id?: string | null
          code?: string | null
          contract_date?: string | null
          contract_value?: number
          created_at?: string
          customer_contract_ref?: string | null
          decided_at?: string | null
          end_date?: string | null
          id?: string
          last_update?: string
          name?: string
          org_id?: string
          project_manager_id?: string | null
          spent?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_project_manager_id_fkey"
            columns: ["project_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_files: {
        Row: {
          archived_at: string | null
          created_at: string
          file_path: string | null
          id: string
          org_id: string
          purchase_order_id: string
          title: string | null
          uploaded_by_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          org_id?: string
          purchase_order_id: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          org_id?: string
          purchase_order_id?: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_files_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_files_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          amount: number | null
          created_at: string
          date: string | null
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          org_id: string
          po_number: string | null
          procurement_id: string
          reference_number: string | null
          status: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          date?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          org_id?: string
          po_number?: string | null
          procurement_id: string
          reference_number?: string | null
          status?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          date?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          org_id?: string
          po_number?: string | null
          procurement_id?: string
          reference_number?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_procurement_id_fkey"
            columns: ["procurement_id"]
            isOneToOne: false
            referencedRelation: "procurements"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_request_files: {
        Row: {
          archived_at: string | null
          created_at: string
          file_path: string | null
          id: string
          org_id: string
          purchase_request_id: string
          title: string | null
          uploaded_by_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          org_id?: string
          purchase_request_id: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          org_id?: string
          purchase_request_id?: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_request_files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_files_purchase_request_id_fkey"
            columns: ["purchase_request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_files_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_requests: {
        Row: {
          amount: number | null
          created_at: string
          date: string | null
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          org_id: string
          pr_number: string | null
          procurement_id: string
          reference_number: string | null
          status: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          date?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          org_id?: string
          pr_number?: string | null
          procurement_id: string
          reference_number?: string | null
          status?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          date?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          org_id?: string
          pr_number?: string | null
          procurement_id?: string
          reference_number?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_requests_procurement_id_fkey"
            columns: ["procurement_id"]
            isOneToOne: false
            referencedRelation: "procurements"
            referencedColumns: ["id"]
          },
        ]
      }
      rfq_files: {
        Row: {
          archived_at: string | null
          created_at: string
          file_path: string | null
          id: string
          org_id: string
          rfq_id: string
          title: string | null
          uploaded_by_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          org_id?: string
          rfq_id: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          org_id?: string
          rfq_id?: string
          title?: string | null
          uploaded_by_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rfq_files_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_files_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_files_uploaded_by_id_fkey"
            columns: ["uploaded_by_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rfqs: {
        Row: {
          amount: number | null
          created_at: string
          date: string | null
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          org_id: string
          procurement_id: string
          reference_number: string | null
          rfq_number: string | null
          status: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          date?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          org_id?: string
          procurement_id: string
          reference_number?: string | null
          rfq_number?: string | null
          status?: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          date?: string | null
          id?: string
          import_batch_id?: string | null
          import_key?: string | null
          imported_at?: string | null
          org_id?: string
          procurement_id?: string
          reference_number?: string | null
          rfq_number?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfqs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfqs_procurement_id_fkey"
            columns: ["procurement_id"]
            isOneToOne: false
            referencedRelation: "procurements"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          depends_on_id: string
          org_id: string
          task_id: string
        }
        Insert: {
          depends_on_id: string
          org_id?: string
          task_id: string
        }
        Update: {
          depends_on_id?: string
          org_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_id_fkey"
            columns: ["depends_on_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          end_date: string | null
          id: string
          milestone_id: string | null
          name: string
          org_id: string
          project_id: string
          start_date: string | null
          status: Database["public"]["Enums"]["task_status"]
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          milestone_id?: string | null
          name: string
          org_id?: string
          project_id: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          milestone_id?: string | null
          name?: string
          org_id?: string
          project_id?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "project_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_entries: {
        Row: {
          entry_date: string
          hours: number
          id: string
          notes: string | null
          org_id: string
          project_id: string
          timesheet_id: string
        }
        Insert: {
          entry_date: string
          hours?: number
          id?: string
          notes?: string | null
          org_id?: string
          project_id: string
          timesheet_id: string
        }
        Update: {
          entry_date?: string
          hours?: number
          id?: string
          notes?: string | null
          org_id?: string
          project_id?: string
          timesheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_timesheet_id_fkey"
            columns: ["timesheet_id"]
            isOneToOne: false
            referencedRelation: "timesheets"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheets: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          id: string
          org_id: string
          status: Database["public"]["Enums"]["timesheet_status"]
          submitted_at: string | null
          user_id: string
          week_start_date: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          id?: string
          org_id?: string
          status?: Database["public"]["Enums"]["timesheet_status"]
          submitted_at?: string | null
          user_id: string
          week_start_date: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          id?: string
          org_id?: string
          status?: Database["public"]["Enums"]["timesheet_status"]
          submitted_at?: string | null
          user_id?: string
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_views: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string
          scope: string
          spec: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id?: string
          scope?: string
          spec?: Json
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          scope?: string
          spec?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_views_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_budget_version: {
        Args: { version_id: string }
        Returns: undefined
      }
      admin_set_user_status: {
        Args: {
          p_org_id: string
          p_profile_id: string
          p_status: Database["public"]["Enums"]["profile_status"]
        }
        Returns: undefined
      }
      auth_org_id: { Args: never; Returns: string }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      capture_vendor_invoice: {
        Args: {
          p_amount?: number
          p_invoice_date: string
          p_notes?: string
          p_procurement_id: string
          p_reference_number?: string
          p_status: Database["public"]["Enums"]["procurement_invoice_status"]
        }
        Returns: {
          amount: number | null
          created_at: string
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          invoice_date: string | null
          org_id: string
          po_id: string | null
          procurement_id: string
          reference_number: string | null
          status: Database["public"]["Enums"]["procurement_invoice_status"]
          vi_number: string | null
        }
        SetofOptions: {
          from: "*"
          to: "procurement_invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clone_budget_version: { Args: { version_id: string }; Returns: string }
      committed_procurement_statuses: { Args: never; Returns: string[] }
      create_payment: {
        Args: {
          p_amount: number
          p_date: string
          p_import_batch_id?: string
          p_import_key?: string
          p_imported_at?: string
          p_invoice_id: string
          p_procurement_id: string
          p_reference_number: string
          p_status: string
        }
        Returns: {
          amount: number | null
          created_at: string
          date: string | null
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          invoice_id: string | null
          org_id: string
          pay_number: string | null
          procurement_id: string
          reference_number: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_procurement_invoice: {
        Args: {
          p_amount?: number
          p_import_batch_id?: string
          p_import_key?: string
          p_imported_at?: string
          p_invoice_date: string
          p_procurement_id: string
          p_reference_number?: string
          p_status: Database["public"]["Enums"]["procurement_invoice_status"]
        }
        Returns: {
          amount: number | null
          created_at: string
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          invoice_date: string | null
          org_id: string
          po_id: string | null
          procurement_id: string
          reference_number: string | null
          status: Database["public"]["Enums"]["procurement_invoice_status"]
          vi_number: string | null
        }
        SetofOptions: {
          from: "*"
          to: "procurement_invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_procurement_quotation: {
        Args: {
          p_import_batch_id?: string
          p_import_key?: string
          p_imported_at?: string
          p_procurement_id: string
          p_received_date: string
          p_total_amount: number
          p_vendor_id: string
        }
        Returns: {
          file_url: string | null
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          is_selected: boolean
          org_id: string
          procurement_id: string
          received_date: string | null
          reference: string | null
          rfq_id: string | null
          total_amount: number
          valid_until: string | null
          vendor_id: string
          vq_number: string | null
        }
        SetofOptions: {
          from: "*"
          to: "procurement_quotations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_procurement_receipt: {
        Args: {
          p_import_batch_id?: string
          p_import_key?: string
          p_imported_at?: string
          p_procurement_id: string
          p_receipt_date: string
          p_reference_number?: string
          p_status: Database["public"]["Enums"]["procurement_receipt_status"]
        }
        Returns: {
          created_at: string
          gr_number: string | null
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          org_id: string
          po_id: string | null
          procurement_id: string
          receipt_date: string | null
          reference_number: string | null
          status: Database["public"]["Enums"]["procurement_receipt_status"]
        }
        SetofOptions: {
          from: "*"
          to: "procurement_receipts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_purchase_order: {
        Args: {
          p_amount: number
          p_date: string
          p_import_batch_id?: string
          p_import_key?: string
          p_imported_at?: string
          p_procurement_id: string
          p_reference_number: string
          p_status: string
        }
        Returns: {
          amount: number | null
          created_at: string
          date: string | null
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          org_id: string
          po_number: string | null
          procurement_id: string
          reference_number: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "purchase_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_purchase_request: {
        Args: {
          p_amount: number
          p_date: string
          p_import_batch_id?: string
          p_import_key?: string
          p_imported_at?: string
          p_procurement_id: string
          p_reference_number: string
          p_status: string
        }
        Returns: {
          amount: number | null
          created_at: string
          date: string | null
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          org_id: string
          pr_number: string | null
          procurement_id: string
          reference_number: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "purchase_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_rfq: {
        Args: {
          p_amount: number
          p_date: string
          p_import_batch_id?: string
          p_import_key?: string
          p_imported_at?: string
          p_procurement_id: string
          p_reference_number: string
          p_status: string
        }
        Returns: {
          amount: number | null
          created_at: string
          date: string | null
          id: string
          import_batch_id: string | null
          import_key: string | null
          imported_at: string | null
          org_id: string
          procurement_id: string
          reference_number: string | null
          rfq_number: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "rfqs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_executive_dashboard: { Args: never; Returns: Json }
      get_finance_budget_review: { Args: never; Returns: Json }
      get_project_budget: { Args: { p_project_id: string }; Returns: number }
      get_project_milestones: {
        Args: { p_project_id: string }
        Returns: {
          calculated_pct: number
          effective_pct: number
          id: string
          input_pct: number
          name: string
          project_id: string
          sort_order: number
          target_date: string
          task_count: number
          weight: number
        }[]
      }
      get_projects_delivery: {
        Args: { p_ids: string[] }
        Returns: {
          budget: number
          committed_spend: number
          delivery_pct: number
          project_id: string
        }[]
      }
      get_projects_milestone_dates: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
          name: string
          project_id: string
          target_date: string
        }[]
      }
      get_sales_pipeline: { Args: never; Returns: Json }
      get_win_rate: { Args: { p_from?: string; p_to?: string }; Returns: Json }
      is_active_member: { Args: never; Returns: boolean }
      is_operator: { Args: never; Returns: boolean }
      next_procurement_doc_number: {
        Args: { p_org: string; p_prefix: string }
        Returns: string
      }
      on_hand_project_statuses: { Args: never; Returns: string[] }
      operator_grant_credits: {
        Args: { p_amount: number; p_note: string; p_org_id: string }
        Returns: undefined
      }
      operator_list_orgs: {
        Args: never
        Returns: {
          id: string
          name: string
        }[]
      }
      operator_org_exists: { Args: { p_org_id: string }; Returns: boolean }
      operator_toggle_feature: {
        Args: { p_enabled: boolean; p_key: string; p_org_id: string }
        Returns: undefined
      }
      operator_usage_summary: {
        Args: { p_org_id?: string }
        Returns: {
          action: string
          completion_tokens: number
          cost: number
          margin_usd: number
          month: string
          org_id: string
          owner_id: string
          prompt_tokens: number
          provider_cost_usd: number
          run_count: number
        }[]
      }
      org_credit_balance: { Args: { p_org_id: string }; Returns: number }
      org_has_feature: {
        Args: { p_key: string; p_org_id: string }
        Returns: boolean
      }
      org_has_member_email: {
        Args: { p_email: string; p_org_id: string }
        Returns: boolean
      }
      org_usage_summary: {
        Args: never
        Returns: {
          action: string
          completion_tokens: number
          cost: number
          margin_usd: number
          month: string
          owner_id: string
          prompt_tokens: number
          run_count: number
        }[]
      }
      pipeline_project_statuses: { Args: never; Returns: string[] }
      save_timesheet_week: {
        Args: {
          p_delete_ids?: string[]
          p_timesheet_id: string
          p_upserts?: Json
          p_week_start_date: string
        }
        Returns: string
      }
      select_procurement_quote: {
        Args: { p_quotation_id: string }
        Returns: undefined
      }
      select_trigger_events: {
        Args: {
          p_filters: Json
          p_last_seen_at: string
          p_last_seen_id: string
          p_source: string
        }
        Returns: {
          created_at: string
          id: string
          org_id: string
          to_status: string
        }[]
      }
      set_project_contract_value: {
        Args: { p_id: string; p_value: number }
        Returns: undefined
      }
      // 0077: atomic check-and-hold credit reservation (closes the TOCTOU overspend race). The FE
      // never touches credit_reservations directly (service-role-only, no policy) — only these RPCs.
      release_credits: { Args: { p_run_id: string }; Returns: undefined }
      reserve_credits: {
        Args: { p_amount: number; p_org_id: string; p_run_id: string }
        Returns: string
      }
      task_completion_proxy: {
        Args: { created_at: string; end_date: string }
        Returns: string
      }
      transition_document_status: {
        Args: {
          p_doc_id: string
          p_to: Database["public"]["Enums"]["doc_status"]
        }
        Returns: undefined
      }
      transition_procurement: {
        Args: {
          p_id: string
          p_notes?: string
          p_to: Database["public"]["Enums"]["procurement_status"]
        }
        Returns: undefined
      }
      transition_project: {
        Args: {
          p_contract_date?: string
          p_customer_contract_ref?: string
          p_id: string
          p_to: Database["public"]["Enums"]["project_status"]
        }
        Returns: undefined
      }
      transition_timesheet: {
        Args: {
          p_notes?: string
          p_timesheet_id: string
          p_to: Database["public"]["Enums"]["timesheet_status"]
        }
        Returns: undefined
      }
    }
    Enums: {
      budget_category:
        | "Labor"
        | "Materials"
        | "Subcontractors"
        | "Equipment"
        | "Permits & Fees"
        | "Overheads"
        | "Contingency"
      budget_status: "Draft" | "Active" | "Archived"
      company_type: "Internal" | "Client" | "Vendor"
      crm_activity_kind: "Call" | "Email" | "Meeting" | "Note"
      doc_status:
        | "Draft"
        | "Issued"
        | "Approved"
        | "Rejected"
        | "Closed"
        | "Superseded"
      incident_severity: "Low" | "Medium" | "High" | "Critical"
      incident_status: "Open" | "Investigating" | "Closed"
      procurement_invoice_status: "Received" | "Scheduled" | "Paid"
      procurement_receipt_status: "Partial" | "Complete"
      procurement_status:
        | "Draft"
        | "Requested"
        | "Approved"
        | "Rejected"
        | "Vendor Quoted"
        | "Quote Selected"
        | "Ordered"
        | "Received"
        | "Vendor Invoiced"
        | "Paid"
        | "Cancelled"
      profile_status: "active" | "disabled"
      project_status:
        | "Leads"
        | "PQ Submitted"
        | "Quotation Submitted"
        | "Tender Submitted"
        | "Negotiation"
        | "Won, Pending KoM"
        | "Ongoing Project"
        | "On Hold"
        | "Close Out"
        | "Loss Tender"
        | "Internal Project"
      task_status: "To Do" | "In Progress" | "Done" | "Blocked"
      timesheet_status: "Draft" | "Submitted" | "Approved" | "Rejected"
      user_role:
        | "Executive"
        | "Project Manager"
        | "Finance"
        | "Engineer"
        | "Admin"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      budget_category: [
        "Labor",
        "Materials",
        "Subcontractors",
        "Equipment",
        "Permits & Fees",
        "Overheads",
        "Contingency",
      ],
      budget_status: ["Draft", "Active", "Archived"],
      company_type: ["Internal", "Client", "Vendor"],
      crm_activity_kind: ["Call", "Email", "Meeting", "Note"],
      doc_status: [
        "Draft",
        "Issued",
        "Approved",
        "Rejected",
        "Closed",
        "Superseded",
      ],
      incident_severity: ["Low", "Medium", "High", "Critical"],
      incident_status: ["Open", "Investigating", "Closed"],
      procurement_invoice_status: ["Received", "Scheduled", "Paid"],
      procurement_receipt_status: ["Partial", "Complete"],
      procurement_status: [
        "Draft",
        "Requested",
        "Approved",
        "Rejected",
        "Vendor Quoted",
        "Quote Selected",
        "Ordered",
        "Received",
        "Vendor Invoiced",
        "Paid",
        "Cancelled",
      ],
      profile_status: ["active", "disabled"],
      project_status: [
        "Leads",
        "PQ Submitted",
        "Quotation Submitted",
        "Tender Submitted",
        "Negotiation",
        "Won, Pending KoM",
        "Ongoing Project",
        "On Hold",
        "Close Out",
        "Loss Tender",
        "Internal Project",
      ],
      task_status: ["To Do", "In Progress", "Done", "Blocked"],
      timesheet_status: ["Draft", "Submitted", "Approved", "Rejected"],
      user_role: [
        "Executive",
        "Project Manager",
        "Finance",
        "Engineer",
        "Admin",
      ],
    },
  },
} as const

