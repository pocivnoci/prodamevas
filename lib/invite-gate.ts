import supabaseAdmin from '@/supabase/admin'
import type { User } from '@supabase/supabase-js'
import { hasBetaStamp, inviteRequired } from '@/lib/beta-access'

/**
 * Brána do bety. Účet vznikne jen s platným kódem pozvánky — **i když přijde
 * z Googlu**. U hesla se kód vyplní ve formuláři, u OAuth ho neseme přes
 * přesměrování v httpOnly cookie a validujeme znovu až v callbacku.
 */

export const INVITE_COOKIE = 'chrlit_invite'

/** 15 minut stačí na odbočku ke Googlu a zpět, ale ne na zapomenutou záložku. */
export const INVITE_COOKIE_MAX_AGE = 60 * 15

export type InviteRecord = { id: string; code: string; max_uses: number; used_count: number }

/** Aktivní kód s volnou kapacitou, nebo nic. Nic nemění — jen čte. */
export async function findUsableInvite(rawCode: string | null | undefined): Promise<InviteRecord | null> {
    const code = rawCode?.toUpperCase().trim()
    if (!code) return null

    const { data } = await supabaseAdmin
        .from('invite_codes')
        .select('id, code, max_uses, used_count')
        .eq('code', code)
        .eq('is_active', true)
        .maybeSingle()

    if (!data || data.used_count >= data.max_uses) return null
    return data as InviteRecord
}

/**
 * Zabere jedno místo podmíněným UPDATE — `used_count` se zvedne jen tehdy, když
 * ho mezi čtením a zápisem nikdo jiný nezměnil. Když claim nevrátí řádek, kód
 * mezitím došel: **je to konec, ne důvod zapisovat znovu.**
 */
export async function claimInvite(invite: InviteRecord): Promise<boolean> {
    const { data } = await supabaseAdmin
        .from('invite_codes')
        .update({ used_count: invite.used_count + 1 })
        .eq('id', invite.id)
        .eq('used_count', invite.used_count)
        .select('id')

    return !!data?.length
}

export type InviteVerdict = { ok: true } | { ok: false; reason: 'invite_required' | 'invalid_invite' }

/**
 * Smí tenhle OAuth uživatel dovnitř? Existující lidé kód neřeší — poznají se
 * podle razítka na účtu nebo podle vazby na klienta. Nový účet bez kódu končí.
 *
 * Odmítnutý účet **nemažeme**: brána stojí na razítku, ne na existenci účtu,
 * takže se tentýž člověk může vrátit s kódem a projít.
 */
export async function enforceInviteGate(user: User, pendingCode: string | null): Promise<InviteVerdict> {
    // Razítko na účtu už je — dál není co řešit.
    if (user.app_metadata?.invite_code || user.user_metadata?.invite_code) return { ok: true }

    // Super admina pustit nestačí — **musí dostat razítko jako každý jiný.**
    //
    // `SUPER_ADMIN_EMAILS` čte i middleware u každého requestu, jenže z jiného
    // bundlu než tahle funkce. Jakmile se hodnota do jednoho z nich nepropíše
    // (překlep ve Vercelu, proměnná přidaná až po buildu), sklapne past:
    // přihlášení admina pustí — a bez tohohle razítkování ho nechá bez evidence —
    // načež ho middleware na `/dashboard` pošle zpátky na `/login?error=no_access`
    // a ještě mu smaže `sb-*` cookies. Účet s nejvyšším oprávněním se tak zamkne
    // sám před sebou a nemá se z čeho dostat, protože další přihlášení dopadne
    // stejně. Razítko je jediná evidence, která rozbitou proměnnou přežije.
    if (hasBetaStamp(user)) {
        await stampInvite(user, 'ADMIN')
        return { ok: true }
    }

    // Existující zákazník — má projekt, tedy branou prošel dřív, než razítka byla.
    const { data: link } = await supabaseAdmin
        .from('user_clients')
        .select('client_id')
        .eq('user_id', user.id)
        .limit(1)

    if (link?.length) {
        await stampInvite(user, 'LEGACY')
        return { ok: true }
    }

    // Otevřená registrace. Kód se pořád zabírá, když ho člověk má — pozvánky z
    // waitlistu odešly s příslibem a jejich počítadlo musí zůstat pravdivé —
    // ale ŽÁDNÝ kód ani NEPLATNÝ kód už není důvod nepustit dovnitř. Vyhodit
    // člověka kvůli překlepu ve chvíli, kdy kód stejně nikdo nevyžaduje, by bylo
    // horší než ho nemít.
    if (!inviteRequired()) {
        const invite = await findUsableInvite(pendingCode)
        if (invite && await claimInvite(invite)) {
            await stampInvite(user, invite.code)
        } else {
            await stampInvite(user, 'OPEN')
        }
        return { ok: true }
    }

    if (!pendingCode) return { ok: false, reason: 'invite_required' }

    const invite = await findUsableInvite(pendingCode)
    if (!invite) return { ok: false, reason: 'invalid_invite' }
    if (!(await claimInvite(invite))) return { ok: false, reason: 'invalid_invite' }

    // Claim první, razítko druhé: kapacita kódu je vzácný zdroj, razítko jen
    // evidence. Když razítko selže, člověk je uvnitř a příště spálí ještě jedno
    // místo — proto to musí být vidět v logu.
    await stampInvite(user, invite.code)
    return { ok: true }
}

async function stampInvite(user: User, code: string): Promise<void> {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        app_metadata: { ...user.app_metadata, invite_code: code },
    })
    if (error) {
        console.error(`🚨 invite-gate: razítko kódu selhalo pro ${user.id}: ${error.message}`)
    }
}
