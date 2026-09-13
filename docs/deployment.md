# Deployment

How Whiteboard runs in production, why it's built that way, and what to do
when it misbehaves.

Decisions come first; procedures are at the bottom. Product and architecture
decisions are in [`DECISIONS.md`](../DECISIONS.md); the database role model
is in [`database-roles.md`](database-roles.md).

## Topology

One EC2 instance running Docker Compose:

```
                    :443 / :80
                        │
                   ┌────▼────┐
                   │  Caddy  │  automatic TLS, Let's Encrypt
                   └────┬────┘
                        │  app:3000
                   ┌────▼────┐
                   │   API   │  Node 26, Express
                   └────┬────┘
                        │  postgres:5432
                   ┌────▼──────┐
                   │ PostgreSQL │  named volume, no published port
                   └────────────┘
```

A fourth service, `migrate`, runs once per deploy and must exit 0 before the
API starts.

Images are built in GitHub Actions and pulled from GHCR. Deploys are
triggered over SSM, authenticated by GitHub OIDC. Secrets live in SSM
Parameter Store and are fetched by the instance profile at deploy time.

---

# Decisions

## One instance, not a container platform

Docker Compose on a single EC2 box, with Postgres in a container on the same
host.

**Rejected ECS.** A scheduler exists to place containers across machines, do
rolling deploys, and scale with load. One application and one database at a
target of 30 concurrent bookers has none of those problems. ECS would also
force the database off the box — tasks are ephemeral — and replace three
lines of Caddy config with a load balancer costing more per month than the
instance.

Losing managed backups costs little here: migrations are the schema, so the
whole database rebuilds from `migrate up` plus seed.

## Caddy for TLS

Caddy requests and renews Let's Encrypt certificates automatically. The
entire configuration is a domain name and a proxy target. nginx would mean
installing certbot, writing a renewal job, and configuring TLS by hand for
the same result.

Certificates are stored in a named volume. Without it, every container
recreation re-requests from Let's Encrypt and hits the duplicate-certificate
rate limit.

Port 80 is not optional — the HTTP-01 challenge is served over it.

## Deploy transport: SSM, not SSH

Deploys run via `aws ssm send-command`, authenticated by GitHub OIDC. Port
22 is closed.

GitHub runner IPs cannot be allow-listed — thousands of rotating CIDRs
against a security group limit of roughly 60 rules — so SSH would mean port
22 open to the world **plus** a long-lived private key sitting in repository
secrets. OIDC exchanges a short-lived token for a role scoped to this
repository and branch, so there is no stored credential at all.

The deploy command is non-interactive and single-shot, which is the shape
`send-command` is built for.

### OIDC trust policy pins the immutable subject format

Repositories created after 15 July 2026 sign the `sub` claim as
`repo:owner@owner_id/repo@repo_id:ref:refs/heads/main`, not the name-only
format most documentation still shows. GitHub made the change because a
recycled organization or repository name could otherwise mint a token
matching an existing trust policy.

The policy uses `StringEquals` against the real numeric IDs.

**A `repo:owner/*` wildcard is not an acceptable fix.** It would let any
repository on the account — and any pull-request branch — assume a role that
runs shell commands on the production host.

Symptom when this is wrong: `Not authorized to perform
sts:AssumeRoleWithWebIdentity`, with no role named in the error. Note that
`github.repository` and `github.ref` emit the *old* format and are useless
for debugging it — they are workflow context, not token claims.

## Shell access: Session Manager, with a serial-console fallback

The SSM agent opens an outbound connection; there is no listener, no inbound
rule, and no key file. Requires an instance profile with
`AmazonSSMManagedInstanceCore`.

Closing port 22 means a dead agent or a detached instance profile would
otherwise leave no way in. **EC2 Serial Console** is the break-glass path —
it works below the network stack, but needs account-level opt-in *and* a
password set on the `ubuntu` user. Both were configured and verified working
before port 22 was closed.

Security group inbound is 80 and 443 only.

## The security group is the only firewall

Docker writes its own iptables rules ahead of UFW's chain, so **UFW does not
protect published container ports.** A host firewall here would provide
false confidence.

Two consequences:

- Postgres gets no `ports:` mapping at all. The API reaches it over the
  Docker network by service name.
- Only Caddy publishes, on 80 and 443.

## Images are built in CI, never on the box

`npm ci` plus `tsc` in a container needs well over 1 GiB. Building on a
t3.micro means either an OOM kill or several minutes of swap thrashing with
Postgres evicted underneath — a small outage on every deploy. The
development machine is arm64 and the instance x86_64, so local builds are
the wrong architecture anyway.

Build failures land in CI logs rather than on a host someone has to open a
session against.

**Images are tagged by commit SHA, not `:latest`.** This makes "which code
is running" a fact rather than a guess, provides a named rollback target,
and avoids Compose's image digest reconciliation deciding whether a pull
warrants a restart.

**Tests gate the image; the image gates the deploy.** One workflow, three
jobs chained with `needs:`. A failing test means no image is built, so
broken code cannot reach the host.

## The deploy script lives on the box

The workflow sends one line; `/opt/whiteboard/deploy.sh` does the work.
Escaping a multi-line shell script through `send-command`'s JSON parameters
is fragile, and a script on disk can be tested by hand.

The workflow waits on the command and fails the job on a non-`Success`
status. A `send-command` call that returns a command ID says nothing about
whether the deploy worked.

## Secrets: Parameter Store, not Secrets Manager

Production secrets are SecureString parameters under `/whiteboard/prod/`,
fetched by the instance profile at deploy time.

Secrets Manager's differentiator is automatic rotation, which has no
built-in support for self-hosted Postgres — so its cost buys a feature this
project can't use. Parameter Store is free at this scale with the same IAM
model.

The host still writes a `.env` file. What's bought is a disposable instance,
not the elimination of the file.

**The fetch writes to a temp file and validates the parameter count before
installing.** A short fetch fails the deploy loudly instead of leaving a
partial `.env`, which would otherwise surface as an obscure runtime error
against a host with no `psql` prompt.

**The OIDC role gets `ssm:SendCommand` only and never reads a parameter.** A
repository compromise yields command execution, not the database password.

The production `.env` never enters git.

## Instance sizing

- **t3.micro in Standard credit mode**, not Unlimited. Unlimited is the T3
  default and bills for sustained CPU bursts; Standard throttles instead.
- **30 GiB gp3 root volume, encrypted** — not the 8 GiB default. Docker
  layers, Postgres, a 2 GiB swap file, and logs will fill 8 GiB. EBS volumes
  can grow but never shrink, and untagged image layers accumulate on every
  deploy.
- **2 GiB swap file**, configured at setup with an `/etc/fstab` entry and
  `vm.swappiness=10`. On a 1 GiB host the default swappiness of 60 will
  evict Postgres's working set to keep page cache warm, which is backwards.
- **Docker log rotation** at install (`max-size 10m`, `max-file 3`).
  The json-file driver has no default limit.
- **Billing alarms and a budget before launching anything.**

---

# Operations

## Open a shell

```bash
aws ssm start-session --target <instance-id>
sudo su - ubuntu
```

Sessions land as `ssm-user`; application files and Docker group membership
belong to `ubuntu`.

`scp` does not work — port 22 is closed. Move files by cloning the repository
on the host, or by pasting a heredoc into the session.

## Break glass

If SSM is unreachable: EC2 console → the instance → Actions → Monitor and
troubleshoot → EC2 serial console → Connect. The screen is blank until you
press Enter. Log in as `ubuntu` with the password set during setup.

## Deploy

Automatic on push to `main`. To run one by hand:

```bash
sudo -u ubuntu /opt/whiteboard/deploy.sh <commit-sha>
```

The script fetches parameters, validates the count, writes `.env`, pulls the
tagged image, brings the stack up, and prunes images older than a week.

## Roll back

```bash
sudo -u ubuntu /opt/whiteboard/deploy.sh <previous-commit-sha>
```

SHA tags are why this works. Confirm the image still exists in GHCR — the
prune filter keeps roughly a week.

Rolling back application code does **not** roll back a migration. If the bad
deploy included a schema change, that has to be reversed deliberately.

## Inspect

```bash
cd /opt/whiteboard
docker compose -f compose.prod.yml ps
docker compose -f compose.prod.yml logs -f app
docker compose -f compose.prod.yml logs caddy     # certificate issues
docker compose -f compose.prod.yml logs migrate   # failed deploys
df -h && docker system df                         # disk pressure
free -h                                           # swap in use
```

## Never run

**`docker compose down -v`.** It destroys the cluster's entire data
directory — every database and every role, not just the one you meant. This
has already happened once in development. On this host that is production.
Postgres data lives in a named volume, and nothing in CI may touch it.

**`docker image prune -af`** without a filter. It will remove the rollback
target.

## Common failures

| Symptom | Cause |
|---|---|
| `sts:AssumeRoleWithWebIdentity` not authorized | OIDC trust policy `sub` doesn't match the immutable format |
| Caddy can't get a certificate | DNS not resolving to the Elastic IP, or port 80 closed |
| `migrate` exits non-zero | A connection string using `localhost` instead of `postgres`, or a role password that doesn't match its URL |
| API restarts repeatedly | Same as above — it can't reach the database |
| 502 from Caddy | API not listening on 3000 |
| Deploy fails on parameter count | A parameter is missing from Parameter Store, or the expected count wasn't bumped after adding one |