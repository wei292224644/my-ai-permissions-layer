import { describe, it, expect } from 'vitest';
import { match } from '../src/matcher';
import type { ToolCall, Intent, CompiledRule } from '../src/types';

describe('match', () => {
  it('returns BLOCK when rule matches tool exactly', () => {
    const rules: CompiledRule[] = [
      { action: 'block', tool: 'gmail.delete', reason: 'no delete' },
    ];
    const result = match(
      { toolName: 'gmail.delete', args: {} },
      { text: 'delete emails' },
      rules
    );
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toContain('no delete');
  });

  it('returns REQUIRES_APPROVAL when rule matches', () => {
    const rules: CompiledRule[] = [
      { action: 'require_approval', tool: 'gmail.delete', reason: 'ask first' },
    ];
    const result = match(
      { toolName: 'gmail.delete', args: {} },
      { text: 'delete' },
      rules
    );
    expect(result.decision).toBe('REQUIRES_APPROVAL');
  });

  it('returns require_approval when no rules match (default)', () => {
    const rules: CompiledRule[] = [
      { action: 'block', tool: 'gmail.delete', reason: 'no delete' },
    ];
    const result = match(
      { toolName: 'gmail.send', args: {} },
      { text: 'send email' },
      rules
    );
    expect(result.decision).toBe('REQUIRES_APPROVAL');
  });

  it('returns ALLOW when no rules match and defaultWhenNoMatch is allow', () => {
    const rules: CompiledRule[] = [
      { action: 'block', tool: 'gmail.delete', reason: 'no delete' },
    ];
    const result = match(
      { toolName: 'gmail.send', args: {} },
      { text: 'send email' },
      rules,
      { defaultWhenNoMatch: 'allow' }
    );
    expect(result.decision).toBe('ALLOW');
  });

  it('returns BLOCK when no rules match and defaultWhenNoMatch is block', () => {
    const rules: CompiledRule[] = [
      { action: 'allow', tool: 'gmail.list', reason: 'ok' },
    ];
    const result = match(
      { toolName: 'gmail.send', args: {} },
      { text: 'send email' },
      rules,
      { defaultWhenNoMatch: 'block' }
    );
    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toBe('No matching rule');
  });

  it('matches toolPattern regex', () => {
    const rules: CompiledRule[] = [
      {
        action: 'block',
        toolPattern: 'gmail\\.(delete|batchDelete)',
        reason: 'no delete',
      },
    ];
    const result = match(
      { toolName: 'gmail.batchDelete', args: {} },
      { text: 'delete all' },
      rules
    );
    expect(result.decision).toBe('BLOCK');
  });

  it('BLOCK overrides REQUIRES_APPROVAL when both match', () => {
    const rules: CompiledRule[] = [
      { action: 'require_approval', tool: 'gmail.delete', reason: 'ask' },
      { action: 'block', tool: 'gmail.delete', reason: 'never' },
    ];
    const result = match(
      { toolName: 'gmail.delete', args: {} },
      { text: 'delete' },
      rules
    );
    expect(result.decision).toBe('BLOCK');
  });

  it('matches argsPattern for fine-grained control', () => {
    const rules: CompiledRule[] = [
      { action: 'allow', tool: 'exec', argsPattern: '^(ls|cat|grep)', reason: 'read-only' },
      { action: 'require_approval', tool: 'exec', argsPattern: '^(rm|mv)', reason: 'write ops' },
      { action: 'block', tool: 'exec', argsPattern: 'rm -rf', reason: 'dangerous' },
    ];
    // ls → allow
    const allowResult = match(
      { toolName: 'exec', args: { command: 'ls -la' } },
      { text: 'list files' },
      rules
    );
    expect(allowResult.decision).toBe('ALLOW');

    // rm (not -rf) → require_approval
    const approvalResult = match(
      { toolName: 'exec', args: { command: 'rm file.txt' } },
      { text: 'remove file' },
      rules
    );
    expect(approvalResult.decision).toBe('REQUIRES_APPROVAL');

    // rm -rf → block (higher priority)
    const blockResult = match(
      { toolName: 'exec', args: { command: 'rm -rf /tmp/garbage' } },
      { text: 'clean up' },
      rules
    );
    expect(blockResult.decision).toBe('BLOCK');
  });

  it('rules without argsPattern match any args', () => {
    const rules: CompiledRule[] = [
      { action: 'block', tool: 'exec', reason: 'no exec' },
    ];
    const result = match(
      { toolName: 'exec', args: { command: 'ls' } },
      { text: 'list' },
      rules
    );
    expect(result.decision).toBe('BLOCK');
  });
});
