---
description: "Define a native mobile test flow by doing it on a BrowserStack real device: an agent-led Android or iOS session that executes each step live, confirms the observed outcome, then saves a reusable natural-language mobile spec. Usage: /mobile-define-flow [android|ios] [--config <path>] [existing-spec-path]. Pass an existing spec path to walk it through step by step and clarify it."
---

Use the **mobile-define-flow** skill to run a guided mobile definition session.

Arguments: $ARGUMENTS

**Mode (from the arguments):**
- If the arguments contain a path to an existing `.md` mobile spec, verify that it is a file
  and run the skill's **walkthrough mode** over it.
- Otherwise, define a **new flow** from scratch.

**Platform (if given in the arguments):**
- A bare `android` or `ios`, or `--platform android|ios`, explicitly selects that platform.
- Reject conflicting or unsupported platform selections. If none is given, use `platform` from
  the resolved mobile configuration.
- Apply the same selected platform to preflight and the interactive session.

**Configuration (if given in the arguments):**
- `--config <path>` selects the existing complete mobile configuration at that path, resolved
  from the consumer project root. Verify that it is a file before starting.
- Without `--config`, use `config/mobile.json`. If the resolved file is missing, report the
  path and stop. Do not create, merge, or infer another configuration.
- An explicit platform uses the runtime's existing `--platform` override; the resolved
  configuration must still contain compatible device and app settings for that platform.

Use the same platform/config resolution in new-flow and walkthrough modes. Then follow the
skill's existing setup -> define loop -> assemble -> validation lifecycle. The session is one
sitting, forward-only, and driven by you, the main agent. The command only resolves intent and
delegates; the skill owns device interaction, safety, gateway use, spec creation, and validation.
