import { createClient } from "@supabase/supabase-js"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ""

// Server-only admin client for bypassing RLS during generation actions
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey)

export default supabaseAdmin
