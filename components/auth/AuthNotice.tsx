/** Hláška nad formulářem. Obě přihlašovací stránky ji měly opsanou zvlášť. */
export function AuthNotice({
    tone,
    title,
    children,
}: {
    tone: "error" | "success"
    title: string
    children: React.ReactNode
}) {
    const skin = tone === "error"
        ? { box: "bg-red-500/10 border-red-500/20", text: "text-red-400", body: "text-red-400/80" }
        : { box: "bg-emerald-500/10 border-emerald-500/20", text: "text-emerald-400", body: "text-emerald-400/80" }

    return (
        <div className={`mb-6 rounded-sm p-4 border ${skin.box}`}>
            <div className="flex gap-3">
                <svg className={`h-5 w-5 shrink-0 ${skin.text}`} viewBox="0 0 20 20" fill="currentColor">
                    {tone === "error" ? (
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    ) : (
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    )}
                </svg>
                <div>
                    <h3 className={`text-xs font-bold uppercase tracking-widest ${skin.text}`}>{title}</h3>
                    <p className={`mt-1 text-xs ${skin.body}`}>{children}</p>
                </div>
            </div>
        </div>
    )
}
