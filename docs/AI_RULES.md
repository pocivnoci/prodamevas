# AI Agent Rules — Chrlit Studio

> **Tenhle soubor byl v srpnu 2026 vykuchán.** Držel checklist „po každé změně kódu
> aktualizuj dvě knowledge base podle mapy sekcí". Ta daň se prokazatelně neplatila
> (KB měly v hlavičce v4.1, přitom byly editované o dva měsíce později) a kdyby se
> platila, hořely by tokeny na prózu, kterou nikdo nečte. Zůstává jako rozcestník,
> protože na něj odkazuje vault v `brain/`.

## Kde teď žijí pravidla

| Co | Kde | Proč tam |
|---|---|---|
| Invarianty (tenant isolation, auth, modely, retry…) | `CLAUDE.md` → sekce Invarianty | Načítá se v každém tahu |
| Vynucení těch invariantů | `npm run guard` | Aserce spadne; próza jen doufá |
| Hloubkové „proč" per subsystém | `.claude/skills/*/SKILL.md` | Načte se, jen když se úkolu týká |
| Historie a rozhodnutí | git log, `brain/Decisions/` | Changelog nepatří do kontextu agenta |
| Stabilní architektura | `docs/SYSTEM_KNOWLEDGE_BASE.md`, `docs/AI_AGENT_KNOWLEDGE_BASE.md` | Čti při potřebě, ne povinně |

## Jediné pravidlo o dokumentaci, které zůstává

**Když se změní chování, které hlídá aserce, oprav kód — ne aserci.** Když vzniklo
nové pravidlo, patří tam, kde ho něco vynutí: aserce do `test-beta-e2e.ts`, vysvětlení
do příslušného skillu. `docs/` popisuje stabilní architekturu, ne changelog. Když si
dokumentace a kód odporují, **platí kód**.
