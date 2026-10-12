import argon2 from 'argon2';
import { type PrismaClient } from '@prisma/client';
import {
  DEFAULT_ROLE_PERMISSIONS,
  DOCUMENT_SERIES,
  OWN_LOCATIONS,
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLE_CODES,
  ROLE_NAMES,
  SETTINGS_SCHEMA,
  SETTING_KEYS,
  VIRTUAL_LOCATIONS,
  permissionModule,
} from '@wewin/shared';

/**
 * Idempotent foundation seed: permissions, six roles, owner user, own + virtual locations,
 * document series with FY rows, business settings defaults and a PLACEHOLDER company (Q-024).
 */
export async function seedFoundation(prisma: PrismaClient, opts: { ownerPassword: string; fyCodes: string[] }) {
  for (const key of PERMISSION_KEYS) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, module: permissionModule(key), description: PERMISSIONS[key] },
      update: { module: permissionModule(key), description: PERMISSIONS[key] },
    });
  }

  const roleIds: Record<string, string> = {};
  for (const code of ROLE_CODES) {
    const role = await prisma.role.upsert({
      where: { code },
      create: { code, name: ROLE_NAMES[code], isSystem: true },
      update: {},
    });
    roleIds[code] = role.id;
    const existing = await prisma.rolePermission.count({ where: { roleId: role.id } });
    // Apply defaults only to a role that has none yet (never overwrite Owner's later edits),
    // except OWNER which always holds every permission.
    if (existing === 0 || code === 'OWNER') {
      await prisma.rolePermission.createMany({
        data: DEFAULT_ROLE_PERMISSIONS[code].map((permissionKey) => ({ roleId: role.id, permissionKey })),
        skipDuplicates: true,
      });
    }
  }

  const owner = await prisma.user.findUnique({ where: { username: 'owner' } });
  if (!owner) {
    await prisma.user.create({
      data: {
        username: 'owner',
        fullName: 'Owner',
        passwordHash: await argon2.hash(opts.ownerPassword, { type: argon2.argon2id }),
        roles: { create: [{ roleId: roleIds.OWNER! }] },
      },
    });
  }

  for (const [code, name] of Object.entries(OWN_LOCATIONS)) {
    await prisma.location.upsert({ where: { code }, create: { code, name, kind: 'OWN' }, update: {} });
  }
  for (const [code, name] of Object.entries(VIRTUAL_LOCATIONS)) {
    await prisma.location.upsert({ where: { code }, create: { code, name, kind: 'VIRTUAL' }, update: {} });
  }

  for (const [code, s] of Object.entries(DOCUMENT_SERIES)) {
    await prisma.documentSeries.upsert({
      where: { code },
      create: { code, name: s.name, prefix: s.prefix, padding: 4 },
      update: {},
    });
    for (const fyCode of opts.fyCodes) {
      await prisma.numberSeries.upsert({
        where: { seriesCode_fyCode: { seriesCode: code, fyCode } },
        create: { seriesCode: code, fyCode, lastNo: 0 },
        update: {},
      });
    }
  }

  for (const key of SETTING_KEYS) {
    const def = SETTINGS_SCHEMA[key];
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value: def.default as never, description: def.description },
      update: { description: def.description },
    });
  }

  const company = await prisma.companySettings.findUnique({ where: { id: 1 } });
  if (!company) {
    await prisma.companySettings.create({
      data: {
        id: 1,
        legalName: 'Wewin Knit Fashions (PLACEHOLDER — edit in Settings)',
        tradeName: 'Wewin Knit Fashions',
        addressLine1: 'Address to be configured',
        city: 'Tiruppur',
        state: 'Tamil Nadu',
        stateCode: '33',
        pincode: '641601',
        gstin: '33AAAAA0000A1Z5',
        isPlaceholder: true,
      },
    });
  }
}
