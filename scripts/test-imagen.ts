import { generateImage } from '../instagram/gemini-client';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function test() {
    console.log("Testing image generation...");
    try {
        const buffer = await generateImage("A close up of a sleek smartphone on a desk", { aspectRatio: "1:1" });
        console.log("Success! Image size:", buffer.length);
    } catch (err) {
        console.error("Image generation failed:", err);
    }
}
test();
