---
name: mobile-define-flow
description: >
  Define or clarify native Android/iOS flows interactively on one remote real device in
  BrowserStack App Automate through a restricted Node.js gateway, then save reusable
  natural-language specs. Local devices, unattended execution and test-code generation
  are not supported.
---

# Mobile Define Flow

## Role

Lead one observe -> propose -> user selects -> act -> observe -> user confirms -> save semantic step loop.
The deliverable is a reusable natural-language mobile spec. All sessions use BrowserStack
App Automate real devices. Android and iOS share the same workflow and gateway contract.

## Setup

1. Work from the consumer project root. Resolve `--config <path>` when supplied, otherwise
   `config/mobile.json`; stop if that complete configuration file is missing. Read it and
   [references/gateway-protocol.md](references/gateway-protocol.md). Treat app identity,
   allowed operations, authentication and output paths as project policy.
2. Select `platform: android|ios` from the user's request and configuration. BrowserStack is
   the only provider. Read [references/configuration.md](references/configuration.md) when
   configuring device name/OS, app identity/reference or credentials. Never invent these values.
3. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/mobile-define-flow/scripts/cli.js" --check` with the selected `--platform` / `--config` arguments.
   It checks credentials, the uploaded app reference and device catalog without reserving a
   device. Stop on failure. For a user-requested BrowserStack session only, use `node "${CLAUDE_PLUGIN_ROOT}/skills/mobile-define-flow/scripts/tools.js" upload`
   when the configured app archive needs uploading; never silently upload during preflight.
4. Create a unique directory under `paths.scratchRoot` and immediately start `draft.md`.
5. Start `node "${CLAUDE_PLUGIN_ROOT}/skills/mobile-define-flow/scripts/cli.js"` with the same arguments in one persistent PTY. Retain the
   terminal session id, wait for `ready`, and verify the configured platform/device name/OS.
   The gateway owns one remote session; never attach another client to its session id.
6. Capture the initial `dump` and screenshot through that gateway. Ask for the flow goal in
   one sentence if absent and propose it as the spec title.
7. An existing `.md` spec path selects walkthrough mode; otherwise define a new flow.

All commands run from the consumer project root; runtime files stay inside the installed plugin.
Project configuration, dependencies and `.env` belong to the consumer project. See
[configuration](references/configuration.md) for a complete example and setup requirements.

## Session boundaries

- The main agent conducts the full loop; do not delegate it.
- Use one persistent gateway and one selected device for the whole sitting. Never attach
  another client, call device drivers directly, build capabilities, or choose a raw
  transport. Send only the commands in the gateway protocol.
- One sitting, forward-only: only the last executed step can be corrected and rerun. Earlier
  confirmed steps stay fixed. After a disconnect, offer the incremental draft as explicitly
  incomplete; it is not resumable.
- Take a fresh dump before and after UI changes, except during the protected secret sequence.
  Prefer fresh semantic refs. Coordinate fallback requires no accessible target and remains
  transient. Never put refs, coordinates or session ids in the final spec.
- Save drafts and transient screenshots under the configured scratch root. These screenshots
  support confirmation and are not normal test evidence.
- Do not install/uninstall apps, clear app data, reboot, change location, access device files
  or clipboard, navigate to another app, or create/edit/remove accounts. Cloud provisioning
  of the configured uploaded app is owned by the provider at session creation. An app upload
  is allowed only as part of a user-requested BrowserStack session.
- Never print or persist passwords, OTPs, tokens, payment data or real personal information.
  Use disposable data; keep concrete non-sensitive examples only in Notes.
- `back` on iOS is unsupported. Propose tapping the visible in-app navigation control instead.
  Do not reinterpret an unsupported operation as a passed action.

## Define loop

Repeat until the user says the flow is complete:

1. Inspect the latest dump and screenshot. Describe visible state without inferring hidden state.
2. Propose the next useful action by visible label/role. Offer short numbered choices when useful.
3. Execute only the selected action through the existing gateway.
4. Re-dump and screenshot the non-secret result. Describe what actually happened.
5. Ask the user to confirm the expected result or correct the just-executed step.
6. On confirmation, append one numbered semantic action and expected result to the draft.
   Show the running confirmed-step list. Labels, roles, accessibility labels and stable ids
   are semantic hints; transient refs and coordinates are never source of truth.
7. Record generated values symbolically, e.g. "the quote number produced in step 4."

## Authentication and consequential actions

Agent decisions: obtain current-run authorization before saved-test-account authentication.
Immediately before payment, policy issuance, purchase, final submission, account deletion or
OTP confirmation, describe the exact effect and obtain explicit user confirmation. A flow
outline alone is not authorization for these actions.

Runtime enforcement: allowlisted secret environment names, target session/app validation,
restricted actions/output paths and blocked observation while secrets are present.

For manual entry (also used for non-fixed OTPs), obtain current-run authorization and a safe
dump of the empty field. Send `beginManualAuth` with `confirmAuth:true` and wait for
`manualAuthStarted` / `observationBlocked:true` **before** handing control to the user in the
authorized remote-device view. The user enters and submits privately. Once they confirm
submission, send `completeManualAuth` with `confirmAuth:true` and `confirmSubmitted:true`.
Wait at least two seconds, ask the user to confirm the secret screen has cleared, then use
`resumeObservation` with `confirmSecretScreenCleared:true`. Never inspect the screen to decide
whether it is safe. Missing/failed confirmation keeps observation blocked; on cancellation or
uncertainty, close the session. Read the manual protocol in the gateway reference first.

Automated authentication requires `safety.authentication.allowedMode: savedTestAccount`:

1. Select the already saved test account and Password method. Focus the empty field and take
   the last safe dump. Save the visible submit ref from that dump.
2. Use `typeSecret` with the configured environment name and `confirmAuth:true`. Never send
   the value. If missing, ask the user to configure it locally; never request it in chat.
3. Observation is blocked before injection, including if injection fails. Submit only through
   `submitSecret` with current-run authorization. Do not dump/screenshot a populated secret screen.
4. A configured fixed test OTP may auto-submit. Obtain explicit OTP confirmation immediately
   before its `typeSecret` command. Other secret entry must use the protected manual lifecycle above; never ask for secrets in chat.
5. After submission, wait for navigation and ask the user to confirm the secret screen has
   cleared. Only then use `resumeObservation` with `confirmSecretScreenCleared:true`.

## Assemble and finish

Read [references/spec-format.md](references/spec-format.md). Assemble the confirmed draft with
app target, preconditions, data guidance, acceptance criteria, stateful steps/results, symbolic
values and consequential-action gates. Propose a slugged path under `paths.specRoot`; save after
the user confirms the path. **Before closing**, offer one clean interactive replay in the
same still-open session. If accepted, keep all confirmation and authentication gates, navigate
normally to the preconditions, and replay; never reset app data. If preconditions cannot be
reached safely, report them and skip replay. If declined, skip directly to closing.
After replay finishes or is skipped, close with `{"action":"close"}` and remove only this
session's transient screenshots/draft after saving. On cancellation, close and retain the incomplete draft.
If the gateway process is lost, report the incomplete flow and the possibility of an abandoned
cloud session until its provider timeout.

Walkthrough mode reads the existing spec without editing it, executes in order using the same
loop, and saves clarifications as a new sibling spec. Edit a cross-reference in the original
only if explicitly requested after the new spec is saved.

Closing ends the sitting: never attempt replay on a closed gateway or silently allocate
a replacement session. A later replay request requires a separately authorized new sitting.

## Currently unsupported / out of scope

Local Android/iOS devices, ADB/xcrun discovery, local Appium servers and local-device fallback
are not implemented. Mobile QA execution, parallel runs and reporting belong to the existing
`mobile-testing` capability, not this definition session. Its configuration and device transport
are separate; do not promise automatic BrowserStack replay through `/execute-mobile-test`.
Do not send mobile prose specs to the browser-oriented `/execute-test`. A system overlay or locked remote device is a blocker, never a
reason to unlock a phone or enter a device PIN.
