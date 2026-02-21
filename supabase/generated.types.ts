// Auto-generated placeholder types for Supabase
// Run `supabase gen types typescript` to regenerate these types

export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            audit_submissions: {
                Row: {
                    id: string
                    name: string | null
                    email: string | null
                    system_type: string | null
                    answers: Json | null
                    locale: string | null
                    created_at: string
                    is_paid: boolean | null
                    report_type: string | null
                    payment_status: string | null
                    payment_id: string | null
                    paid_at: string | null
                    marketing_consent: boolean | null
                }
                Insert: {
                    id?: string
                    name?: string | null
                    email?: string | null
                    system_type?: string | null
                    answers?: Json | null
                    locale?: string | null
                    created_at?: string
                    is_paid?: boolean | null
                    report_type?: string | null
                    payment_status?: string | null
                    payment_id?: string | null
                    paid_at?: string | null
                    marketing_consent?: boolean | null
                }
                Update: {
                    id?: string
                    name?: string | null
                    email?: string | null
                    system_type?: string | null
                    answers?: Json | null
                    locale?: string | null
                    created_at?: string
                    is_paid?: boolean | null
                    report_type?: string | null
                    payment_status?: string | null
                    payment_id?: string | null
                    paid_at?: string | null
                    marketing_consent?: boolean | null
                }
                Relationships: []
            }
            audit_report: {
                Row: {
                    id: string
                    submission_id: string
                    status: string | null
                    summary: string | null
                    time_saved_daily: number | null
                    time_saved_monthly: number | null
                    time_saved_yearly: number | null
                    conclusion: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    submission_id: string
                    status?: string | null
                    summary?: string | null
                    time_saved_daily?: number | null
                    time_saved_monthly?: number | null
                    time_saved_yearly?: number | null
                    conclusion?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    submission_id?: string
                    status?: string | null
                    summary?: string | null
                    time_saved_daily?: number | null
                    time_saved_monthly?: number | null
                    time_saved_yearly?: number | null
                    conclusion?: string | null
                    created_at?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "audit_report_submission_id_fkey"
                        columns: ["submission_id"]
                        referencedRelation: "audit_submissions"
                        referencedColumns: ["id"]
                    }
                ]
            }
            user_reports: {
                Row: {
                    id: string
                    user_id: string
                    submission_id: string
                    report_type: string
                    unlocked_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    submission_id: string
                    report_type: string
                    unlocked_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    submission_id?: string
                    report_type?: string
                    unlocked_at?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "user_reports_submission_id_fkey"
                        columns: ["submission_id"]
                        referencedRelation: "audit_submissions"
                        referencedColumns: ["id"]
                    }
                ]
            }
            premium_submissions: {
                Row: {
                    id: string
                    submission_id: string
                    status: string
                    questions: Json | null
                    answers: Json | null
                    premium_answers: Json | null
                    final_guide: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    submission_id: string
                    status?: string
                    questions?: Json | null
                    answers?: Json | null
                    premium_answers?: Json | null
                    final_guide?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    submission_id?: string
                    status?: string
                    questions?: Json | null
                    answers?: Json | null
                    premium_answers?: Json | null
                    final_guide?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "premium_submissions_submission_id_fkey"
                        columns: ["submission_id"]
                        referencedRelation: "audit_submissions"
                        referencedColumns: ["id"]
                    }
                ]
            }
            report_diagnosis: {
                Row: {
                    id: string
                    report_id: string
                    category: string
                    score: number
                    comment: string | null
                    color: string | null
                }
                Insert: {
                    id?: string
                    report_id: string
                    category: string
                    score: number
                    comment?: string | null
                    color?: string | null
                }
                Update: {
                    id?: string
                    report_id?: string
                    category?: string
                    score?: number
                    comment?: string | null
                    color?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "report_diagnosis_report_id_fkey"
                        columns: ["report_id"]
                        referencedRelation: "audit_report"
                        referencedColumns: ["id"]
                    }
                ]
            }
            report_time_wasters: {
                Row: {
                    id: string
                    report_id: string
                    title: string
                    description: string | null
                    sort_order: number
                }
                Insert: {
                    id?: string
                    report_id: string
                    title: string
                    description?: string | null
                    sort_order?: number
                }
                Update: {
                    id?: string
                    report_id?: string
                    title?: string
                    description?: string | null
                    sort_order?: number
                }
                Relationships: [
                    {
                        foreignKeyName: "report_time_wasters_report_id_fkey"
                        columns: ["report_id"]
                        referencedRelation: "audit_report"
                        referencedColumns: ["id"]
                    }
                ]
            }
            report_action_steps: {
                Row: {
                    id: string
                    report_id: string
                    step_number: number
                    category: string
                    title: string
                    why_it_helps: string | null
                    where_to_find: string | null
                }
                Insert: {
                    id?: string
                    report_id: string
                    step_number: number
                    category: string
                    title: string
                    why_it_helps?: string | null
                    where_to_find?: string | null
                }
                Update: {
                    id?: string
                    report_id?: string
                    step_number?: number
                    category?: string
                    title?: string
                    why_it_helps?: string | null
                    where_to_find?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "report_action_steps_report_id_fkey"
                        columns: ["report_id"]
                        referencedRelation: "audit_report"
                        referencedColumns: ["id"]
                    }
                ]
            }
            report_automations: {
                Row: {
                    id: string
                    report_id: string
                    trigger: string | null
                    name: string
                    description: string | null
                    setup_instructions: string | null
                    sort_order: number
                }
                Insert: {
                    id?: string
                    report_id: string
                    trigger?: string | null
                    name: string
                    description?: string | null
                    setup_instructions?: string | null
                    sort_order?: number
                }
                Update: {
                    id?: string
                    report_id?: string
                    trigger?: string | null
                    name?: string
                    description?: string | null
                    setup_instructions?: string | null
                    sort_order?: number
                }
                Relationships: [
                    {
                        foreignKeyName: "report_automations_report_id_fkey"
                        columns: ["report_id"]
                        referencedRelation: "audit_report"
                        referencedColumns: ["id"]
                    }
                ]
            }
            report_checklist: {
                Row: {
                    id: string
                    report_id: string
                    item: string
                    sort_order: number
                }
                Insert: {
                    id?: string
                    report_id: string
                    item: string
                    sort_order?: number
                }
                Update: {
                    id?: string
                    report_id?: string
                    item?: string
                    sort_order?: number
                }
                Relationships: [
                    {
                        foreignKeyName: "report_checklist_report_id_fkey"
                        columns: ["report_id"]
                        referencedRelation: "audit_report"
                        referencedColumns: ["id"]
                    }
                ]
            }
            // Instagram Content Automation Tables
            ig_post_types: {
                Row: {
                    id: string
                    name: string
                    display_name: string
                    description: string | null
                    template: string | null
                    emoji: string | null
                    frequency: string | null
                    is_active: boolean | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    name: string
                    display_name: string
                    description?: string | null
                    template?: string | null
                    emoji?: string | null
                    frequency?: string | null
                    is_active?: boolean | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    name?: string
                    display_name?: string
                    description?: string | null
                    template?: string | null
                    emoji?: string | null
                    frequency?: string | null
                    is_active?: boolean | null
                    created_at?: string
                }
                Relationships: []
            }
            ig_post_ideas: {
                Row: {
                    id: string
                    category: string
                    subcategory: string | null
                    title: string
                    content: string
                    keywords: string[] | null
                    used_count: number | null
                    last_used_at: string | null
                    cooldown_days: number | null
                    is_active: boolean | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    category: string
                    subcategory?: string | null
                    title: string
                    content: string
                    keywords?: string[] | null
                    used_count?: number | null
                    last_used_at?: string | null
                    cooldown_days?: number | null
                    is_active?: boolean | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    category?: string
                    subcategory?: string | null
                    title?: string
                    content?: string
                    keywords?: string[] | null
                    used_count?: number | null
                    last_used_at?: string | null
                    cooldown_days?: number | null
                    is_active?: boolean | null
                    created_at?: string
                }
                Relationships: []
            }
            ig_reviews: {
                Row: {
                    id: string
                    customer_name: string | null
                    customer_initials: string | null
                    quote: string
                    rating: number | null
                    time_saved: string | null
                    transformation: string | null
                    source: string | null
                    used_at: string | null
                    is_approved: boolean | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    customer_name?: string | null
                    customer_initials?: string | null
                    quote: string
                    rating?: number | null
                    time_saved?: string | null
                    transformation?: string | null
                    source?: string | null
                    used_at?: string | null
                    is_approved?: boolean | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    customer_name?: string | null
                    customer_initials?: string | null
                    quote?: string
                    rating?: number | null
                    time_saved?: string | null
                    transformation?: string | null
                    source?: string | null
                    used_at?: string | null
                    is_approved?: boolean | null
                    created_at?: string
                }
                Relationships: []
            }
            ig_posts: {
                Row: {
                    id: string
                    post_type_id: string | null
                    idea_id: string | null
                    review_id: string | null
                    caption: string
                    hashtags: string[] | null
                    call_to_action: string | null
                    image_prompt: string | null
                    image_url: string | null
                    image_style: string | null
                    scheduled_for: string | null
                    time_slot: string | null
                    status: string | null
                    posted_at: string | null
                    likes: number | null
                    comments: number | null
                    saves: number | null
                    reach: number | null
                    shares: number | null
                    profile_visits: number | null
                    link_clicks: number | null
                    content_pillar: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    post_type_id?: string | null
                    idea_id?: string | null
                    review_id?: string | null
                    caption: string
                    hashtags?: string[] | null
                    call_to_action?: string | null
                    image_prompt?: string | null
                    image_url?: string | null
                    image_style?: string | null
                    scheduled_for?: string | null
                    time_slot?: string | null
                    status?: string | null
                    posted_at?: string | null
                    likes?: number | null
                    comments?: number | null
                    saves?: number | null
                    reach?: number | null
                    shares?: number | null
                    profile_visits?: number | null
                    link_clicks?: number | null
                    content_pillar?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    post_type_id?: string | null
                    idea_id?: string | null
                    review_id?: string | null
                    caption?: string
                    hashtags?: string[] | null
                    call_to_action?: string | null
                    image_prompt?: string | null
                    image_url?: string | null
                    image_style?: string | null
                    scheduled_for?: string | null
                    time_slot?: string | null
                    status?: string | null
                    posted_at?: string | null
                    likes?: number | null
                    comments?: number | null
                    saves?: number | null
                    reach?: number | null
                    shares?: number | null
                    profile_visits?: number | null
                    link_clicks?: number | null
                    content_pillar?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "ig_posts_post_type_id_fkey"
                        columns: ["post_type_id"]
                        referencedRelation: "ig_post_types"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "ig_posts_idea_id_fkey"
                        columns: ["idea_id"]
                        referencedRelation: "ig_post_ideas"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "ig_posts_review_id_fkey"
                        columns: ["review_id"]
                        referencedRelation: "ig_reviews"
                        referencedColumns: ["id"]
                    }
                ]
            }
            ig_content_calendar: {
                Row: {
                    id: string
                    date: string
                    post_id: string | null
                    post_type_id: string | null
                    time_slot: string | null
                    notes: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    date: string
                    post_id?: string | null
                    post_type_id?: string | null
                    time_slot?: string | null
                    notes?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    date?: string
                    post_id?: string | null
                    post_type_id?: string | null
                    time_slot?: string | null
                    notes?: string | null
                    created_at?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "ig_content_calendar_post_id_fkey"
                        columns: ["post_id"]
                        referencedRelation: "ig_posts"
                        referencedColumns: ["id"]
                    },
                    {
                        foreignKeyName: "ig_content_calendar_post_type_id_fkey"
                        columns: ["post_type_id"]
                        referencedRelation: "ig_post_types"
                        referencedColumns: ["id"]
                    }
                ]
            }
            ig_generation_log: {
                Row: {
                    id: string
                    post_id: string | null
                    prompt_used: string | null
                    model_used: string | null
                    tokens_used: number | null
                    generation_time_ms: number | null
                    error: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    post_id?: string | null
                    prompt_used?: string | null
                    model_used?: string | null
                    tokens_used?: number | null
                    generation_time_ms?: number | null
                    error?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    post_id?: string | null
                    prompt_used?: string | null
                    model_used?: string | null
                    tokens_used?: number | null
                    generation_time_ms?: number | null
                    error?: string | null
                    created_at?: string
                }
                Relationships: [
                    {
                        foreignKeyName: "ig_generation_log_post_id_fkey"
                        columns: ["post_id"]
                        referencedRelation: "ig_posts"
                        referencedColumns: ["id"]
                    }
                ]
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            [_ in never]: never
        }
        Enums: {
            [_ in never]: never
        }
        CompositeTypes: {
            [_ in never]: never
        }
    }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
    PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
            Row: infer R
        }
    ? R
    : never
    : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
            Row: infer R
        }
    ? R
    : never
    : never

export type TablesInsert<
    PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
        Insert: infer I
    }
    ? I
    : never
    : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
    }
    ? I
    : never
    : never

export type TablesUpdate<
    PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
        Update: infer U
    }
    ? U
    : never
    : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
    }
    ? U
    : never
    : never

export type Enums<
    PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
    EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = PublicEnumNameOrOptions extends { schema: keyof Database }
    ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
    : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
    PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
    CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
        schema: keyof Database
    }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
    ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
    : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
