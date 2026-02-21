import { generateImage } from "./instagram/gemini-client.js";

async function run() {
    try {
        console.log("Calling generateImage...");
        const buf = await generateImage("Minimalist logo of a dog, cyberpunk", { aspectRatio: "1:1" });
        console.log("Success, buffer size:", buf.length);
    } catch (e) {
        console.error("Test failed with error:", e);
    }
}
run();
