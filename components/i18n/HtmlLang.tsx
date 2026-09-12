"use client"

import { useEffect } from "react"

/**
 * `<html lang>` sedí v kořenovém layoutu, který zůstává statický (marketing se
 * nesmí kvůli cookie renderovat na každý request). Dashboard a auth stránky si
 * proto jazyk dokumentu nastaví samy až v prohlížeči — čtečky a překladače
 * prohlížeče ho čtou odsud.
 */
export function HtmlLang({ locale }: { locale: string }) {
    useEffect(() => {
        document.documentElement.lang = locale
    }, [locale])
    return null
}
