import type { ApplicationState, ApplicationField } from "../schemas/application";

/**
 * Persistent storage for application processing state.
 * Implementations can use SQLite, Convex, or any backend.
 */
export interface ApplicationStore {
  /** Save or update application state */
  save(state: ApplicationState): Promise<void>;

  /** Get application by ID */
  get(id: string): Promise<ApplicationState | null>;

  /** List applications with optional filters */
  list(filters?: ApplicationListFilters): Promise<ApplicationState[]>;

  /** Delete application */
  delete(id: string): Promise<void>;
}

export interface ApplicationListFilters {
  status?: ApplicationState["status"];
  /** Fuzzy match on title */
  title?: string;
}

/**
 * Context provider for auto-fill backfill.
 * Pulls previously answered values from stored applications and documents
 * to pre-fill new applications via vector search.
 */
export interface BackfillProvider {
  /**
   * Search for previously answered field values that match the given fields.
   * Uses vector similarity over field labels + section context to find
   * answers from prior applications, extracted policies, and business context.
   *
   * @returns Array of matches with fieldId, value, source description, and relevance
   */
  searchPriorAnswers(
    fields: Pick<ApplicationField, "id" | "label" | "section" | "fieldType">[],
    options?: { limit?: number },
  ): Promise<PriorAnswer[]>;
}

export interface PriorAnswer {
  fieldId: string;
  value: string;
  source: string;
  relevance: number;
}
