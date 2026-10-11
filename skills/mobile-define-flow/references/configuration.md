# BrowserStack-only configuration

Run from the consumer project root. `--config <path>` selects one complete JSON file,
relative to that root; the default is `config/mobile.json`. No merging or fallback occurs.
`--platform android|ios` overrides only the platform, so app identity and device settings
must already match that choice. A missing or invalid configuration stops the command.

This standalone definition gateway does not consume `environments/<env>.json` or
`defaultEnvironment`. Agentex's existing `project_config.js` resolver selects environment
blocks, not complete gateway configurations; using it here would change this contract.
The existing mobile-testing configuration remains separate and unchanged.

## Complete example

Create this in the consumer project, replacing the device/OS and app placeholders:

```json
{
  "provider": "browserstack",
  "platform": "android",
  "device": {
    "name": "YOUR_BROWSERSTACK_DEVICE",
    "osVersion": "YOUR_OS_VERSION"
  },
  "app": {
    "package": "com.example.app",
    "browserstackAppRef": "bs://YOUR_UPLOADED_APP"
  },
  "runtime": {
    "newCommandTimeoutSeconds": 3600,
    "heartbeatSeconds": 45,
    "maxDumpElements": 300
  },
  "paths": {
    "specRoot": "test/mobile-suite1",
    "scratchRoot": ".scratch/mobile-define-flow",
    "artifactRoot": "artifacts/mobile-define-flow",
    "screenshotRoots": [
      ".scratch/mobile-define-flow",
      "artifacts/mobile-define-flow"
    ]
  },
  "safety": {
    "allowedOperations": [
      "status",
      "dump",
      "screenshot",
      "app.launch.target",
      "tap",
      "tap.coordinatesFallback",
      "typeNonSecret",
      "typeSecretFromAllowlistedEnv",
      "submitSecret",
      "beginManualAuth",
      "completeManualAuth",
      "resumeObservation",
      "swipe",
      "longpress",
      "button.back",
      "button.home",
      "wait",
      "close"
    ],
    "authentication": {
      "allowedMode": "manual",
      "secretEnvNames": []
    }
  },
  "browserstack": {
    "usernameEnv": "BROWSERSTACK_USERNAME",
    "accessKeyEnv": "BROWSERSTACK_ACCESS_KEY",
    "appUrlEnv": "BROWSERSTACK_APP_URL",
    "appCache": ".runtime/browserstack/app.json"
  }
}
```

For iOS, set `platform` to `ios`, replace `app.package` with `app.bundleId`, and use an
uploaded IPA reference and matching iPhone/OS. Android optionally accepts `app.activity`.
For explicit upload, set `app.path` to the APK/AAB (Android) or IPA (iOS).

The provider is always BrowserStack App Automate. Do not supply raw capabilities or retired
fields (`providers`, `platforms`, `backend`, `adbPath`, `deviceSelection`, `appId`, `activity`,
or `device.id`). Local devices and local Appium fallback are unsupported.

## Dependencies and credentials

Use Node.js 20.12+ (needed by the runtime's `.env` loader). Install `webdriverio` in the
consumer project, for example `npm install --save-dev webdriverio@^9.32.0`; the plugin resolves
it there and bundles no npm packages. BrowserStack hosts Appium and the platform drivers.

Set the named BrowserStack credential variables in the consumer's ignored `.env` or process
environment. Never paste values into chat or commit them. App reference precedence is the
named app URL variable, then `app.browserstackAppRef`, then `browserstack.appCache`.
Cache paths must be relative `.json` files beneath `.runtime/browserstack/`, for example
`.runtime/browserstack/ios/app.json`. Absolute/traversal paths, symlinks/junctions and hard-linked
files are rejected before upload. Existing files must be recognized upload caches; arbitrary
JSON is never overwritten. Cache replacement is atomic and checked again after upload.
If an older custom cache lives elsewhere, move only that known cache into this directory and
update `appCache`; the gateway does not migrate project files automatically.
Separate platforms should use separate app references/cache paths. Optional provider fields
include `projectName`, `buildName`, `sessionName`, and upload `customId`.

Ignore `.scratch/`, `.runtime/`, `artifacts/`, `.env` and `node_modules/` in the consumer
project; merge these entries without replacing its existing `.gitignore`.

Authentication defaults to manual. The action allowlist must include `beginManualAuth`,
`completeManualAuth`, and `resumeObservation` to use that workflow. Existing configurations
must add these names explicitly; they are never silently enabled. Start protection before
handing control to the user, confirm submission, then obtain clearance before observing again.
This manual path also supports non-fixed OTPs while in saved-test-account mode.
To enable saved disposable test-account authentication,
set `allowedMode` to `savedTestAccount` and allowlist environment names in `secretEnvNames`
(e.g. `MOBILE_TEST_PASSWORD`). An optional `otpSecretName` identifies a fixed test OTP.
Current-run authorization and the protected secret-entry protocol still apply; see
[gateway-protocol.md](gateway-protocol.md). Never add secret values to configuration.

## Commands

Run `node "${CLAUDE_PLUGIN_ROOT}/skills/mobile-define-flow/scripts/cli.js"` with:

- `--validate-config`: offline configuration validation; no device or network access.
- `--check`: dependency, credential, app-reference and catalog checks; no reservation.
- No mode flag: create the interactive session and wait for JSON-lines commands.

The sibling `tools.js` accepts `devices`, `upload`, or `smoke`. `devices` checks the configured
catalog match, not current capacity. `upload` uploads the configured archive and writes the
reference cache. `smoke` reserves a real device, launches the app, captures a screenshot and
closes it. Upload and real-device operations require the user's authorization.

Both entrypoints accept `--platform` and `--config`; preflight and session must use the same
selection. They do not require consumer npm aliases. The interactive gateway retains its
`ok`/`event` JSON-lines protocol and existing exit codes; it is not a test verdict runner.
Remote recording/debug/network/device/Appium logs are disabled by the provider configuration.
See [runtime-architecture.md](runtime-architecture.md) for lifecycle and validation limits.
