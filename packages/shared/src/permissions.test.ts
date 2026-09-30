import { describe, expect, it } from 'vitest';
import { ConflictError, ForbiddenError } from './errors';
import {
  CAPABILITIES,
  PERMISSIONS,
  ROLES,
  authorize,
  authorizeMemberChange,
  can,
  memberChangeRefusal,
  type Capability,
  type MemberChange,
  type Role,
} from './permissions';

// A literal transcription of the ARCHITECTURE.md section 10 table, kept independent of
// PERMISSIONS so that a change to either one fails this test. Columns: owner, admin,
// approver, reviewer, viewer. "recommend only" is the findings.recommend row.
const Y = true;
const N = false;
const MATRIX: Record<Capability, [boolean, boolean, boolean, boolean, boolean]> = {
  'invoices.view': [Y, Y, Y, Y, Y], //       View invoices, findings, reports
  'invoices.upload': [Y, Y, Y, Y, N], //     Upload invoices, retry extraction
  'invoices.edit': [Y, Y, Y, Y, N], //       Edit extracted fields, comment
  'findings.recommend': [Y, Y, Y, Y, N], //  Confirm/dismiss findings (reviewer: recommend only)
  'findings.resolve': [Y, Y, Y, N, N], //    Confirm/dismiss findings
  'invoices.decide': [Y, Y, Y, N, N], //     Final decision (approve/reject/hold)
  'masterdata.import': [Y, Y, N, N, N], //   Import master data
  'settings.manage': [Y, Y, N, N, N], //     Edit rules, org settings, retention
  'members.manage': [Y, Y, N, N, N], //      Manage members
  'billing.manage': [Y, N, N, N, N], //      Billing
  'org.delete': [Y, N, N, N, N], //          Delete organization
};

const COLUMNS: readonly Role[] = ['owner', 'admin', 'approver', 'reviewer', 'viewer'];

const cases = CAPABILITIES.flatMap((capability) =>
  COLUMNS.map((role, i) => ({ capability, role, allowed: MATRIX[capability][i] })),
);

describe('permission matrix', () => {
  it('covers exactly the matrix rows and roles', () => {
    expect([...CAPABILITIES].sort()).toEqual(Object.keys(MATRIX).sort());
    expect(ROLES).toEqual(COLUMNS);
    expect(cases).toHaveLength(11 * 5);
  });

  it.each(cases)('$role -> $capability = $allowed', ({ role, capability, allowed }) => {
    expect(can(role, capability)).toBe(allowed);
    if (allowed) {
      expect(() => {
        authorize({ role }, capability);
      }).not.toThrow();
    } else {
      expect(() => {
        authorize({ role }, capability);
      }).toThrow(ForbiddenError);
    }
  });

  it('never lists a role twice for a capability', () => {
    for (const roles of Object.values(PERMISSIONS)) {
      expect(new Set(roles).size).toBe(roles.length);
    }
  });

  it('is monotonic: a higher role holds every capability of a lower one', () => {
    for (let hi = 0; hi < COLUMNS.length; hi++) {
      for (let lo = hi + 1; lo < COLUMNS.length; lo++) {
        for (const capability of CAPABILITIES) {
          const higher = COLUMNS[hi];
          const lower = COLUMNS[lo];
          if (higher === undefined || lower === undefined) throw new Error('index');
          if (can(lower, capability)) expect(can(higher, capability)).toBe(true);
        }
      }
    }
  });
});

describe('member changes', () => {
  const nonManagers: Role[] = ['approver', 'reviewer', 'viewer'];

  it.each(nonManagers)('%s cannot invite, change roles, or remove anyone', (actor) => {
    const changes: MemberChange[] = [
      { kind: 'invite', role: 'viewer' },
      { kind: 'change_role', from: 'viewer', to: 'reviewer' },
      { kind: 'remove', role: 'viewer' },
    ];
    for (const change of changes) {
      expect(memberChangeRefusal(actor, change, 2)?.code).toBe('forbidden');
    }
  });

  it.each(['owner', 'admin'] as const)('%s may invite, re-role and remove non-owners', (actor) => {
    for (const role of ['admin', 'approver', 'reviewer', 'viewer'] as const) {
      expect(memberChangeRefusal(actor, { kind: 'invite', role }, 1)).toBeNull();
      expect(memberChangeRefusal(actor, { kind: 'remove', role }, 1)).toBeNull();
      expect(
        memberChangeRefusal(actor, { kind: 'change_role', from: role, to: 'viewer' }, 1),
      ).toBeNull();
    }
  });

  it('only an owner can grant, change, or remove the owner role', () => {
    const ownerChanges: MemberChange[] = [
      { kind: 'invite', role: 'owner' },
      { kind: 'change_role', from: 'admin', to: 'owner' },
      { kind: 'change_role', from: 'owner', to: 'admin' },
      { kind: 'remove', role: 'owner' },
    ];
    for (const change of ownerChanges) {
      expect(memberChangeRefusal('admin', change, 3)?.code).toBe('forbidden');
      expect(memberChangeRefusal('owner', change, 3)).toBeNull();
    }
  });

  it('keeps at least one owner', () => {
    expect(
      memberChangeRefusal('owner', { kind: 'change_role', from: 'owner', to: 'admin' }, 1)?.code,
    ).toBe('conflict');
    expect(memberChangeRefusal('owner', { kind: 'remove', role: 'owner' }, 1)?.code).toBe(
      'conflict',
    );
    expect(
      memberChangeRefusal('owner', { kind: 'change_role', from: 'owner', to: 'owner' }, 1),
    ).toBeNull();
    expect(memberChangeRefusal('owner', { kind: 'remove', role: 'owner' }, 2)).toBeNull();
  });

  it('authorizeMemberChange throws the matching error type', () => {
    expect(() => {
      authorizeMemberChange('viewer', { kind: 'invite', role: 'viewer' }, 1);
    }).toThrow(ForbiddenError);
    expect(() => {
      authorizeMemberChange('owner', { kind: 'remove', role: 'owner' }, 1);
    }).toThrow(ConflictError);
    expect(() => {
      authorizeMemberChange('owner', { kind: 'remove', role: 'owner' }, 2);
    }).not.toThrow();
  });
});
