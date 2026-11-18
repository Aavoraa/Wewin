export interface CurrentUser {
  id: string;
  username: string;
  fullName: string;
  roles: string[];
  permissions: Set<string>;
  sessionId: string;
  /** Unit the session works in (Q-085). */
  unitId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: CurrentUser;
      id?: string | number | object;
    }
  }
}
