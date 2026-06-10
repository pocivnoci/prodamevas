---
tags: [meta, mcp, chrlit]
updated: 2026-06-10
---

# 🔌 Jak Claude používá tenhle vault

## Setup (jednorázově)

1. **Vault = kořen repa.** Otevři `prodamevas/` jako Obsidian vault (ne podsložku) — pak jsou `docs/`, `CLAUDE.md` i tenhle `brain/` v jednom grafu a wikilinky na docs (`[[SYSTEM_KNOWLEDGE_BASE]]`) se resolvnou.
2. **Plugin Local REST API** — Settings → Community plugins → nainstaluj *Local REST API*, zapni, zkopíruj API key. Má vestavěný MCP server (žádný separátní proces). Kvůli self-signed certu si cert důvěřuj v OS, nebo zapni plain HTTP endpoint (port 27123).
3. **Claude Code** (stejný HTTP-transport flow jako u Rohlíkova MCP):
   ```
   claude mcp add --transport http obsidian https://127.0.0.1:27124/mcp/ \
     --header "Authorization: Bearer <api-key>"
   ```
   Nebo do `.mcp.json` v projektu.
4. Obsidian musí běžet a mít vault otevřený, aby MCP odpovídal.

> [!warning] Verzuj vault v gitu
> Write-operace přes MCP přepisují soubory. Repo je v gitu — když Claude něco rozhodí, `git revert`.

## Na co se Claude ptát

- *„Shrň, co je v `brain/Decisions/` o tenant isolation, cituj názvy poznámek."*
- *„Z téhle konverzace udělej decision note podle `_template` a ulož do `brain/Decisions/`."*
- *„Roztřiď `Ideas.md` — co je rychlá výhra, co velký projekt."*
- *„Projdi `docs/` a `brain/` a najdi, kde si protiřečí."*

## Dělba práce

- **Kódování** → Claude Code čte `CLAUDE.md` + `docs/` jako soubory (MCP na to nepotřebuje).
- **Strategie / paměť / úklid nápadů** → Claude přes Obsidian MCP sahá do `brain/`.

## Odkazy

- [[00 MOC]]
