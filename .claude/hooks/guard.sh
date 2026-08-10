#!/usr/bin/env bash
# Stop hook — invariant se nevynucuje tím, že si ho model přečetl v CLAUDE.md.
#
# Sada je statická (čte soubory, nesahá na DB ani na modely) a běží ~3 s, takže
# se vyplatí ji pustit vždycky, když se pracovalo. Když spadne, vrací exit 2 —
# text ze stderr jde zpátky modelu, aby to opravil ještě v tomtéž tahu.
set -uo pipefail

input=$(cat)

# Guard už jednou model probudil. Kdyby se pustil znovu, vznikne smyčka.
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Session, ve které se nic nezměnilo (dotaz, rešerše), nesmí stát ani vteřinu.
if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
    exit 0
fi

if out=$(npm run --silent guard 2>&1); then
    exit 0
fi

{
    echo "❌ npm run guard SPADL. Invariant, který sada hlídá, je porušený."
    echo "   Oprav KÓD, ne aserci — aserce popisuje pravidlo, na kterém produkt stojí."
    echo
    printf '%s\n' "$out" | grep -E "❌|FAIL|Error:" | head -20
} >&2
exit 2
