import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins"
import { Pool } from "pg";
import 'dotenv/config';

export const auth = betterAuth({
    database: new Pool({
        connectionString: process.env.DATABASE_URL,
    }),
    emailAndPassword: { 
        enabled: true, 
    }, 
    plugins: [
        organization() 
    ]
})