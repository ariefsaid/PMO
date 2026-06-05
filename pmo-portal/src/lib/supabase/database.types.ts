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
          created_at: string
          id: string
          name: string
          org_id: string
          type: Database["public"]["Enums"]["company_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id?: string
          type: Database["public"]["Enums"]["company_type"]
        }
        Update: {
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
      incident_reports: {
        Row: {
          created_at: string
          description: string | null
          id: string
          incident_date: string
          location: string | null
          org_id: string
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
            foreignKeyName: "incident_reports_reported_by_fkey"
            columns: ["reported_by"]
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
      procurement_quotations: {
        Row: {
          file_url: string | null
          id: string
          is_selected: boolean
          org_id: string
          procurement_id: string
          received_date: string | null
          reference: string | null
          total_amount: number
          vendor_id: string
        }
        Insert: {
          file_url?: string | null
          id?: string
          is_selected?: boolean
          org_id?: string
          procurement_id: string
          received_date?: string | null
          reference?: string | null
          total_amount?: number
          vendor_id: string
        }
        Update: {
          file_url?: string | null
          id?: string
          is_selected?: boolean
          org_id?: string
          procurement_id?: string
          received_date?: string | null
          reference?: string | null
          total_amount?: number
          vendor_id?: string
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
            foreignKeyName: "procurement_quotations_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      procurements: {
        Row: {
          code: string | null
          created_at: string
          id: string
          org_id: string
          project_id: string | null
          requested_by_id: string | null
          status: Database["public"]["Enums"]["procurement_status"]
          title: string
          total_value: number
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          org_id?: string
          project_id?: string | null
          requested_by_id?: string | null
          status?: Database["public"]["Enums"]["procurement_status"]
          title: string
          total_value?: number
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          org_id?: string
          project_id?: string | null
          requested_by_id?: string | null
          status?: Database["public"]["Enums"]["procurement_status"]
          title?: string
          total_value?: number
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
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
          org_id: string
          role: Database["public"]["Enums"]["user_role"]
          skills: string[]
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
          org_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          skills?: string[]
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
          org_id?: string
          role?: Database["public"]["Enums"]["user_role"]
          skills?: string[]
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
            foreignKeyName: "project_documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget: number
          client_id: string | null
          code: string | null
          contract_value: number
          created_at: string
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
          budget?: number
          client_id?: string | null
          code?: string | null
          contract_value?: number
          created_at?: string
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
          budget?: number
          client_id?: string | null
          code?: string | null
          contract_value?: number
          created_at?: string
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
          created_at: string
          end_date: string | null
          id: string
          name: string
          org_id: string
          project_id: string
          start_date: string | null
          status: Database["public"]["Enums"]["task_status"]
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          name: string
          org_id?: string
          project_id: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_budget_version: {
        Args: { version_id: string }
        Returns: undefined
      }
      auth_org_id: { Args: never; Returns: string }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      clone_budget_version: { Args: { version_id: string }; Returns: string }
      get_executive_dashboard: { Args: never; Returns: Json }
      get_project_budget: { Args: { p_project_id: string }; Returns: number }
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
      doc_status: "Draft" | "Issued" | "Approved" | "Rejected" | "Closed"
      incident_severity: "Low" | "Medium" | "High" | "Critical"
      incident_status: "Open" | "Investigating" | "Closed"
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
      doc_status: ["Draft", "Issued", "Approved", "Rejected", "Closed"],
      incident_severity: ["Low", "Medium", "High", "Critical"],
      incident_status: ["Open", "Investigating", "Closed"],
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

