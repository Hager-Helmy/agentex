# Mobile Define Flow

`/mobile-define-flow` creates or clarifies a natural-language mobile spec through an
interactive BrowserStack App Automate session on one Android or iOS real device.
The main agent proposes an action, you select it, and you confirm the observed result
before the step is saved. It does not generate test code or dispatch subagents.

## Setup and configuration

1. In the consumer project, use Node.js 20.12+ and install
   `npm install --save-dev webdriverio@^9.32.0`.
2. Create `config/mobile.json` from the complete
   [configuration example](../skills/mobile-define-flow/references/configuration.md).
   Configure the actual app identity, uploaded app reference, device and OS.
3. Set the named BrowserStack credential variables locally in the ignored `.env` or process
   environment. Do not share their values. Ignore transient output paths as documented.
4. Run offline validation with
   `node "${CLAUDE_PLUGIN_ROOT}/skills/mobile-define-flow/scripts/cli.js" --validate-config`
   from that project. The installed plugin supplies the runtime; npm aliases are unnecessary.

Configuration is independent of the existing mobile-testing environment block. `--config`
selects a complete file and `--platform` changes only its platform, not its app/device fields.
No global settings, scaffold migrations or changes to existing test execution are required.

## Usage

```text
/mobile-define-flow android
/mobile-define-flow ios --config config/mobile-ios.json
/mobile-define-flow --config config/mobile.json test/mobile-suite1/login.md
```

An existing spec selects walkthrough mode: it remains unchanged and clarifications go into
a new sibling file. New flows default to the configured `paths.specRoot`. Only the latest
step may be corrected; the session is forward-only. Confirm the final output path before
saving. An optional replay happens in the same open session before it closes; unreachable
preconditions skip replay. A closed session is never reused. Cancellation retains an explicitly
incomplete draft.

Preflight checks the remote catalog without reserving a device. Starting the session reserves
a real device; an app upload is separate and explicit. The agent keeps one persistent gateway
and closes it after the sitting. See the [gateway protocol](../skills/mobile-define-flow/references/gateway-protocol.md).

## Limitations

- BrowserStack real devices only; no local Appium/device fallback or unattended runs.
- iOS is fixture-tested only; real-device iOS behavior has not been verified in this migration.
  No real Android BrowserStack session was run during migration either.
- Global Back is unsupported on iOS; use a visible in-app navigation control.
- Manual authentication starts with `beginManualAuth` before the user types privately.
  `completeManualAuth` confirms submission but keeps observation blocked until a navigation
  wait and explicit screen-clearance confirmation through `resumeObservation`. Saved-account
  injection keeps its existing protected workflow. No screenshots/source are taken while blocked. Consequential actions require explicit confirmation immediately beforehand.
- Upload caches stay beneath `.runtime/browserstack/`; unsafe paths and unrelated existing
  files are rejected before upload. Cleanup failures are reported with a nonzero exit status.
- A disconnect retains an incomplete draft, not a resumable session. Abrupt process loss can
  leave a cloud session until the provider timeout.
- This is definition, not execution/reporting. Existing `/execute-mobile-test` requires its
  own configuration and does not automatically reuse this BrowserStack gateway. Do not send
  these mobile prose specs to `/execute-test`, which treats prose as browser steps.
