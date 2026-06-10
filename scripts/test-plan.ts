import { generateContentPlan } from "../app/actions/content-plan-actions";

async function main() {
    console.log("Generating plan...");
    const res = await generateContentPlan("pocivnoci", 7);
    console.log("Success:", res.success);
    if (res.plan) {
        console.log("Plan length:", res.plan.length);
        console.log("First item:", res.plan[0]?.hookPreview);
    } else {
        console.log("Error:", res.error);
    }
}
main();
