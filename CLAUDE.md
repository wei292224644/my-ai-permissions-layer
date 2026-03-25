# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Permissions Layer is an offline-first middleware that intercepts AI agent tool calls, applies user-defined rules, and returns **ALLOW**, **BLOCK**, or **REQUIRES_APPROVAL**. It controls what an agent can do—blocking dangerous actions, requiring approval for sensitive ones, and allowing safe operations by default.

**Key distinction:** Rule matching is fully offline. Only the optional rule compiler (which translates plain-English rules to structured JSON) requires an LLM call.

## Common Commands

```bash
npm run build          # Compile TypeScript → dist/
npm run test           # Run tests once (vitest run)
npm run test:watch     # Run tests in watch mode
npm run build:plugin   # Build core lib + OpenClaw plugin
```

Single test file:
```bash
npx vitest run tests/matcher.test.ts
```

## Architecture

### Core Flow

1. **Rules Source** (YAML, plain English) → **Compiler** (LLM call) → **Compiled Rules** (JSON)
2. **Middleware** receives a `ToolCall + Intent` → **Matcher** checks rules → returns `Decision`
3. **Path Protection** blocks file-writing tools from modifying the rules file itself

### Two Entry Points

- **Library** (`src/middleware.ts`): `createMiddleware(rules, executor, options)` — used by integrators to wrap an agent's tool executor
- **CLI** (`src/cli.ts`): `ai-permissions-compile` — compiles YAML rules to JSON using an LLM

### Key Modules

| File | Purpose |
|------|---------|
| `src/middleware.ts` | `createMiddleware()` — main API for library users |
| `src/matcher.ts` | `match()` — applies rules to a tool call, returns decision |
| `src/compiler.ts` | `compile()` — uses LLM to convert plain-English rules → structured JSON |
| `src/path-protection.ts` | `isProtectedPathViolation()` — blocks writes to rules files |
| `src/rules.ts` | `createAllowRule()` — helper for "approve forever" flow |
| `src/adapters/openai-adapter.ts` | OpenAI-compatible LLM adapter |
| `src/adapters/openclaw-adapter.ts` | OpenClaw config-based adapter (reads `~/.openclaw/openclaw.json`) |

### Rule Matching Logic (`src/matcher.ts`)

- Rules are evaluated in order; first match wins
- `block` takes precedence over `require_approval` when both match the same tool
- `tool` matches exact name; `toolPattern` (regex) and `intentPattern` (regex) are optional refinements
- When no rule matches, `defaultWhenNoMatch` determines behavior (default: `require_approval`)

### OpenClaw Plugin (`openclaw-plugin/`)

The OpenClaw plugin (`openclaw-plugin/src/index.ts`) registers two hooks:
- `before_tool_call` — intercepts and blocks/approves tool calls
- `message_received` — parses `APPROVE <uuid>` / `DENY <uuid>` to consume one-use approvals

Internal tools (`pairing`, `device-pair`, `openclaw.*`) are always bypassed.

### Rules File Location (OpenClaw integration)

- YAML source: `~/.openclaw/rules.yaml`
- Compiled JSON: `~/.openclaw/ai-permissions-rules.json`
- Compile via: `openclaw ai-permissions compile`

## File Layout

```
src/
  index.ts              # Public exports
  middleware.ts         # createMiddleware (library entry point)
  matcher.ts            # match() function
  compiler.ts           # compile() using LLM
  rules.ts              # createAllowRule helper
  path-protection.ts    # isProtectedPathViolation
  llm-adapter.ts        # LLMAdapter interface
  cli.ts                # ai-permissions-compile CLI
  adapters/
    openai-adapter.ts
    openclaw-adapter.ts
openclaw-plugin/
  src/index.ts          # OpenClaw plugin
  src/approval-store.ts # UUID-based one-use approval store
tests/                  # vitest unit tests
examples/
  rules.yaml            # Example input (plain English)
  ai-permissions-rules.json  # Example output (compiled)
```

## TypeScript Config

- Target: ES2022, module: NodeNext, strict mode
- Path alias: `@` → `src/` (used in tests and openclaw-plugin)
