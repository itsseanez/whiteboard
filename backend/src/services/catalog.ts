// src/services/catalog.ts
//
// What a tenant offers, for the public booking page.
//
// The availability endpoint answers "when can this service be done", which
// presupposes the caller already knows the service's id. Nothing told them.
// Until now the only way to find a service id was to read the seed migration,
// which is fine for curl and useless for a booking page.
//
// Two queries rather than a join with rows fanned out per staff member. The
// result is nested — a service carrying its stylists — and assembling that
// from a flat join means grouping in TypeScript anyway. At a few dozen
// services per tenant, two indexed reads beat the cleverness.
//
// No WHERE tenant_id anywhere: RLS applies it. Column-scoped grants mean this
// cannot select a column the public role has no business reading, which is why
// buffer and notice values are not in the SELECT list even though the role can
// read them — the booking page has no use for them, and an endpoint that
// returns a service's internal padding tells a competitor how the salon runs
// its day.

import type { Pool, PoolClient } from 'pg';
import { withContext } from '../withContext.js';

export interface CatalogStaff {
  id: string;
  name: string;
}

export interface CatalogService {
  id: string;
  name: string;
  durationMinutes: number;
  /** Everyone qualified for this service. Empty means nobody can perform it. */
  staff: CatalogStaff[];
}

interface ServiceRow {
  id: string;
  name: string;
  durationMinutes: number;
}

interface LinkRow {
  serviceId: string;
  staffId: string;
  staffName: string;
}

async function fetchServices(client: PoolClient): Promise<ServiceRow[]> {
  const { rows } = await client.query<ServiceRow>(
    `SELECT id, name, duration_minutes AS "durationMinutes"
     FROM service
     ORDER BY name`,
  );
  return rows;
}

async function fetchStaffLinks(client: PoolClient): Promise<LinkRow[]> {
  // staff_service carries tenant_id and its own RLS policy as of the
  // isolate-staff-service migration, so a row pairing one tenant's stylist
  // with another's service can neither exist nor be read here.
  const { rows } = await client.query<LinkRow>(
    `SELECT ss.service_id AS "serviceId",
            s.id          AS "staffId",
            s.name        AS "staffName"
     FROM staff_service ss
     JOIN staff s ON s.id = ss.staff_id
     ORDER BY s.name`,
  );
  return rows;
}

export async function getCatalog(pool: Pool, tenantId: string): Promise<CatalogService[]> {
  return withContext(pool, { tenantId }, async (client) => {
    const services = await fetchServices(client);
    const links = await fetchStaffLinks(client);

    const byService = new Map<string, CatalogStaff[]>();
    for (const link of links) {
      const existing = byService.get(link.serviceId);
      const entry = { id: link.staffId, name: link.staffName };
      if (existing) existing.push(entry);
      else byService.set(link.serviceId, [entry]);
    }

    // Services with no qualified staff are still returned, carrying an empty
    // list. Hiding them would make a misconfigured salon look like an empty
    // one, and the page can say "nobody is set up for this yet" — which is a
    // useful thing for the owner to see on their own public page.
    return services.map((service) => ({
      ...service,
      staff: byService.get(service.id) ?? [],
    }));
  });
}
