import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins"
import { authPool } from "../db.js";

export const auth = betterAuth({
    database: authPool,
    emailAndPassword: { 
        enabled: true, 
    },
    // Dev pages come from Vite on 5173, not BETTER_AUTH_URL, so Better Auth
    // answers 403 INVALID_ORIGIN. Production is one origin and needs no entry.
    trustedOrigins: process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173'],
    plugins: [
        organization() 
    ]
})