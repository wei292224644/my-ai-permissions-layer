import type {
  ToolCall,
  Intent,
  CompiledRule,
  CheckResult,
  Decision,
  DefaultWhenNoMatch,
} from './types.js';

const ACTION_TO_DECISION: Record<CompiledRule['action'], Decision> = {
  block: 'BLOCK',
  require_approval: 'REQUIRES_APPROVAL',
  allow: 'ALLOW',
};

export interface MatchOptions {
  defaultWhenNoMatch?: DefaultWhenNoMatch;
}

function matchArgs(rule: CompiledRule, toolCall: ToolCall): boolean {
  if (!rule.argsPattern) return true;
  const argsStr = Object.values(toolCall.args)
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .join(' ');
  return new RegExp(rule.argsPattern).test(argsStr);
}

export function match(
  toolCall: ToolCall,
  intent: Intent,
  rules: CompiledRule[],
  options: MatchOptions = {}
): CheckResult {
  const { defaultWhenNoMatch = 'require_approval' } = options;
  let matched: CompiledRule | null = null;
  let matchedAction: CompiledRule['action'] | null = null;

  for (const rule of rules) {
    const toolMatch =
      (rule.tool && rule.tool === toolCall.toolName) ||
      (rule.toolPattern &&
        new RegExp(rule.toolPattern).test(toolCall.toolName));
    const argsMatch = matchArgs(rule, toolCall);
    const intentMatch =
      !rule.intentPattern ||
      new RegExp(rule.intentPattern, 'i').test(intent.text);

    if (toolMatch && argsMatch && intentMatch) {
      if (!matched || rule.action === 'block') {
        matched = rule;
        matchedAction = rule.action;
        if (rule.action === 'block') break;
      }
    }
  }

  if (!matched) {
    const decision =
      defaultWhenNoMatch === 'allow'
        ? 'ALLOW'
        : defaultWhenNoMatch === 'block'
          ? 'BLOCK'
          : 'REQUIRES_APPROVAL';
    return {
      decision,
      reason: 'No matching rule',
    };
  }

  return {
    decision: ACTION_TO_DECISION[matchedAction!],
    reason: matched.reason,
  };
}
