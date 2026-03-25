/**
 * One-use approval store for REQUIRES_APPROVAL flow.
 * UUIDs are consumed on first use; cannot be reused.
 */

import { randomUUID } from 'node:crypto';

export interface PendingApproval {
  uuid: string;
  toolName: string;
  params: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied';
  reason: string;
  createdAt: number;
}

const APPROVAL_TTL_MS = 60 * 60 * 1000; // 1 hour

function paramsKey(params: Record<string, unknown>): string {
  try {
    return JSON.stringify(params, Object.keys(params).sort());
  } catch {
    return String(params);
  }
}

const store = new Map<string, PendingApproval>();
const paramsToUuid = new Map<string, string>(); // toolName:paramsKey -> uuid for lookup

export function createApprovalRequest(
  toolName: string,
  params: Record<string, unknown>,
  reason: string
): string {
  const uuid = randomUUID();
  const key = `${toolName}:${paramsKey(params)}`;
  const approval: PendingApproval = {
    uuid,
    toolName,
    params,
    status: 'pending',
    reason,
    createdAt: Date.now(),
  };
  store.set(uuid, approval);
  paramsToUuid.set(key, uuid);
  return uuid;
}

export function resolveApproval(uuid: string, decision: 'APPROVE' | 'DENY'): boolean {
  const approval = store.get(uuid);
  if (!approval || approval.status !== 'pending') return false;
  approval.status = decision === 'APPROVE' ? 'approved' : 'denied';
  return true;
}

/**
 * Consume an approved approval for this tool call. One-use: deletes after use.
 * Returns true if an approved matching approval was found and consumed.
 */
export function consumeApprovalIfExists(
  toolName: string,
  params: Record<string, unknown>
): boolean {
  const key = `${toolName}:${paramsKey(params)}`;
  const uuid = paramsToUuid.get(key);
  if (!uuid) return false;
  const approval = store.get(uuid);
  if (!approval || approval.status !== 'approved') return false;
  // Consume: remove so it cannot be used again
  store.delete(uuid);
  paramsToUuid.delete(key);
  return true;
}

export function getApprovalStatus(uuid: string): 'pending' | 'approved' | 'denied' | 'unknown' {
  const approval = store.get(uuid);
  if (!approval) return 'unknown';
  return approval.status;
}

export function getLatestPendingApproval(): PendingApproval | null {
  let latest: PendingApproval | null = null;
  for (const approval of store.values()) {
    if (approval.status === 'pending') {
      if (!latest || approval.createdAt > latest.createdAt) {
        latest = approval;
      }
    }
  }
  return latest;
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [uuid, approval] of store.entries()) {
    if (approval.status === 'pending' && now - approval.createdAt > APPROVAL_TTL_MS) {
      store.delete(uuid);
      paramsToUuid.delete(`${approval.toolName}:${paramsKey(approval.params)}`);
    }
  }
}

const UUID_REGEX = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';

export function parseApprovalFromMessage(content: string): {
  uuid: string;
  decision: 'APPROVE' | 'DENY';
} | null {
  const trimmed = (content || '').trim().toLowerCase();

  if (trimmed === 'yes' || trimmed === 'y') {
    const latest = getLatestPendingApproval();
    if (latest) return { uuid: latest.uuid, decision: 'APPROVE' };
    return null;
  }

  if (trimmed === 'no' || trimmed === 'n') {
    const latest = getLatestPendingApproval();
    if (latest) return { uuid: latest.uuid, decision: 'DENY' };
    return null;
  }

  const approveMatch = (content || '').trim().match(new RegExp(`(?:^|\\s)(?:/approve\\s+)?approve\\s+(${UUID_REGEX})`, 'i'));
  if (approveMatch) return { uuid: approveMatch[1].toLowerCase(), decision: 'APPROVE' };
  const denyMatch = (content || '').trim().match(new RegExp(`(?:^|\\s)(?:/deny\\s+)?deny\\s+(${UUID_REGEX})`, 'i'));
  if (denyMatch) return { uuid: denyMatch[1].toLowerCase(), decision: 'DENY' };
  return null;
}

// Run cleanup periodically
setInterval(cleanupExpired, 5 * 60 * 1000); // every 5 min
