# SDK Smoke Probe

This note records the lightweight local SDK verification used by `sdk-capability-parity.md`.

## Scope

The probe intentionally did not send a model prompt or execute tools. It verified only that the locked SDK package could start the local Copilot server, create an SDK session, return metadata, and preserve a session workspace path.

## Script

```js
import { CopilotClient, approveAll } from "@github/copilot-sdk";

const client = new CopilotClient({ logLevel: "error" });
let session;
try {
  await client.start();
  const status = await client.getStatus();
  const auth = await client.getAuthStatus();
  session = await client.createSession({
    model: "gpt-5.4-mini",
    onPermissionRequest: approveAll,
  });
  const listed = await client.getSessionMetadata(session.sessionId);
  console.log(JSON.stringify({
    status: {
      version: status.version,
      protocolVersion: status.protocolVersion,
    },
    auth: {
      status: auth.status,
      account: auth.account ? {
        username: auth.account.username,
        accountType: auth.account.accountType,
      } : undefined,
    },
    session: {
      sessionIdPresent: Boolean(session.sessionId),
      workspacePath: session.workspacePath,
      capabilities: session.capabilities,
      metadataContext: listed?.context,
    },
  }, null, 2));
  await session.disconnect();
  await client.deleteSession(session.sessionId).catch((error) => {
    console.error(`deleteSession failed: ${error instanceof Error ? error.message : String(error)}`);
  });
} finally {
  if (session) {
    await session.disconnect().catch(() => {});
  }
  const errors = await client.stop().catch((error) => [error]);
  if (errors.length > 0) {
    console.error(`client.stop errors: ${errors.map((error) => error instanceof Error ? error.message : String(error)).join("; ")}`);
  }
}
```

## Observed output

Local username and session ID are replaced with placeholders below.

```json
{
  "status": {
    "version": "1.0.36",
    "protocolVersion": 3
  },
  "auth": {},
  "session": {
    "sessionIdPresent": true,
    "workspacePath": "C:\\Users\\<user>\\.copilot\\session-state\\<session-id>",
    "capabilities": {
      "ui": {
        "elicitation": false
      }
    }
  }
}
```

The SDK session directory was removed after the probe. The `deleteSession` call reported that the session file was not found, so cleanup was performed by deleting the throwaway workspace directory directly.

## Not verified

- Model response generation.
- Tool execution or permission prompts.
- Copilot CLI plugin discovery/loading under SDK-managed sessions.
- Cancellation of an active model turn or spawned tool subprocess.
- Visible Copilot CLI takeover of the SDK-created session.
