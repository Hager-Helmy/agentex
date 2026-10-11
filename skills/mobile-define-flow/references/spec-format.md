# Mobile flow specification format

Save under `test/mobile-<suite>/` (the example configuration uses `test/mobile-suite1`).
These are definition artifacts; execution requires separately configured mobile-testing support.

Use this format when promoting a confirmed live draft. Keep actions and assertions in natural
language. Do not include transient gateway refs, coordinates, Appium session ids, passwords,
OTPs, tokens, or real personal data.

```markdown
# <Flow title>

Status: defined live

## Target

- Platform: <Android or iOS> remote real device
- Provider used for definition: BrowserStack App Automate
- Application id: `<configured package or bundleId>`
- Entry activity: `<configured Android activity, if applicable>`
- Execution: stateful; run in order in one app session

## Goal

<One-sentence user goal>

## Preconditions

- <Required app/account/state conditions>

## Test data

- <Symbolic or disposable data guidance; no secrets>

## Acceptance criteria

- <Observable outcomes that define success>
- No unexpected crash, blocking error, or navigation failure occurs.

## Scenario

1. <Action described by visible label/role and user intent.>
   - Expected: <Observable result confirmed during definition.>
2. <Next action.>
   - Expected: <Observable result.>

## Captured values

- `<symbolic name>`: produced in step N and resolved fresh during each run.

## Safety gates

- <Any step requiring explicit confirmation immediately before execution.>

## Notes

- <Relevant device/app behavior and non-sensitive session examples.>
```

Write a stable resource id only as an optional execution hint when it is actually present and
useful. The action's visible meaning remains the primary target.
