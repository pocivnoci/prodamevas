/**
 * Které příspěvky drží faktická brána — čtení stavu z `ig_generation_log`.
 * =======================================================================
 * Brána zapisuje výsledek k ZÁZNAMU O GENEROVÁNÍ, ne k postu: jeden post má
 * záznamů víc (přegenerování, retuš, potvrzení tvrzení člověkem), a platí
 * NEJNOVĚJŠÍ. Kdo se zeptá jinak, dostane starý příznak a zadrží post, který
 * mezitím někdo pročistil — přesně ten druh chyby, po které si uživatel
 * odklikne auto-publikování zpátky.
 *
 * Jediné místo s tímhle dotazem; publisher i ostřicí agent ho sdílejí, aby se
 * nemohly rozejít v tom, co „označený" znamená.
 */

import supabaseAdmin from "@/supabase/admin"
import { isFactFlagged } from "@/lib/fact-check-modes"

/**
 * Z daných postů ty, kterým NEJNOVĚJŠÍ záznam brány hlásí nepodložené tvrzení.
 *
 * Fail-open: když dotaz selže (nemigrovaný sloupec, výpadek), vrací prázdnou
 * množinu a publikování běží dál — zadržet celou frontu kvůli rozbitému čtení
 * by byla horší závada než jeden označený post. Selhání je vidět v logu.
 */
export async function findFactFlaggedPosts(postIds: string[]): Promise<Set<string>> {
    const flagged = new Set<string>()
    const ids = postIds.filter(Boolean)
    if (ids.length === 0) return flagged

    try {
        const { data, error } = await supabaseAdmin
            .from("ig_generation_log")
            .select("post_id, fact_status, created_at")
            .in("post_id", ids)
            .order("created_at", { ascending: false })
        if (error) throw new Error(error.message)

        // Nejnovější záznam vyhrává — `order` výš ho dává první, takže stačí
        // zapamatovat si, který post už jsme viděli.
        const seen = new Set<string>()
        for (const row of data || []) {
            const id = row.post_id as string | null
            if (!id || seen.has(id)) continue
            seen.add(id)
            if (isFactFlagged(row.fact_status as string | null)) flagged.add(id)
        }
    } catch (err: any) {
        console.warn(`⚠️ Faktická brána: stav příspěvků se nepodařilo přečíst (${err?.message || err}) — publikuje se bez filtru`)
    }

    return flagged
}
