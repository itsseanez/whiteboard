import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins"
import { authPool } from "../db.js";

export const auth = betterAuth({
    database: authPool,
    emailAndPassword: { 
        enabled: true, 
    }, 
    plugins: [
        organization() 
    ]
})