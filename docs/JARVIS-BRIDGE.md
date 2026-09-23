# Jarvis Mk3 bridge

Metis can call the existing Jarvis Mk3 core through an optional child MCP server. The two applications keep separate databases, users and runtimes. The bridge offers exactly three tools:

| Tool | Jarvis route | Effect |
| --- | --- | --- |
| `jarvis_status` | `GET /healthz` | Read core health |
| `jarvis_submit_task` | `POST /api/tasks` | Queue a goal in Jarvis |
| `jarvis_task_status` | `GET /api/tasks/{id}` | Read one task's state and result |

The bridge has **no approval, cancellation, device, filesystem or administration tool**. If a task waits for approval, decide it in Jarvis's own approval flow. Metis must not infer that submitting a task grants permission for its later actions.

## Configuration on Linux

The child server is `lib/mcp-core/jarvis-bridge.mjs`. It is disabled unless `JARVIS_BRIDGE_ENABLED=1` is set in the MCP gateway process. Configure a long Jarvis API bearer token using exactly one of:

- `JARVIS_BRIDGE_TOKEN_FILE=/absolute/path/to/token` (preferred; a regular file readable only by its owner, mode `0600` or stricter on Linux), or
- `JARVIS_BRIDGE_TOKEN=<token>` in the server environment.

Optional settings:

| Variable | Default | Constraint |
| --- | --- | --- |
| `JARVIS_BRIDGE_URL` | `http://127.0.0.1:3213` | HTTP(S) origin on localhost or a literal RFC 1918/IPv6 unique-local address; no credentials, path, query or public host |
| `JARVIS_BRIDGE_TIMEOUT_MS` | `5000` | Integer from 100 to 10000 |

Keep the token out of Git, browser code, chat prompts and the Metis `.env` if that file is shared with app and worker services. For a native systemd deployment, put the settings in a root-managed drop-in for the **MCP gateway unit only** and give its service user read access to the token file. Restart only that unit after changing the settings. The Jarvis core must have its own matching `JARVIS_API_TOKEN` and remain bound to loopback or a private interface.

For the default unit name, a drop-in can contain only references to the secret file:

```ini
# /etc/systemd/system/jarvis-mk3-1-workspace-mcp.service.d/jarvis-bridge.conf
[Service]
Environment=JARVIS_BRIDGE_ENABLED=1
Environment=JARVIS_BRIDGE_URL=http://127.0.0.1:3213
Environment=JARVIS_BRIDGE_TOKEN_FILE=/etc/jarvis-mk3-1/jarvis-bridge-token
```

Create the referenced file outside the repository with the Jarvis API token and mode `0600`, owned by the Metis MCP service user. Run `systemctl daemon-reload` and restart that MCP unit after reviewing the drop-in. Adapt the unit name if the Metis installer used a custom service name.

The default Metis registry entry `jarvis-mk3` is disabled. A host administrator must explicitly enable it after setting the gateway environment. Then discover `jarvis_status`, `jarvis_submit_task` and `jarvis_task_status` on that child server. An explicit run capability manifest must grant those tools where applicable.

In Docker, `127.0.0.1` inside the MCP container is **the container**, not the Linux host. The default URL therefore only works when both services share a network namespace. For a Compose deployment, give the MCP service alone a private route to Jarvis and mount the token file read-only into that service; set `JARVIS_BRIDGE_URL` to the literal private address and port. Bind Jarvis to that private interface and restrict it with a firewall or a dedicated container network. Do not expose port 3213 to the public internet. Metis's app and worker containers do not need the token.

## Request and safety behavior

- The bridge accepts only a local or private IP destination. `localhost` is converted to `127.0.0.1` without DNS resolution. Public addresses, arbitrary hostnames, URL credentials and redirects are rejected.
- All requests use a fixed route, a bearer token, a short timeout and a bounded JSON response. Errors omit response bodies and token values.
- `jarvis_submit_task` accepts only `goal`, optional `conversation` (default `metis`) and optional `idempotency_key`. Reuse the same key when retrying an uncertain submission to avoid duplicate Jarvis tasks.
- `jarvis_task_status` accepts only a UUID returned by Jarvis. Results are shortened for the tool response. A `waiting_for_approval` status includes an instruction to use Jarvis's own approval flow.
- The bridge does not copy Metis memory or chat history into Jarvis. Only the submitted goal and conversation name are sent.

## Verification

Run the focused, network-free tests with Node.js 22 or newer:

```bash
node --test tests/jarvis-bridge.test.mjs
node --check lib/mcp-core/jarvis-bridge.mjs
```

On the eventual Linux host, verify Jarvis's `/healthz`, enable the registry entry, call `jarvis_status`, submit a harmless task with an idempotency key, and inspect it with `jarvis_task_status`. Test a task requiring approval and confirm that it remains pending until explicitly decided in Jarvis.
