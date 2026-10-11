# BrowserStack-only runtime architecture

## Current architecture

```text
Agent: one Mobile Define Flow skill, interactive confirmation
  -> Node.js JSON-lines gateway + one SessionManager
  -> AndroidPlatformAdapter | IOSPlatformAdapter
  -> one capability builder + BrowserStackProvider
  -> WebdriverIO -> BrowserStack Appium
  -> UiAutomator2 (Android) | XCUITest (iOS) -> remote real device
```

`registry.js` selects a platform adapter and constructs BrowserStackProvider directly.
There is no provider registry or fallback. Logical configuration feeds platform capabilities,
shared lifecycle defaults and BrowserStack augmentation, in that order. Smoke uses the same
pipeline. App provisioning uses an App Automate reference when a session is created.

The provider owns credentials, upload/cache, catalog validation and the cloud connection.
Adapters own app identity, platform caps, source normalization, selectors and navigation.
Android uses package/activity and Android XML; iOS uses bundleId and XCUI XML. Global iOS Back
returns `UNSUPPORTED_OPERATION`; select the visible in-app control instead.
Public elements share role/label/text/accessibilityId/resourceId/enabled/visible/bounds.
Private selector hints stay internal; monotonic ElementRefs expire on UI mutation.

SessionManager owns preflight, creation, activation, current-session/foreground validation and
an idempotent close promise. The gateway serializes commands/heartbeat/signals and closes on
EOF and startup failure. Cleanup errors are sanitized, retain failure status and never
trigger a second deletion attempt. `--no-launch` creates a new session without explicit app activation;
it never resumes another session. An unreturned session handle or abrupt process kill can
leave cleanup to provider timeouts.

## Preserved workflow and safety

The agent proposes visible actions, obtains user selection and outcome confirmation,
appends each confirmed semantic step immediately, and assembles a natural-language spec.
Only the latest step can be corrected. Walkthrough input is preserved with a sibling output.
Final path confirmation and consequential-action gates remain explicit.

The runtime enforces action/output allowlists, target app/session checks and secret env-name
allowlists. Ordinary UI reads/actions check the owned foreground target. Observation blocking
starts before injection or manual handoff and survives partial failure. Manual completion stays
blocked until the user confirms submission and screen clearance after a navigation wait.
Saved-account submission uses protected refs; resume requires submission, a navigation wait
and explicit user clearance. These controls do not infer screen safety. WebdriverIO is silent;
BrowserStack recording and diagnostic logs are disabled and value commands masked. Provider
retention outside these settings is not controlled by the gateway.

## Validation and practical limits

- Automated fixtures cover Android/iOS capabilities, operations, normalization, refs,
  unsupported iOS Back, observation protection, screenshot guards and cleanup. Device calls
  are mocked; these tests do not establish real-device compatibility.
- Real Android and iOS BrowserStack sessions have not been validated as part of this migration.
  In particular, iOS support is fixture-tested only, not verified on a real iPhone.
- Abrupt termination and unreturned handles rely on provider timeouts.
- No unattended regression execution or reporting integration is included.
