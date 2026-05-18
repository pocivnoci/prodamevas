const fs = require('fs');

const files = [
    'app/actions/admin-actions.ts',
    'app/actions/product-actions.ts',
    'app/actions/ig-generate-action.ts'
];

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    // Add import if not present
    if (!content.includes('requireSuperAdmin')) {
        content = content.replace(/(import [^\n]+\n)/, "$1import { requireSuperAdmin } from \"@/lib/auth-guard\";\n");
    }

    // Split by export async function to reliably find the start of each function
    let parts = content.split('export async function ');
    
    for (let i = 1; i < parts.length; i++) {
        let part = parts[i];
        
        // Find the first "try {" OR the body start "{" after the signature
        // We know the signature ends when the body starts. In TS, the body starts after `) {` or `> {` or just `{`
        
        // A simpler approach: find the first occurrence of `try {` or `const` or `let` or `await` or `return` inside the function.
        // Actually, just find the FIRST `{` that closes the arguments/return type.
        // It's much easier to count braces.
        let braceDepth = 0;
        let inFuncBody = false;
        let insertIndex = -1;
        
        for (let j = 0; j < part.length; j++) {
            if (part[j] === '{') {
                braceDepth++;
                if (braceDepth === 1) {
                    // This could be the start of options: { OR the start of the function {
                    // Let's look backwards. If it's preceded by `) ` or `>` or ` Promise<...>` or it's the end of line
                    let before = part.substring(Math.max(0, j - 20), j);
                    if (before.match(/\)\s*$/) || before.match(/>\s*$/) || before.match(/:\s*$/) === null) {
                        // It's the body! BUT wait, `options: {` matches `:\s*$`.
                        if (!before.match(/:\s*$/) && !before.match(/=\s*$/)) {
                            // It's the body!
                            insertIndex = j + 1;
                            break;
                        }
                    }
                }
            } else if (part[j] === '}') {
                braceDepth--;
            }
        }
        
        if (insertIndex !== -1) {
            parts[i] = part.substring(0, insertIndex) + '\n    await requireSuperAdmin();' + part.substring(insertIndex);
        } else {
            console.log(`Failed to parse: ${part.substring(0, 50)}`);
        }
    }

    fs.writeFileSync(file, parts.join('export async function '), 'utf8');
    console.log(`Updated ${file}`);
});
