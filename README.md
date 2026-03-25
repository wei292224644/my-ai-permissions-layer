# AI Permissions Layer

Middleware that intercepts AI agent tool calls, applies your rules, and returns **allow**, **block**, or **require approval**. Use it to control what your agent can do—block dangerous actions, require approval for sensitive ones, and allow safe operations by default.

---

## Table of Contents

- [Quick Start (OpenClaw)](#quick-start-openclaw)
- [Writing Rules](#writing-rules)
- [OpenClaw Setup & Usage](#openclaw-setup--usage)
- [Rule Reference](#rule-reference)
- [Approval Flow](#approval-flow)
- [Path Protection](#path-protection)
- [Configuration](#configuration)
- [Standalone Compile](#standalone-compile)
- [Library Usage](#library-usage)

---

## Quick Start (OpenClaw)

```bash
openclaw plugins install daniel-ai-permissions-openclaw
openclaw gateway restart
openclaw ai-permissions compile
```

The first `compile` creates `~/.openclaw/rules.yaml` with starter rules if none exist. Edit `rules.yaml`, run `compile` again when you change rules, and you're done. No extra API keys needed if you've run `openclaw onboard`.

---

## Writing Rules

Rules define what the agent can do. Each rule has an **action** and applies to one or more **tools**.

### Actions

| Action | Behavior |
|--------|----------|
| **block** | Tool is never allowed. The agent sees an error and cannot proceed. |
| **require_approval** | Tool is blocked until you reply `yes` (or `y`) in chat. One-time approval per request. |
| **allow** | Tool runs without asking. |

### Plain-Text Format (YAML)

Write rules in plain English, one per line, each starting with `-`:

```yaml
# Block dangerous actions
- block gmail.delete and gmail.batchDelete - never auto-delete emails
- block payments and money transfers - no financial actions
- block exec when command matches "rm -rf or sudo or curl.*sh" - never dangerous commands

# Require approval before risky operations
- require approval before exec, bash, or process - ask before running commands
- require approval before write, edit, apply_patch - ask before file changes

# Allow safe read-only operations
- allow read, search, list - safe read-only operations
- allow gmail.list and gmail.get - reading emails is fine
- allow exec when command matches "ls cat head tail grep pwd which file echo cd" - read-only commands
```

**Compile** these into JSON with `openclaw ai-permissions compile` or `npx ai-permissions-compile --openclaw`. The compiler uses an LLM to infer tool names from your wording.

### Compiler Language Hints

The compiler maps natural language to actions:

| You write | Action |
|-----------|--------|
| "block", "don't allow", "never" | `block` |
| "ask me", "prompt me", "require approval", "before X" | `require_approval` |
| "allow", "ok", "permit" | `allow` |

Include tool names when you know them (e.g. `gmail.delete`, `write`, `exec`). The compiler will infer others (e.g. "payments" → `payments`, "money transfers" → `money_transfers`).

### Compiled JSON Format

After compiling, rules become JSON:

```json
{
  "rules": [
    { "action": "block", "tool": "gmail.delete", "reason": "never auto-delete emails" },
    { "action": "block", "tool": "exec", "argsPattern": "rm -rf", "reason": "never dangerous commands" },
    { "action": "allow", "tool": "exec", "argsPattern": "^(ls|cat|head|tail|grep|pwd)", "reason": "read-only commands" },
    { "action": "require_approval", "tool": "write", "reason": "ask before file changes" },
    { "action": "allow", "tool": "read", "reason": "safe read-only operations" }
  ]
}
```

Each rule: `action`, `tool`, optional `argsPattern`, `reason`. The `argsPattern` field enables fine-grained control over which command arguments trigger a rule. The plugin loads this file; you typically edit the YAML and recompile.

### OpenClaw Tool Names

Common OpenClaw tools to reference in rules:

| Category | Tools |
|----------|-------|
| **Files** | `read`, `write`, `edit`, `apply_patch` |
| **Runtime** | `exec`, `bash`, `process` |
| **Gmail** | `gmail.list`, `gmail.get`, `gmail.send`, `gmail.delete`, `gmail.batchDelete` |
| **Browser** | `browser_*`, `web_*` |
| **Internal** | `pairing`, `device-pair`, `openclaw.*` (these bypass rules) |

Internal tools (pairing, device-pair, openclaw.*) are never intercepted.

### Rule Precedence

- **block** wins over **require_approval** when both match the same tool.
- First matching rule applies. Order matters when you have overlapping rules.
- When **no rule matches**, behavior is set by `defaultWhenNoMatch` (default: `require_approval`).

---

## OpenClaw Setup & Usage

### Installation

```bash
openclaw plugins install daniel-ai-permissions-openclaw
openclaw gateway restart
```

### Compile Rules

```bash
# Default: ~/.openclaw/rules.yaml → ~/.openclaw/ai-permissions-rules.json
openclaw ai-permissions compile

# Custom input
openclaw ai-permissions compile my-rules.yaml

# Custom input and output
openclaw ai-permissions compile my-rules.yaml ~/.openclaw/ai-permissions-rules.json
```

**First run:** If `~/.openclaw/rules.yaml` doesn't exist, it is created with starter rules and compiled.

**Credentials:** Uses OpenClaw's primary model from `~/.openclaw/openclaw.json` and credentials from `~/.openclaw/.env`. Run `openclaw onboard` first if you haven't.

### Workflow

1. Edit `~/.openclaw/rules.yaml`
2. Run `openclaw ai-permissions compile`
3. Rules take effect immediately (plugin reloads on each tool call)
4. Restart the gateway only when changing plugin config

---

## Rule Reference

### Exact Tool Match

Rules match by exact tool name:

```yaml
- block gmail.delete - no auto delete
- allow read - read-only ok
```

### Multiple Tools per Rule

List tools in one rule (compiler creates one JSON rule per tool):

```yaml
- block gmail.delete and gmail.batchDelete - never auto-delete emails
- require approval before write, edit, apply_patch - ask before file changes
```

### Advanced: toolPattern, intentPattern, and argsPattern (JSON only)

For programmatic use, compiled rules can include:

- **toolPattern** — regex to match tool names (e.g. `gmail\.(delete|batchDelete)`)
- **intentPattern** — regex to match user intent text (optional)
- **argsPattern** — regex to match tool call arguments (joined as space-separated string, e.g. `^(ls|cat)` for exec commands)

These are produced by the compiler when you write `when command matches "REGEX"` in YAML. You can also edit the JSON directly for fine-grained control.

---

## Approval Flow

When a tool needs approval:

1. The agent attempts the tool.
2. The plugin blocks it and returns a message showing **what command** it wants to run and a **request ID** (UUID).
3. You reply in chat: `yes` (or `y`) to approve the most recent request, `no` (or `n`) to deny it. Or reply `APPROVE <uuid>` / `DENY <uuid>` for a specific request.
4. If you approved, the agent can retry the same action; the approval is consumed.

**Example:**

```
Agent: I'll run `rm` to clean up temp files.
[Approval required] ask before running other commands
Command: rm -rf /tmp/garbage

Request ID: a1b2c3d4-...
Reply yes to allow, or no to block. Or: APPROVE a1b2c3d4-... / DENY a1b2c3d4-...

You: yes

Agent: [retries the rm; it succeeds]
```

**Shortcuts:**

| Reply | Behavior |
|-------|----------|
| `yes` or `y` | Approve the most recent pending request |
| `no` or `n` | Deny the most recent pending request |
| `APPROVE <uuid>` | Approve a specific request |
| `DENY <uuid>` | Deny a specific request |

---

## Path Protection

The plugin blocks the agent from modifying its own rules file. Writes to paths matching `**/rules*.json` or `**/.config/ai-permissions-layer/**` via `write`, `edit`, or `apply_patch` are blocked regardless of your rules.

This is enabled by default. Disable or customize via `pathProtection` in plugin config.

---

## Configuration

Edit `~/.openclaw/openclaw.json` under `plugins.entries.daniel-ai-permissions-openclaw.config`:

| Option | Default | Description |
|--------|---------|--------------|
| `rulesPath` | `~/.openclaw/ai-permissions-rules.json` | Path to compiled rules JSON |
| `defaultWhenNoMatch` | `require_approval` | When no rule matches: `allow`, `require_approval`, or `block` |
| `pathProtection.enabled` | `true` | Block writes to rules file |
| `pathProtection.dangerousTools` | `['write','edit','apply_patch']` | Tools that can write files (for path protection) |

**Example:**

```json
{
  "plugins": {
    "entries": {
      "daniel-ai-permissions-openclaw": {
        "enabled": true,
        "config": {
          "rulesPath": "~/.openclaw/ai-permissions-rules.json",
          "defaultWhenNoMatch": "require_approval",
          "pathProtection": {
            "enabled": true
          }
        }
      }
    }
  }
}
```

---

## Standalone Compile

Without OpenClaw, use the npm CLI:

```bash
# With OpenAI (requires OPENAI_API_KEY)
export OPENAI_API_KEY=your_key
npx ai-permissions-compile examples/rules.yaml ~/.openclaw/ai-permissions-rules.json

# With OpenClaw config (uses ~/.openclaw/.env and openclaw.json)
npx ai-permissions-compile --openclaw examples/rules.yaml ~/.openclaw/ai-permissions-rules.json
```

**Format:** One rule per line, each starting with `-`. See [examples/rules.yaml](examples/rules.yaml).

---

## Library Usage

```bash
npm install daniel-ai-permissions-layer
```

```ts
import { createMiddleware, match } from 'daniel-ai-permissions-layer';

const rules = [
  { action: 'block', tool: 'gmail.delete', reason: 'no delete' },
  { action: 'block', tool: 'exec', argsPattern: 'rm -rf', reason: 'never delete recursively' },
  { action: 'allow', tool: 'exec', argsPattern: '^(ls|cat|grep)', reason: 'read-only commands' },
  { action: 'require_approval', tool: 'gmail.send', reason: 'ask first' },
  { action: 'allow', tool: 'read', reason: 'read-only ok' },
];

const middleware = createMiddleware(rules, executor, {
  defaultWhenNoMatch: 'require_approval',
  pathProtection: {},
});

const result = await middleware(
  { toolName: 'gmail.delete', args: {} },
  { text: 'delete emails' }
);
// result.decision === 'BLOCK', result.executed === false
```

---

## Examples

- [examples/rules.yaml](examples/rules.yaml) — plain-text rules
- [examples/ai-permissions-rules.json](examples/ai-permissions-rules.json) — compiled JSON

---

## License

GPL v3.
