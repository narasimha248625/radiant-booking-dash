export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      bookings: {
        Row: {
          amount: number;
          booking_code: string;
          created_at: string;
          id: string;
          player_name: string;
          slot_id: string;
          status: string;
          team_size: number;
          updated_at: string;
          venue_id: string;
        };
        Insert: {
          amount: number;
          booking_code: string;
          created_at?: string;
          id?: string;
          player_name: string;
          slot_id: string;
          status?: string;
          team_size: number;
          updated_at?: string;
          venue_id: string;
        };
        Update: {
          amount?: number;
          booking_code?: string;
          created_at?: string;
          id?: string;
          player_name?: string;
          slot_id?: string;
          status?: string;
          team_size?: number;
          updated_at?: string;
          venue_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_slot_id_fkey";
            columns: ["slot_id"];
            isOneToOne: false;
            referencedRelation: "slots";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_venue_id_fkey";
            columns: ["venue_id"];
            isOneToOne: false;
            referencedRelation: "venues";
            referencedColumns: ["id"];
          },
        ];
      };
      slots: {
        Row: {
          capacity: number;
          court_label: string;
          created_at: string;
          duration_minutes: number;
          id: string;
          reserved_count: number;
          slot_date: string;
          start_time: string;
          status: string;
          updated_at: string;
          venue_id: string;
        };
        Insert: {
          capacity?: number;
          court_label: string;
          created_at?: string;
          duration_minutes?: number;
          id?: string;
          reserved_count?: number;
          slot_date: string;
          start_time: string;
          status?: string;
          updated_at?: string;
          venue_id: string;
        };
        Update: {
          capacity?: number;
          court_label?: string;
          created_at?: string;
          duration_minutes?: number;
          id?: string;
          reserved_count?: number;
          slot_date?: string;
          start_time?: string;
          status?: string;
          updated_at?: string;
          venue_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "slots_venue_id_fkey";
            columns: ["venue_id"];
            isOneToOne: false;
            referencedRelation: "venues";
            referencedColumns: ["id"];
          },
        ];
      };
      venues: {
        Row: {
          active: boolean;
          amenities: string[];
          created_at: string;
          description: string;
          featured: boolean;
          id: string;
          image_key: string;
          location: string;
          name: string;
          price_per_hour: number;
          rating: number;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          amenities?: string[];
          created_at?: string;
          description: string;
          featured?: boolean;
          id?: string;
          image_key?: string;
          location: string;
          name: string;
          price_per_hour: number;
          rating?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          amenities?: string[];
          created_at?: string;
          description?: string;
          featured?: boolean;
          id?: string;
          image_key?: string;
          location?: string;
          name?: string;
          price_per_hour?: number;
          rating?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_guest_booking: {
        Args: {
          p_player_name: string;
          p_slot_id: string;
          p_team_size: number;
          p_venue_id: string;
        };
        Returns: {
          booking_code: string;
          booking_status: string;
          total_amount: number;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
