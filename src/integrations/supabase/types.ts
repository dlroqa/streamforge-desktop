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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      excerpts: {
        Row: {
          created_at: string
          duration: number
          height: number
          id: string
          mime: string
          name: string
          size: number
          storage_path: string
          updated_at: string
          user_id: string
          width: number
        }
        Insert: {
          created_at?: string
          duration?: number
          height?: number
          id?: string
          mime?: string
          name?: string
          size?: number
          storage_path: string
          updated_at?: string
          user_id: string
          width?: number
        }
        Update: {
          created_at?: string
          duration?: number
          height?: number
          id?: string
          mime?: string
          name?: string
          size?: number
          storage_path?: string
          updated_at?: string
          user_id?: string
          width?: number
        }
        Relationships: []
      }
      editor_projects: {
        Row: {
          project: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          project: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          project?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      editor_meta: {
        Row: {
          key: string
          updated_at: string
          user_id: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          user_id: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          user_id?: string
          value?: Json
        }
        Relationships: []
      }
      recordings: {
        Row: {
          created_at: string
          description: string | null
          duration_seconds: number | null
          file_size_bytes: number | null
          id: string
          mime_type: string
          status: string
          storage_path: string | null
          storage_type: string
          thumbnail_path: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          file_size_bytes?: number | null
          id?: string
          mime_type?: string
          status?: string
          storage_path?: string | null
          storage_type?: string
          thumbnail_path?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          file_size_bytes?: number | null
          id?: string
          mime_type?: string
          status?: string
          storage_path?: string | null
          storage_type?: string
          thumbnail_path?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scheduled_streams: {
        Row: {
          created_at: string
          id: string
          platforms: string[]
          record_on_stream: boolean
          record_save_mode: string | null
          recording_id: string | null
          recording_title: string | null
          scheduled_at: string
          session_id: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platforms?: string[]
          record_on_stream?: boolean
          record_save_mode?: string | null
          recording_id?: string | null
          recording_title?: string | null
          scheduled_at: string
          session_id?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          platforms?: string[]
          record_on_stream?: boolean
          record_save_mode?: string | null
          recording_id?: string | null
          recording_title?: string | null
          scheduled_at?: string
          session_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_streams_recording_id_fkey"
            columns: ["recording_id"]
            isOneToOne: false
            referencedRelation: "recordings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_streams_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "stream_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      stream_destinations: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          platform: string
          platform_channel_id: string | null
          stream_key: string
          stream_url: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          platform: string
          platform_channel_id?: string | null
          stream_key: string
          stream_url: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          platform?: string
          platform_channel_id?: string | null
          stream_key?: string
          stream_url?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stream_sessions: {
        Row: {
          created_at: string
          daily_room_name: string | null
          destination_ids: string[] | null
          ended_at: string | null
          id: string
          recording_url: string | null
          started_at: string | null
          status: string
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_room_name?: string | null
          destination_ids?: string[] | null
          ended_at?: string | null
          id?: string
          recording_url?: string | null
          started_at?: string | null
          status?: string
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          daily_room_name?: string | null
          destination_ids?: string[] | null
          ended_at?: string | null
          id?: string
          recording_url?: string | null
          started_at?: string | null
          status?: string
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_activity: {
        Row: {
          area: string
          at: string
          id: number
          user_id: string
        }
        Insert: {
          area: string
          at?: string
          id?: never
          user_id: string
        }
        Update: {
          area?: string
          at?: string
          id?: never
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_decrypted_destinations:
        | {
            Args: { p_user_id: string }
            Returns: {
              enabled: boolean
              id: string
              name: string
              platform: string
              stream_key: string
              stream_url: string
            }[]
          }
        | {
            Args: { p_passphrase?: string; p_user_id: string }
            Returns: {
              enabled: boolean
              id: string
              name: string
              platform: string
              stream_key: string
              stream_url: string
            }[]
          }
      get_user_destinations: {
        Args: never
        Returns: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          platform: string
          stream_url: string
          updated_at: string
          user_id: string
        }[]
      }
      get_user_destinations_by_id: {
        Args: { p_user_id: string }
        Returns: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          platform: string
          stream_url: string
          updated_at: string
          user_id: string
        }[]
      }
      insert_destination_encrypted: {
        Args: {
          p_enabled: boolean
          p_name: string
          p_passphrase: string
          p_platform: string
          p_stream_key: string
          p_stream_url: string
          p_user_id: string
        }
        Returns: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          platform: string
          stream_url: string
          updated_at: string
          user_id: string
        }[]
      }
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
