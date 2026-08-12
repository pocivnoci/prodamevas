import { redirect } from "next/navigation"

/**
 * `/dashboard` samo o sobě nic nezobrazuje — studio žije na `/dashboard/instagram`.
 * Bez téhle stránky končí na 404 každá starší záložka i `start_url` z manifestu.
 */
export default function DashboardIndex() {
    redirect("/dashboard/instagram")
}
