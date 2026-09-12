import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

/**
 * Server-only admin klient (service role, obchází RLS) — backend enginu a crony.
 *
 * Inicializuje se LÍNĚ, při prvním použití, ne při importu. Dřív se `createClient`
 * volal na úrovni modulu, takže každý soubor, který admin klienta jen importoval
 * (a to je přes `lib/subscription` skoro všechno), spadl bez `.env.local` na
 * „supabaseUrl is required" ještě před první řádkou vlastního kódu. Statická sada
 * `npm run guard` — která na DB nikdy nesahá — tak v CI a v cloudové session
 * hlásila porušený invariant, který porušený nebyl, a Stop hook ji pouštěl
 * naprázdno. Chybějící env se pořád hlásí hlasitě: v okamžiku, kdy někdo klienta
 * skutečně použije, a s hláškou, která říká, KTERÁ proměnná chybí.
 */
let client: SupabaseClient | null = null

function getAdminClient(): SupabaseClient {
    if (client) return client
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceRoleKey) {
        const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(", ")
        throw new Error(`Supabase admin klient nemá přístupové údaje — chybí ${missing} (viz tabulka env v README).`)
    }
    client = createClient(url, serviceRoleKey)
    return client
}

// Proxy zachovává dosavadní API (`supabaseAdmin.from(...)`, `.rpc`, `.storage`, `.auth`);
// metody se vážou na skutečnou instanci, aby `this` uvnitř SDK nemířil na proxy.
const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
    get(_target, prop) {
        const real = getAdminClient()
        const value = Reflect.get(real, prop, real)
        return typeof value === "function" ? value.bind(real) : value
    },
})

export default supabaseAdmin
