#!/bin/bash

# Instagram Content Generator
# ===========================
# 
# ./run.sh generate          - Vygeneruje jeden náhodný post
# ./run.sh generate [type]   - Vygeneruje konkrétní typ postu
# ./run.sh batch             - Vygeneruje 7 postů na celý týden
# ./run.sh dry-run           - Test bez ukládání
# ./run.sh types             - Zobrazí dostupné typy

cd "$(dirname "$0")/.."

echo "📱 Mobil na míru - Instagram Content Generator"
echo "=============================================="
echo ""

case "$1" in
    "generate")
        echo "🚀 Generating a single post..."
        if [ -n "$2" ]; then
            npx ts-node --project tsconfig.json -r tsconfig-paths/register instagram/generator.ts --type="$2"
        else
            npx ts-node --project tsconfig.json -r tsconfig-paths/register instagram/generator.ts
        fi
        ;;
    
    "batch")
        echo "📅 Generating weekly batch (7 posts)..."
        npx ts-node --project tsconfig.json -r tsconfig-paths/register instagram/generator.ts --batch
        ;;
    
    "dry-run")
        echo "🧪 Dry run (no database save)..."
        npx ts-node --project tsconfig.json -r tsconfig-paths/register instagram/generator.ts --dry-run
        ;;
    
    "types")
        echo "📋 Available post types:"
        echo ""
        echo "  Denně:"
        echo "    ⚙️  tip_nastaveni   - Tip na nastavení telefonu"
        echo "    💡 quick_tip       - Rychlý jednořádkový tip"
        echo ""
        echo "  Týdně:"
        echo "    📊 statistika      - Šokující statistiky"
        echo "    ⭐ recenze         - Recenze zákazníka"
        echo "    🔄 before_after    - Před a Po transformace"
        echo "    😂 meme            - Vtipný obsah"
        echo "    💪 motivace        - Motivační post"
        echo "    📚 edukace         - Vzdělávací carousel"
        echo "    ❓ poll_question   - Anketa / Otázka"
        echo ""
        echo "  Měsíčně:"
        echo "    🔥 trending        - Reakce na trendy"
        echo "    🎬 behind_scenes   - Behind the scenes"
        echo "    🎯 challenge       - Výzva pro followery"
        ;;
    
    *)
        echo "Usage: ./run.sh [command]"
        echo ""
        echo "Commands:"
        echo "  generate         Generate a single random post"
        echo "  generate [type]  Generate post of specific type"
        echo "  batch            Generate 7 posts for the week"
        echo "  dry-run          Test generation without saving"
        echo "  types            List available post types"
        echo ""
        echo "Examples:"
        echo "  ./run.sh generate"
        echo "  ./run.sh generate tip_nastaveni"
        echo "  ./run.sh batch"
        ;;
esac
