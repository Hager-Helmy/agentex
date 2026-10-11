# BrowserStack Mobile Define Flow gateway

The one runtime path is Agent -> Node.js gateway -> WebdriverIO -> BrowserStack Appium ->
UiAutomator2 (Android) or XCUITest (iOS) -> BrowserStack real device.

```text
node "${CLAUDE_PLUGIN_ROOT}/skills/mobile-define-flow/scripts/cli.js" --check
node "${CLAUDE_PLUGIN_ROOT}/skills/mobile-define-flow/scripts/cli.js"
node "${CLAUDE_PLUGIN_ROOT}/skills/mobile-define-flow/scripts/cli.js" --platform ios --config config/my-ios.json
node "${CLAUDE_PLUGIN_ROOT}/skills/mobile-define-flow/scripts/tools.js" devices
node "${CLAUDE_PLUGIN_ROOT}/skills/mobile-define-flow/scripts/tools.js" upload
```

Preflight and start must use the same platform/config. `--validate-config` is offline validation.
Device selection is the logical name/OS in configuration. Wait for `ready` in one persistent
PTY; then send one JSON object plus newline and wait for its response before sending another.
Session ids and provider connection details remain internal; never attach another client.
`--no-launch` skips explicit app activation in a NEW allocation; it does not recover an existing
screen/session.

## Observe

```json
{"action":"status"}
{"action":"dump"}
{"action":"screenshot","output":".scratch/mobile-define-flow/<session>/screen-01.png"}
{"action":"wait","milliseconds":3000}
```

`currentPackage` is a compatibility field containing the foreground package or bundle id.
`dump` normalizes source through the selected adapter, then assigns fresh monotonic refs.
Each dump replaces the ref table; UI mutations and waits invalidate refs, including failures.
Dump, screenshot and ordinary UI actions verify the owned session and target app before
reading or acting. A rejected UI target check invalidates refs; take a fresh dump after
returning to the configured app. `launch` can return to that app without a fresh dump.

## Interact

```json
{"action":"launch"}
{"action":"tap","target":"@e5"}
{"action":"tapPoint","point":{"x":540,"y":1800},"reason":"noAccessibleElement"}
{"action":"type","text":"disposable non-secret data"}
{"action":"swipe","from":{"x":540,"y":1700},"to":{"x":540,"y":500},"duration":600}
{"action":"longPress","target":"@e8","duration":1000}
{"action":"back"}
{"action":"home"}
```

`longpress` remains a spelling alias. Type uses the focused field. Take a fresh dump before/after
changes. Use coordinates only when the visible target has no accessible element. Coordinates
use the driver's window coordinate space (iOS points can differ from screenshot pixels).
Never persist refs, coordinates or concrete generated values in reusable specs.

Android `back` invokes system Back; iOS returns `UNSUPPORTED_OPERATION`, so choose a visible
in-app navigation control from a fresh dump. Home uses each platform's native Home action.
`launch` activates only the configured app; BrowserStack provisions its archive at allocation.

## Secrets

### Manual entry

Before the user enters anything in the authorized remote-device view, take the last safe
dump of the empty field, obtain current-run authorization and send:

```json
{"action":"beginManualAuth","confirmAuth":true}
```

Wait for `manualAuthStarted` with `observationBlocked:true`, then let the user enter and
submit privately. Do not request the value. While blocked, no source, screenshot, typing,
tapping or navigation is permitted. `status` reveals no foreground/source; `wait` and `close`
remain available. `submitSecret` cannot be used for manual entry.

After the user confirms submission (including any OTP/consequential confirmation):

```json
{"action":"completeManualAuth","confirmAuth":true,"confirmSubmitted":true}
{"action":"wait","milliseconds":3000}
{"action":"resumeObservation","confirmSecretScreenCleared":true}
```

Completion stays blocked. Resume requires at least two seconds since the completion
confirmation, explicit user confirmation that the secret screen cleared, and the owned
session/target app still foreground. Failed or missing confirmations keep protection active.
A cancelled or uncertain login must close the session without another dump/screenshot.
These flags relay user confirmations; the gateway cannot infer screen safety or prevent
someone typing in the remote view before protection starts.

### Saved test account

```json
{"action":"typeSecret","secretName":"MOBILE_TEST_PASSWORD","confirmAuth":true}
{"action":"submitSecret","target":"@e9","confirmAuth":true}
{"action":"wait","milliseconds":3000}
{"action":"resumeObservation","confirmSecretScreenCleared":true}
```

Take the last safe dump while the focused secret field is empty. Use allowlisted environment
names only. The submit target comes from that dump (`ENTER` is also supported). Its protected
ref survives waits. Observation blocks before injection and remains blocked on partial failure.
Only status without source, wait, authorized saved-account submit, confirmed resume and close
are available during saved-account entry. Manual completion is valid only for manual entry.
A configured fixed OTP may auto-submit and requires immediate explicit user authorization.
Resume requires submission/navigation time and the user's confirmation of screen clearance.

## Close and errors

```json
{"action":"close"}
```

The gateway runtime owns lifecycle; close, stdin EOF, startup failure and signals release its
one remote session. Serialized heartbeats keep that same session alive without taking source
or screenshots. Heartbeat failure marks the flow incomplete, attempts cleanup and exits nonzero.
Cleanup failures on signals, EOF, explicit close or heartbeat emit sanitized `cleanupError`
with `CLEANUP_FAILED` and a nonzero exit status; the provider may retain the session until timeout.
Repeated close requests share the original cleanup result rather than retrying deletion.
Errors use `ok:false`, `event`, `code` and a sanitized message. Actions are restricted by `safety.allowedOperations`.

## Scope

This gateway currently supports BrowserStack real devices only.

Supported platforms:
- Android via UiAutomator2
- iOS via XCUITest

Local-device execution is out of the current scope.
