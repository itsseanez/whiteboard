import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

async function signInAs(email: string, password: string): Promise<string> {
    const res = await request(app)
        .post('/api/auth/sign-in/email')
        .send({ email, password });

    const rawCookies = res.headers['set-cookie'] as unknown as string[];
    const sessionCookie = rawCookies?.find((c) => c.startsWith('better-auth.session_token='));

    if (!sessionCookie) {
        throw new Error('Sign-in did not return a session cookie — check credentials or seed data.');
    }
    return sessionCookie;
}

describe('tenant isolation', () => {

    it('lets a member reach their own tenant', async () => {
        // sign in as Marina, hit /tenant/marinas-cuts-color, assert success
        const sessionCookie = await signInAs('marina@marinascuts.example', 'demo-password-123');
        const res = await request(app)
            .get('/tenant/marinas-cuts-color')
            .set('Cookie', sessionCookie);

        expect(res.status).toBe(200);
        expect(res.body.tenant.slug).toBe('marinas-cuts-color');
        expect(res.body.membership.role).toBeDefined();
    });

    it('blocks a member from a tenant they do not belong to', async () => {
        // sign in as Marina, hit /tenant/studio-wien, assert the disguised 404
        const sessionCookie = await signInAs('marina@marinascuts.example', 'demo-password-123');
        const res = await request(app)
            .get('/tenant/studio-wien')
            .set('Cookie', sessionCookie);

        expect(res.status).toBe(404);
    });
});