/**
 * Backfill brand-specific post formats for an EXISTING client (onboarded before
 * custom formats existed). Generates formats from the client's saved config,
 * writes them to clients.config, and (re)creates ig_post_types rows.
 *
 *   npx tsx scripts/backfill-post-types.ts <slug>
 *
 * Idempotent-ish: re-running generates a fresh set (AI is non-deterministic).
 */
import supabaseAdmin from '../supabase/admin'
import { loadConfig, resolveClientId, invalidateConfigCache } from '../instagram/configs'
import { generateCustomFormats } from '../app/onboarding/core'
import { ensurePostTypes } from '../instagram/service'

async function main() {
    const slug = process.argv[2]
    if (!slug) {
        console.error('Použití: npx tsx scripts/backfill-post-types.ts <slug>')
        process.exit(1)
    }

    const clientId = await resolveClientId(slug)
    const config = await loadConfig(slug)

    // Backfill has no original WebsiteAnalysis — reconstruct the minimal fields
    // generateCustomFormats actually reads, from the saved config.
    const analysis: any = {
        companyName: config.name,
        industry: (config as any).industry || config.contentFocus || '',
        description: config.contentFocus || config.name,
        targetAudience: (config.audiencePersonas?.[0] as any)?.label || '',
    }

    console.log(`🎨 Generating brand-specific formats for ${slug}...`)
    await generateCustomFormats(analysis, config)

    const defs = config.postTypeDefs || []
    if (defs.length === 0) {
        console.error('❌ AI vrátila prázdno — zkus to znovu.')
        process.exit(1)
    }
    console.log(`✅ ${defs.length} formátů: ${defs.map(d => `${d.name} (${d.display_name})`).join(', ')}`)

    // Persist the enriched config
    const { error: cfgErr } = await supabaseAdmin.from('clients').update({ config }).eq('id', clientId)
    if (cfgErr) { console.error('❌ config update selhal:', cfgErr.message); process.exit(1) }

    // Deactivate any old post types not in the new set, then create the new ones
    const keep = config.postTypes || []
    if (keep.length > 0) {
        await supabaseAdmin
            .from('ig_post_types')
            .update({ is_active: false })
            .eq('client_id', clientId)
            .not('name', 'in', `(${keep.map(n => `"${n}"`).join(',')})`)
    }
    await ensurePostTypes(config, clientId)
    invalidateConfigCache(slug)

    console.log('✅ Hotovo. Otevři záložku Generovat — formáty jsou na míru značce.')
}

main().catch(e => { console.error(e); process.exit(1) })
