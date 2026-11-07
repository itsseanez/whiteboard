import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, ownerAc, memberAc } from "better-auth/plugins/organization/access";
import { authPool } from "../db.js";

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
    },
    // Dev pages come from Vite on 5173, not BETTER_AUTH_URL, so Better Auth
    // answers 403 INVALID_ORIGIN. Production is one origin and needs no entry.
    trustedOrigins: process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173'],
    plugins: [
        organization({
            ac,
            roles: { owner, admin: manager, member: staff },
            invitationExpiresIn: 60 * 60 * 24 * 7,
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
