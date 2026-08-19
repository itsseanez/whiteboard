// db.ts
import 'dotenv/config';   
import { Pool } from 'pg';

const isProd = process.env.NODE_ENV === 'production';

export const appPool = new Pool({
  connectionString: process.env.APP_DATABASE_URL,
  ssl: isProd ? true : false,
});

export const signupPool = new Pool({
  connectionString: process.env.SIGNUP_DATABASE_URL,
  ssl: isProd ? true : false,
});

export const publicPool = new Pool({
  connectionString: process.env.PUBLIC_DATABASE_URL,
  ssl: isProd ? true : false,
});