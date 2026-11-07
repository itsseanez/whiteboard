import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, ownerAc, memberAc } from "better-auth/plugins/organization/access";
import { authPool } from "../db.js";
import { getTenantsByUserId } from "../services/tenant.js";
import { sendResetPassword, sendVerification } from "./auth-emails.js";

export const MEMBERSHIP_LIMIT = 1000;

// "admin" is a manager: owner minus people. Managers invite staff, but only an
// owner invites managers (beforeCreateInvitation) or changes and removes members.
const ac = createAccessControl(defaultStatements);
const owner = ac.newRole(ownerAc.statements);
const staff = ac.newRole(memberAc.statements);
const manager = ac.newRole({
    organization: ["update"],
    invitation: ["create", "cancel"],
    member: [],
    team: [],
    ac: ["read"],
});

async function roleIn(organizationId: string, userId: string): Promise<string | undefined> {
    const { rows } = await authPool.query<{ role: string }>(
        `SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2`,
        [organizationId, userId],
    );
    return rows[0]?.role;
}

export const auth = betterAuth({
    database: authPool,
    emailAndPassword: {
        enabled: true,
        sendResetPassword,
        // A reset is usually a lost or leaked password, so every session ends.
        revokeSessionsOnPasswordReset: true,
    },
    // Sent at sign-up and on request, never required: until SES leaves its
    // sandbox most of these can't be delivered, and sign-up must still work.
    emailVerification: {
        sendVerificationEmail: sendVerification,
        sendOnSignUp: true,
    },
    // Better Auth would let a session less than a day old delete its account
    // without a password. A stolen cookie shouldn't be enough, so always ask.
    // Changing the email gets the same check: for an unverified address it
    // applies at once, so a stolen cookie could otherwise hand the account away.
    hooks: {
        before: createAuthMiddleware(async (ctx) => {
            const body = ctx.body as { password?: unknown } | undefined;
            if (ctx.path === "/delete-user" && (typeof body?.password !== "string" || body.password === "")) {
                throw new APIError("BAD_REQUEST", { code: "PASSWORD_REQUIRED", message: "Enter your password to delete your account." });
            }
            if (ctx.path === "/change-email") {
                const password = body?.password;
                if (typeof password !== "string" || password === "") {
                    throw new APIError("BAD_REQUEST", { code: "PASSWORD_REQUIRED", message: "Enter your password to change your email." });
                }
                const session = await getSessionFromCtx(ctx);
                if (!session) throw new APIError("UNAUTHORIZED", { code: "UNAUTHORIZED", message: "Unauthorized" });
                const account = (await ctx.context.internalAdapter.findAccounts(session.user.id))
                    .find((a) => a.providerId === "credential");
                if (!account?.password || !(await ctx.context.password.verify({ hash: account.password, password }))) {
                    throw new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD", message: "Invalid password" });
                }
            }
        }),
    },
    // Deleting your own account, with your password. Sessions, sign-ins,
    // memberships and invitations you sent go with it (foreign keys cascade);
    // a staff row you were linked to stays, unlinked.
    user: {
        // Unverified: the change applies at once and the new address gets a
        // check. Verified: the new address gets a link, and the change waits for it.
        changeEmail: { enabled: true, updateEmailWithoutVerification: true },
        deleteUser: {
            enabled: true,
            beforeDelete: async (user) => {
                // An open organization with no owner couldn't be run or closed. Another
                // owner can carry on; the member_keeps_an_owner trigger is the guarantee.
                const owned = (await getTenantsByUserId(user.id)).filter(
                    (o: { role: string; closedAt: unknown }) => o.role === "owner" && !o.closedAt,
                );
                const { rows: shared } = await authPool.query<{ organizationId: string }>(
                    `SELECT m."organizationId" FROM member m
                     WHERE m."userId" = $1 AND m.role = 'owner'
                       AND EXISTS (SELECT 1 FROM member other
                                   WHERE other."organizationId" = m."organizationId"
                                     AND other.role = 'owner' AND other."userId" <> $1)`,
                    [user.id],
                );
                const coOwned = new Set(shared.map((r) => r.organizationId));
                const alone = owned.filter((o: { organizationId: string }) => !coOwned.has(o.organizationId));
                if (alone.length > 0) {
                    throw new APIError("BAD_REQUEST", {
                        code: "OWNS_ORGANIZATIONS",
                        message: `Close these organizations or make someone else an owner first: ${alone.map((o: { name: string }) => o.name).join(", ")}.`,
                    });
                }
            },
        },
    },
    // Dev pages come from Vite on 5173, not BETTER_AUTH_URL, so Better Auth
    // answers 403 INVALID_ORIGIN. Production is one origin and needs no entry.
    trustedOrigins: process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173'],
    plugins: [
        organization({
            ac,
            roles: { owner, admin: manager, member: staff },
            invitationExpiresIn: 60 * 60 * 24 * 7,
            // Better Auth's default is 100: the 101st invitation can't be
            // accepted, and listing members looks up at most this many users.
            membershipLimit: MEMBERSHIP_LIMIT,
            // Which staff row the invitation is for; linked when it's accepted.
            schema: {
                invitation: {
                    additionalFields: { staffId: { type: "string", required: false, input: true } },
                },
            },
            organizationHooks: {
                beforeCreateInvitation: async ({ invitation }) => {
                    if (invitation.role === "member") return;
                    const inviter = await roleIn(invitation.organizationId, invitation.inviterId);
                    if (invitation.role !== "admin" || inviter !== "owner") {
                        throw new APIError("FORBIDDEN", { message: "Only an owner can invite a manager." });
                    }
                },
            },
        }),
    ]
})
