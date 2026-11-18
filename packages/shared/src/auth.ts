import { z } from 'zod';

export const zLogin = z.object({
  username: z.string().trim().min(1, 'Username is required').max(64),
  password: z.string().min(1, 'Password is required').max(256),
  /** Unit to work in (Q-085); left out = the user's default unit. */
  unitId: z.string().uuid().optional(),
});
export type LoginInput = z.infer<typeof zLogin>;

export const zPasswordPolicy = z
  .string()
  .min(10, 'At least 10 characters')
  .max(256)
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/\d/, 'Must contain a digit');

export const zChangePassword = z.object({
  currentPassword: z.string().min(1),
  newPassword: zPasswordPolicy,
});

/** Switch the logged-in session to another unit the user may use (Q-085). */
export const zSwitchUnit = z.object({ unitId: z.string().uuid() });

/** An exporter's unit as shown at login and in the header (Q-085). */
export interface UnitInfo {
  id: string;
  code: string;
  name: string;
  docPrefix: string;
  exporter: { id: string; code: string; name: string };
}

export interface MeResponse {
  id: string;
  username: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
  /** Unit this session works in; every document, number, stock and report belongs to it. */
  unit: UnitInfo;
  /** Units the user may switch to. */
  units: UnitInfo[];
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: MeResponse;
}
