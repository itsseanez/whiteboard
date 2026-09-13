import 'dotenv/config';   
import { Pool } from 'pg';


export const appPool = new Pool({
  connectionString: process.env.APP_DATABASE_URL
});

export const signupPool = new Pool({
  connectionString: process.env.SIGNUP_DATABASE_URL
});

export const publicPool = new Pool({
  connectionString: process.env.PUBLIC_DATABASE_URL
});

export const authPool = new Pool({
  connectionString: process.env.AUTH_DATABASE_URL
});