import {
  APPROVAL_SWITCHES,
  type ApprovalSwitchSetting,
  type CompanySettingsInput,
  SETTINGS_SCHEMA,
  SETTING_KEYS,
  type SettingKey,
  type SettingsValues,
  defaultSettings,
} from '@wewin/shared';
import { type Tx, prisma, withTx } from '../db';
import { AppError, notFound, versionConflict } from '../errors/app-error';

function toDateOrNull(v: string | null | undefined): Date | null {
  return v ? new Date(`${v.slice(0, 10)}T00:00:00Z`) : null;
}

export const settingsService = {
  async getCompany() {
    const c = await prisma.companySettings.findUnique({ where: { id: 1 } });
    if (!c) throw notFound('Company settings');
    return c;
  },

  async updateCompany(input: CompanySettingsInput) {
    return withTx(
      async (tx) => {
        const { version, lutValidFrom, lutValidTo, email, ...rest } = input;
        const res = await tx.companySettings.updateMany({
          where: { id: 1, version },
          data: {
            ...rest,
            email: email || null,
            lutValidFrom: toDateOrNull(lutValidFrom),
            lutValidTo: toDateOrNull(lutValidTo),
            isPlaceholder: false,
            version: { increment: 1 },
          },
        });
        if (res.count === 0) throw versionConflict();
        return tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });
      },
      { isolation: 'ReadCommitted' },
    );
  },

  /** All business settings, validated, with defaults for anything missing. */
  async getAll(tx?: Tx): Promise<SettingsValues> {
    const db = tx ?? prisma;
    const rows = await db.appSetting.findMany();
    const out = defaultSettings() as Record<string, unknown>;
    for (const r of rows) {
      if (!(r.key in SETTINGS_SCHEMA)) continue;
      const parsed = SETTINGS_SCHEMA[r.key as SettingKey].schema.safeParse(r.value);
      if (parsed.success) out[r.key] = parsed.data;
    }
    return out as SettingsValues;
  },

  async get<K extends SettingKey>(key: K, tx?: Tx): Promise<SettingsValues[K]> {
    return (await this.getAll(tx))[key];
  },

  async listWithMeta() {
    const values = await this.getAll();
    return SETTING_KEYS.map((key) => ({ key, value: values[key], description: SETTINGS_SCHEMA[key].description }));
  },

  async set(key: string, value: unknown) {
    if (!(key in SETTINGS_SCHEMA)) throw new AppError('NOT_FOUND', `Unknown setting ${key}`, 404);
    const parsed = SETTINGS_SCHEMA[key as SettingKey].schema.safeParse(value);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', `Invalid value for ${key}`, 400, parsed.error.flatten());
    const saved = await withTx(
      (tx) =>
        tx.appSetting.upsert({
          where: { key },
          create: { key, value: parsed.data as never, description: SETTINGS_SCHEMA[key as SettingKey].description },
          update: { value: parsed.data as never },
        }),
      { isolation: 'ReadCommitted' },
    );
    // An approval switch changes who may approve (Q-074): drop cached permissions so it applies at once.
    if (APPROVAL_SWITCHES.some((s) => s.setting === key)) onApprovalSwitchChange?.();
    return saved;
  },

  listSeries() {
    return prisma.documentSeries.findMany({ orderBy: { code: 'asc' } });
  },

  async listNumberSeries() {
    return prisma.numberSeries.findMany({ orderBy: [{ fyCode: 'desc' }, { seriesCode: 'asc' }] });
  },

  async updateSeries(code: string, data: { prefix: string; padding: number; isActive: boolean }) {
    return withTx(
      async (tx) => {
        const s = await tx.documentSeries.findUnique({ where: { code } });
        if (!s) throw notFound('Series');
        return tx.documentSeries.update({ where: { code }, data });
      },
      { isolation: 'ReadCommitted' },
    );
  },
};

let onApprovalSwitchChange: (() => void) | undefined;
/** The auth layer registers its permission-cache reset here (avoids an import cycle). */
export function onApprovalSwitchChanged(fn: () => void): void {
  onApprovalSwitchChange = fn;
}

/** Whether each switchable approval is required (Q-074). */
export async function approvalSwitches(tx?: Tx): Promise<Record<ApprovalSwitchSetting, boolean>> {
  const all = await settingsService.getAll(tx);
  return Object.fromEntries(APPROVAL_SWITCHES.map((s) => [s.setting, all[s.setting]])) as Record<ApprovalSwitchSetting, boolean>;
}
