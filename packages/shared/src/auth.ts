import { z } from 'zod';

export const zLogin = z.object({
  username: z.string().trim().min(1, 'Username is required').max(64),
  password: z.string().min(1, 'Password is required').max(256),
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

export interface MeResponse {
  id: string;
  username: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: MeResponse;
}
