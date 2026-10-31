import dotenv from "dotenv";

dotenv.config();

console.log("Key vorhanden:", !!process.env.GEMINI_API_KEY);