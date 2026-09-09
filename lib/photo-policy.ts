/**
 * Kolik smí být na obrázcích vymyšleno — JEDINÝ zdroj pravdy o třech stupních.
 *
 * Odpověď na „majitel chce jenom svoje reálné fotky". Engine to uměl vždycky, ale
 * říct se to dalo jen po jednom postu (nahraná fotka v Generovat). Tohle to říká
 * za značku napořád.
 *
 * Popisky žijí tady, ne v komponentě: říkají zákazníkovi, co engine udělá, a to
 * je přesně ten druh slibu, který se nesmí rozejít s tím, co se opravdu děje.
 * Chování vynucuje `instagram/photo-fidelity.ts` (prompt) a `resolveBasePhoto()`
 * v `instagram/orchestrators/image-orchestrator.ts` (výběr referencí).
 *
 * Stejný tvar jako `lib/feed-pattern.ts`: typ a číselník v `lib/`, pole
 * v `ClientConfig`, clamp ve `validateConfig()`.
 */

export type PhotoPolicy = "free" | "prefer-real" | "only-real"

export const PHOTO_POLICY_OPTIONS: {
    id: PhotoPolicy
    label: string
    /** Jedna až dvě věty do UI — co engine udělá. */
    description: string
}[] = [
    {
        id: "free",
        label: "Volná ruka",
        description: "AI si scénu může vymyslet. Vaše fotky slouží jako reference stylu, prostředí a produktů.",
    },
    {
        id: "prefer-real",
        label: "Přednost mým fotkám",
        description: "Když k postu sedí některá vaše fotka, post na ní musí stát — a kontroluje se to. Bez sedící fotky si AI scénu domyslí.",
    },
    {
        id: "only-real",
        label: "Jen moje fotky",
        description: "Fotografie se nevymýšlí nikdy. Bez sedící vaší fotky jde post do typografie nebo grafiky.",
    },
]

export function isPhotoPolicy(v: unknown): v is PhotoPolicy {
    return typeof v === "string" && PHOTO_POLICY_OPTIONS.some(o => o.id === v)
}

/** Chce značka stavět posty na svých skutečných fotkách? */
export function prefersRealPhotos(config: { photoPolicy?: PhotoPolicy }): boolean {
    return config.photoPolicy === "prefer-real" || config.photoPolicy === "only-real"
}
