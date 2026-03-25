/**
 * AI Permissions Layer - OpenClaw Plugin
 *
 * Intercepts tool calls via before_tool_call hook, applies user-defined rules,
 * returns ALLOW | BLOCK | REQUIRES_APPROVAL. Zero-setup: uses OpenClaw's model config.
 * REQUIRES_APPROVAL: generates one-use UUID, prompts user; APPROVE/DENY consumed via message_received.
 */

import {
  match,
  compile,
  createOpenClawAdapter,
  isProtectedPathViolation,
  OPENCLAW_DANGEROUS_TOOLS,
  DEFAULT_PROTECTED_PATTERNS,
  type CompiledRule,
  type DefaultWhenNoMatch,
  type PathProtectionConfig,
} from 'daniel-ai-permissions-layer';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createApprovalRequest,
  consumeApprovalIfExists,
  resolveApproval,
  parseApprovalFromMessage,
} from './approval-store.js';

interface PluginConfig {
  rulesPath?: string;
  defaultWhenNoMatch?: DefaultWhenNoMatch;
  pathProtection?: {
    enabled?: boolean;
    dangerousTools?: string[];
  };
}

function resolvePath(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

function extractCommand(args: Record<string, unknown>): string | null {
  for (const key of ['command', 'cmd', 'script', 'code', 'args']) {
    const val = args[key];
    if (typeof val === 'string' && val.length > 0) return val;
    if (Array.isArray(val)) return (val as unknown[]).join(' ');
  }
  return null;
}

const DEFAULT_RULES_YAML = resolvePath('~/.openclaw/rules.yaml');

const STARTER_RULES = `# AI Permissions - edit and run: openclaw ai-permissions compile
- block gmail.delete and gmail.batchDelete - never auto-delete emails
- require approval before exec, bash, or process - ask before running commands
- require approval before write, edit, apply_patch - ask before file changes
- allow read, search, list - safe read-only operations
`;

function loadRules(rulesPath: string): CompiledRule[] {
  const resolved = resolvePath(rulesPath);
  if (!existsSync(resolved)) {
    return [];
  }
  try {
    const raw = readFileSync(resolved, 'utf-8');
    const parsed = JSON.parse(raw) as { rules?: CompiledRule[] };
    return parsed.rules ?? [];
  } catch {
    return [];
  }
}

export default function aiPermissionsPlugin(api: {
  on: (hook: string, handler: (...args: unknown[]) => unknown) => void;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
  pluginConfig?: PluginConfig;
}): void {
  const logger = api.logger;
  const config: Required<PluginConfig> = {
    rulesPath: '~/.openclaw/ai-permissions-rules.json',
    defaultWhenNoMatch: 'require_approval',
    pathProtection: { enabled: true },
    ...api.pluginConfig,
  };

  const pathConfig: PathProtectionConfig | null =
    config.pathProtection?.enabled !== false
      ? {
          dangerousTools:
            config.pathProtection?.dangerousTools ?? OPENCLAW_DANGEROUS_TOOLS,
          protectedPatterns: DEFAULT_PROTECTED_PATTERNS,
        }
      : null;

  const INTERNAL_TOOL_PATTERNS = [
    /^pairing$/i,
    /^device[-_]?pair/i,
    /^pair\b/i,
    /internal/i,
    /^openclaw\./i,
  ];

  const hookHandler = async (...args: unknown[]) => {
    const event = args[0] as { toolName: string; params?: Record<string, unknown> };
    const toolName = event.toolName;
    const params = (event.params ?? {}) as Record<string, unknown>;

    if (INTERNAL_TOOL_PATTERNS.some((p) => p.test(toolName))) {
      return undefined;
    }

    const toolCall = { toolName, args: params };
    const intent = { text: '' };

    if (pathConfig && isProtectedPathViolation(toolCall, pathConfig)) {
      logger.warn(`[ai-permissions-openclaw] BLOCKED: Protected path - ${toolName}`);
      return {
        block: true,
        blockReason: 'Protected path: rules cannot be modified by agent',
      };
    }

    const rules = loadRules(config.rulesPath);
    const result = match(toolCall, intent, rules, {
      defaultWhenNoMatch: config.defaultWhenNoMatch,
    });

    if (result.decision === 'BLOCK') {
      logger.warn(`[ai-permissions-openclaw] BLOCKED: ${result.reason ?? 'Rule matched'}`);
      return {
        block: true,
        blockReason: result.reason ?? 'Blocked by permissions rule',
      };
    }

    if (result.decision === 'REQUIRES_APPROVAL') {
      if (consumeApprovalIfExists(toolName, params)) {
        logger.info(`[ai-permissions-openclaw] ALLOWED: User approved (one-use consumed)`);
        return undefined;
      }
      const cmd = extractCommand(params);
      const cmdLine = cmd ? `\nCommand: ${cmd}` : '';
      const uuid = createApprovalRequest(toolName, params, result.reason ?? 'No matching rule');
      logger.warn(`[ai-permissions-openclaw] REQUIRES_APPROVAL: ${result.reason ?? 'No matching rule'} (uuid=${uuid})`);
      return {
        block: true,
        blockReason:
          `[Approval required] ${result.reason ?? 'No matching rule'}${cmdLine}\n\n` +
          `Request ID: ${uuid}\n\n` +
          `Ask the user: Reply APPROVE ${uuid} to allow this action, or DENY ${uuid} to block it. ` +
          `This is a one-use approval; after APPROVE, retry the same action.`,
      };
    }

    return undefined;
  };

  const messageReceivedHandler = (...args: unknown[]) => {
    const event = args[0] as { content?: string };
    const parsed = parseApprovalFromMessage(event?.content ?? '');
    if (!parsed) return;
    const ok = resolveApproval(parsed.uuid, parsed.decision);
    if (ok) {
      logger.info(`[ai-permissions-openclaw] User ${parsed.decision}d request ${parsed.uuid}`);
    }
  };

  const apiAny = api as {
    on?: (h: string, fn: (...a: unknown[]) => unknown) => void;
    registerHook?: (h: string, fn: (...a: unknown[]) => unknown) => void;
    registerCli?: (
      fn: (opts: { program: { command: (name: string) => { command: (spec: string) => { action: (fn: (...a: unknown[]) => void) => void } } } }) => void,
      opts: { commands: string[] }
    ) => void;
  };
  if (typeof apiAny.on === 'function') {
    apiAny.on('before_tool_call', hookHandler);
    apiAny.on('message_received', messageReceivedHandler);
  } else if (typeof apiAny.registerHook === 'function') {
    apiAny.registerHook('before_tool_call', hookHandler);
    apiAny.registerHook('message_received', messageReceivedHandler);
  } else {
    logger.warn('[ai-permissions-openclaw] No hook API found (api.on or api.registerHook)');
  }

  if (typeof apiAny.registerCli === 'function') {
    const compileHandler = async (input?: string, output?: string) => {
      const inputPath = input ? resolvePath(input) : DEFAULT_RULES_YAML;
      const outputPath = output ? resolvePath(output) : resolvePath(config.rulesPath);
      if (!existsSync(inputPath)) {
        if (!input) {
          writeFileSync(DEFAULT_RULES_YAML, STARTER_RULES);
          console.log(`Created ${DEFAULT_RULES_YAML} with starter rules.`);
        } else {
          console.error(`Input file not found: ${inputPath}`);
          process.exit(1);
        }
      }
      const llm = createOpenClawAdapter(process.env.OPENAI_API_KEY);
      if (!llm) {
        console.error('OpenClaw config not found or model unresolved. Run openclaw onboard first.');
        process.exit(1);
      }
      const content = readFileSync(inputPath, 'utf-8');
      const rules = content
        .split('\n')
        .filter((l) => l.trim().startsWith('-'))
        .map((l) => l.replace(/^-\s*["']?|["']?$/g, '').trim());
      const { rules: compiled } = await compile(rules, llm);
      writeFileSync(outputPath, JSON.stringify({ rules: compiled }, null, 2));
      console.log(`Compiled ${compiled.length} rules to ${outputPath}`);
    };
    apiAny.registerCli(
      (opts: { program: { command: (n: string) => unknown } }) => {
        const ap = opts.program.command('ai-permissions') as { command: (s: string) => { action: (fn: (a?: string, b?: string) => void) => void } };
        ap.command('compile [input] [output]').action((a?: string, b?: string) => {
          void compileHandler(a, b);
        });
      },
      { commands: ['ai-permissions'] }
    );
  }

  logger.info('[ai-permissions-openclaw] Plugin loaded - tool call interception active');
}
