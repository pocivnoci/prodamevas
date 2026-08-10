/**
 * Konvence `refId` — naše, ne brány.
 * ===================================
 * Prefix rozlišuje první platbu od automatické obnovy a rozhoduje o věcech,
 * které s konkrétní bránou nemají nic společného: odmítnutá **obnova** nesmí
 * zabít živé předplatné (jde do dunningu), kdežto odmítnutá **první** platba
 * zruší nezaplacené pending předplatné.
 *
 * Bydlelo to v `lib/comgate.ts`, což bylo neškodné, dokud existovala jedna
 * brána. Jakmile se sdílené jádro (`on-paid.ts`) potřebovalo zeptat „je tohle
 * obnova?", muselo by importovat klienta jedné konkrétní brány — a tím by se na
 * ní stalo závislé. `npm run guard` to zakazuje právě proto.
 *
 * `lib/comgate.ts` tyhle funkce dál re-exportuje, aby se nemusela měnit
 * existující volací místa.
 */

/** refId první platby předplatného. */
export function generateRefId(clientSlug: string): string {
    return `sub-${clientSlug}-${Date.now()}`
}

/** refId automatické obnovy — prefix `renew-` čte callback i billing-worker. */
export function generateRenewalRefId(clientSlug: string): string {
    return `renew-${clientSlug}-${Date.now()}`
}

export function isRenewalRefId(refId?: string | null): boolean {
    return !!refId?.startsWith("renew-")
}
