export interface RecordRow {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Ids of the linked records, keyed by the alias the UI uses in its forms. */
  relations?: Record<string, string | null>;
  [column: string]: unknown;
}

export interface ReferenceOption {
  id: string;
  label: string;
  hint?: string;
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    displayName: string;
    fullName: string | null;
  };
  employee: RecordRow;
  profileCompletion: number;
}
