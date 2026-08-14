declare global {
  namespace App {
    /** The signed-in account, resolved once per request in `hooks.server.ts`. */
    interface SessionUser {
      id: string;
      name: string;
      email: string;
      image: string | null;
    }

    interface Locals {
      user: SessionUser | null;
      session: { id: string; expiresAt: string } | null;
    }

    interface PageData {
      user?: SessionUser | null;
    }
  }
}
export {};
