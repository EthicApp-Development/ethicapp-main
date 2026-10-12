# Health Diagnostics Runbook

This runbook explains how to configure the management-console health
diagnostics and how to read their results when outbound email, AI features or
other external integrations stop working.

## Scope

The diagnostics page at `/mng/diagnostics` (sidebar entry "Diagnostics") runs
two checks against a fixed list of external hosts:

- DNS resolution: can the container resolve each host name?
- Outbound connectivity: can the container open a TCP connection to each host
  and, for TLS ports, complete a TLS handshake with a valid certificate?

The checks cover the network path from the deployment to its external
dependencies. They do not check application-level behaviour (SMTP
authentication, API keys, HTTP status codes) and they do not check internal
services such as PostgreSQL or Redis.

Only administrators (role `S`) can open the page or call the endpoints.

## Motivating Incident

During the preparation of the 2026-07-09 pilot, the host running the stack was
connected to a Tailscale network. Tailscale had set itself as the host's DNS
resolver, and Docker forwarded container DNS queries to it. When Tailscale DNS
stopped answering, the containers could no longer resolve Google SMTP or the
OpenAI API. The failure surfaced only as broken email and AI features. The
diagnostics page would have shown it directly: every target failing DNS with
`ETIMEOUT` or `ENOTFOUND`, and `100.100.100.100` (Tailscale's resolver) listed
under the upstream resolvers.

## Configuring Targets

The checks only contact hosts listed in `MNG_HEALTH_CHECK_TARGETS` on the
management-console service. Requests to the diagnostics API cannot add or
change targets.

```text
MNG_HEALTH_CHECK_TARGETS=smtp=smtp.gmail.com:465,openai=api.openai.com:443
```

Each entry is `label=host:port`:

| Part | Rule |
| --- | --- |
| Label | Lowercase letters, digits and hyphens, up to 40 characters, unique. |
| Host | Hostname or IP address, without scheme, credentials or path. IPv6 addresses are written as `[address]:port`. |
| Port | 1 to 65535. |
| Entries | At most 20. |

Invalid, duplicate or excess entries are ignored and logged as warnings when
the container starts. The startup log also reports the accepted count:

```text
MNG_HEALTH_CHECK_TARGETS: ignoring entry 2 ("openai=https://api.openai.com:443"): host must be a hostname or IP address without scheme, credentials or path.
Health check targets configured: 2
```

Recommended entries:

- The SMTP relay from `auth-backend`'s `SMTP_HOST` and `SMTP_PORT`.
  management-console does not receive those variables, so list the relay
  explicitly.
- The AI provider endpoints reached by the external-service adapters, such as
  `api.openai.com:443`.
- Any other external API the deployment depends on.

Hosts that only resolve through a per-service `extra_hosts` entry, such as
`host.docker.internal` on the `ethicapp` service, are not resolvable from
management-console and will always fail DNS there. Leave them out.

The variable is part of the environment contract
([`env.contract.yml`](./env.contract.yml)) and the `management-console/.env`
projection. In the deployment repository, set it in the target's environment
values file and render the environment again.

## Running The Checks

Both checks run when the page opens and again with "Run checks". A run takes
at most about 10 seconds. Results from a run in the last 5 seconds are served
from a cache, so the "Last run" time does not change when the button is
pressed repeatedly.

The same data is available from the API, which needs an administrator session
and a CSRF token:

- `POST /mng/api/health/dns`
- `POST /mng/api/health/connectivity`

If the page shows "The check could not be run", the request to the
management-console backend failed. Reload the page, and check the
management-console container logs if the error persists.

## Reading DNS Results

The DNS card first lists two resolver sets:

| Field (API) | Page label | Meaning |
| --- | --- | --- |
| `servers` | Container resolvers | Resolvers in the container's `/etc/resolv.conf`. On a docker compose network this is always `127.0.0.11`, Docker's embedded DNS. |
| `upstreamServers` | Upstream resolvers (Docker) | Resolvers Docker forwards to, read from the `# ExtServers:` comment Docker writes in `/etc/resolv.conf`. These come from the host's resolver configuration or from the Docker daemon `dns` setting. |

On a Linux Docker host, the upstream resolvers are the ones to check. A VPN or
overlay client that manages DNS, such as Tailscale (`100.100.100.100`), shows up
here. On Docker Desktop (macOS, Windows) the value is Docker Desktop's internal
proxy, usually `192.168.65.7`, which hides the host's resolvers. "Not reported
by Docker" (`null` in the API) means the comment was not found.

Each target is then resolved through two paths:

| Field (API) | Page label | Path |
| --- | --- | --- |
| `lookup` | System resolver | The operating system resolver (`getaddrinfo`), the path the applications use. It reads `/etc/hosts` before asking DNS. |
| `resolve` | DNS servers | Direct DNS queries for A and AAAA records to the configured servers, bypassing `/etc/hosts`. |

Each path reports `ok`, the `addresses` found, `latencyMs` and an `error` code.
IP address targets skip DNS and show "Skipped". Each query times out after 3
seconds.

| Observation | Likely cause | Next step |
| --- | --- | --- |
| Every target fails both paths with `ETIMEOUT` | The upstream resolver does not answer. | Check the upstream resolvers on the host (see "Host-Side Checks"). |
| Every target fails the system resolver with `EAI_AGAIN` | Temporary resolver failure: the upstream resolver refused or failed the query. | Same as above. |
| Every target fails both paths with `ENOTFOUND` or `ESERVFAIL` | The upstream resolver answers but cannot resolve public names, for example a VPN resolver that only serves private names. | Same as above. |
| One target fails with `ENOTFOUND`, others are OK | The name itself: a typo in the target, or the record was removed. | Check the host name in `MNG_HEALTH_CHECK_TARGETS` and with an external resolver. |
| System resolver OK, DNS servers fail | The name resolves through `/etc/hosts`, or the resolver path differs. | Inspect `/etc/hosts` in the container. |
| System resolver fails, DNS servers OK | Rare. The system resolver configuration differs from the DNS servers. | Compare `getent hosts` and `nslookup` in the container. |
| `ENODATA` | The name exists but has no A or AAAA records. | Check the DNS records for the host. |

## Reading Connectivity Results

Each target goes through up to three stages, and the result names the first
stage that failed:

| Stage | What happens | Timeout |
| --- | --- | --- |
| DNS | The host name is resolved with the system resolver. | 3 s |
| TCP | A TCP connection is opened to the resolved addresses, IPv4 first. If an attempt does not connect within 250 ms, the next address is tried in parallel. The first connection wins. | 3 s for all attempts |
| TLS | Only for ports 443, 465, 993, 995 and 8443: a TLS handshake with SNI and certificate verification, over the open TCP connection. | 3 s |

Ports with STARTTLS, such as 587 or 25, are checked up to TCP. No application
data is sent, and every socket is closed after the check.

The API reports `reachable`, `failedStage` (`dns`, `tcp`, `tls` or `null`),
`error`, and `stages.dns`, `stages.tcp` and `stages.tls` (`null` when a stage did
not run). `stages.tcp.attempts` lists each address tried with its `outcome`
(`connected`, `failed` or `abandoned`) and error. A successful TLS stage
reports the protocol and the certificate subject, issuer and expiry.

| Failed stage and error | Likely cause | Next step |
| --- | --- | --- |
| `dns`, any code | Name resolution failed. | Read the DNS card. |
| `tcp`, `ECONNREFUSED` | The host answers but nothing listens on that port. | Check the port in the target and the remote service status. |
| `tcp`, `ETIMEOUT` | Packets are dropped on the way: a firewall, an egress policy, or a host that is down. | Check outbound firewall rules on the host and the network. |
| `tcp`, `ENETUNREACH` or `EHOSTUNREACH` on IPv4 addresses | The container has no route to the address. | Check the host's routing and Docker networking. |
| `tls`, `CERT_HAS_EXPIRED` | The remote certificate expired, or the container clock is wrong. | Compare `date` in the container with the real time. |
| `tls`, `SELF_SIGNED_CERT_IN_CHAIN` or `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | A proxy intercepts TLS, or the chain cannot be verified. | Check for a TLS-inspecting proxy on the network path. |
| `tls`, `ERR_TLS_CERT_ALTNAME_INVALID` | The certificate is for another name: DNS points to the wrong server, or a captive portal or proxy answers. | Compare the resolved addresses with the expected ones. |
| `tls`, `ETIMEOUT` | TCP connects but the handshake never completes, often a middlebox. | Same as for TLS interception. |
| `EDEADLINE`, or the "time limit" warning | The 10 second limit for the whole run was reached. | Run again; persistent deadlines point to very slow DNS or network. |

IPv6 attempts that fail with `ENETUNREACH` are normal on Docker networks
without IPv6, as long as an IPv4 attempt connects.

## Results For Other Services

Results show the network as seen from the management-console container. None of
the services in the repository's `docker-compose.yml` defines its own `dns:`
setting, so services in the same compose project use the same embedded DNS and
the same upstream resolvers. Other compose projects on the same Docker daemon,
such as AI Additions, normally share the daemon's DNS configuration as well.

Results can differ for a service that defines its own `dns:`, `extra_hosts`,
network or `network_mode`, or that uses a different egress path (for example a
proxy configured only for that service). For example, `ethicapp` maps
`host.docker.internal` through `extra_hosts`, both in the repository's
`docker-compose.yml` and in the Uandes external-services staging target, and
management-console does not.

## Host-Side Checks

Run these on the Docker host when the diagnostics point to DNS or the network.
Replace the project name and service names with the ones of the target.

```bash
# Resolver configuration seen by the container, including Docker's ExtServers comment.
docker compose exec management-console cat /etc/resolv.conf

# Resolution inside the container through both paths.
docker compose exec management-console getent hosts smtp.gmail.com
docker compose exec management-console nslookup smtp.gmail.com

# Host resolver configuration.
cat /etc/resolv.conf
resolvectl status          # on hosts using systemd-resolved

# Docker daemon DNS override, if any.
cat /etc/docker/daemon.json

# Tailscale DNS state, if Tailscale is installed.
tailscale status
```

If a VPN or overlay client owns the host's DNS and the containers do not need
its private names, either stop it from managing DNS (for Tailscale:
`tailscale set --accept-dns=false`) or set explicit resolvers in the Docker
daemon (`"dns": ["1.1.1.1", "8.8.8.8"]` in `/etc/docker/daemon.json`, then
restart Docker). Containers take their upstream resolvers when they start, so
recreate them afterwards:

```bash
docker compose up -d --force-recreate
```

Then run the diagnostics again and confirm that the upstream resolvers changed
and the targets pass.
