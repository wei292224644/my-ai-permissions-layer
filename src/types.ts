export type Decision = 'ALLOW' | 'BLOCK' | 'REQUIRES_APPROVAL';

export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

export interface Intent {
  text: string;
}

export type RuleAction = 'block' | 'require_approval' | 'allow';

export interface CompiledRule {
  action: RuleAction;
  tool?: string;
  toolPattern?: string;
  intentPattern?: string;
  /** Regex to match against tool call arguments (joined as space-separated string) */
  argsPattern?: string;
  reason: string;
}

export interface CheckResult {
  decision: Decision;
  reason?: string;
}

/** When no rule matches: 'allow', 'require_approval', or 'block'. Default: 'require_approval'. */
export type DefaultWhenNoMatch = 'allow' | 'require_approval' | 'block';

export interface PathProtectionConfig {
  /** Tool names that can write files (e.g. "filesystem.write", "edit_file") */
  dangerousTools: string[];
  /** Glob patterns for paths the agent must not write to */
  protectedPatterns: string[];
}
