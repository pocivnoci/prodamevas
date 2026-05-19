# Skills

Složka pro reusable skills — instrukce, které AI agent načte a řídí se jimi.

## Použití

Řekni agentovi:
- *"Použij skill brainstorm"* — agent přečte `brainstorm.md` a řídí se jím
- *"Postupuj podle debug skillu"* — systematická diagnostika
- *"Code review tohoto souboru"* — agent použije checklist z `code-review.md`

## Dostupné skills

| Skill | Soubor | Kdy použít |
|-------|--------|------------|
| 💡 Brainstorm | `brainstorm.md` | Mám nápad, chci ho rozvést nebo zpochybnit |
| 🔧 Implement | `implement-feature.md` | Chci přidat novou feature |
| 🔍 Code Review | `code-review.md` | Zkontroluj kvalitu kódu, security, bugy |
| 🧹 Refactor | `refactor.md` | Kód je nepřehledný, rozděl/vyčisti ho |
| 🐛 Debug | `debug.md` | Něco nefunguje, najdi příčinu |
| ⚡ Optimize | `optimize.md` | Něco je pomalé nebo drahé |

## Formát skillu

```markdown
# Název skillu

## Kontext
Kdy a proč tento skill použít.

## Kroky
1. ...
2. ...
```

## Pojmenování

- `nazev-skillu.md` (kebab-case)
- Název = CO skill dělá
