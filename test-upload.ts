import supabase from "./supabase/client"
import dotenv from "dotenv"

dotenv.config({ path: ".env.local" })

async function run() {
    console.log("Testing upload to product-designs...");
    const dummyBuffer = Buffer.from("hello world");
    const { data, error } = await supabase.storage
        .from("product-designs")
        .upload(`test_${Date.now()}.txt`, dummyBuffer, {
            contentType: "text/plain",
        });

    if (error) {
        console.error("Upload failed:", error.message);
    } else {
        console.log("Upload success:", data);
    }
}
run();
