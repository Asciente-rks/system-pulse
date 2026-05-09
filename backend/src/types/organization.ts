export interface Organization {
  id: string;
  name: string;
  /** User id of the org's primary admin (the registrant). */
  ownerId: string;
  /** ISO timestamp of creation. */
  createDate: string;
  /** Optional slug derived from name; not required for lookups. */
  slug?: string;
  /**
   * Marks the special demo organization that hosts the platform owner's
   * personal projects. Visible to demo sessions; protected from
   * destructive actions.
   */
  isDemo?: boolean;
}

export const DEMO_ORG_ID = "demo";
