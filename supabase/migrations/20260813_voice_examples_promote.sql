-- Cílený zápis jediného klíče v clients.config.
--
-- PROČ NE OBYČEJNÝ UPDATE: `clients.config` je jeden velký JSONB. Kdyby agent
-- načetl config, upravil ho v paměti a zapsal celý zpátky, přepsal by všechno,
-- co mezitím uživatel uložil v Nastavení. Agent běží denně na pozadí, takže by
-- šlo o tiché ztracení uživatelovy editace — přesně to, co CLAUDE.md zakazuje
-- ("podmíněný claim, nikdy slepý zápis").
--
-- jsonb_set mění výhradně klíč brandVoiceExamples přímo v databázi, takže
-- souběžná editace ostatních polí přežije.
--
-- Rozsah je schválně úzký: funkce umí přepsat JEN tenhle jeden klíč. Obecná
-- "nastav libovolnou cestu v configu" by byla nástroj na obejití validace.

create or replace function set_brand_voice_examples(
    p_client_id uuid,
    p_examples jsonb
) returns void
language sql
as $$
    update clients
       set config = jsonb_set(coalesce(config, '{}'::jsonb), '{brandVoiceExamples}', p_examples, true)
     where id = p_client_id;
$$;

-- Volá to výhradně backend enginu přes service role. Klientské role k tomu
-- nemají mít přístup — brand voice se z prohlížeče mění přes server action,
-- která prochází requireProjectAccess().
revoke all on function set_brand_voice_examples(uuid, jsonb) from public;
revoke all on function set_brand_voice_examples(uuid, jsonb) from anon;
revoke all on function set_brand_voice_examples(uuid, jsonb) from authenticated;
