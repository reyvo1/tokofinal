export interface ApiEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CursorPageInfo {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CursorPaginated<T> {
  items: T[];
  pageInfo: CursorPageInfo;
}

export interface RuntimeManifest {
  version: string;
  company?: Record<string, unknown>;
  branch?: Record<string, unknown>;
  features: Record<string, { enabled: boolean; config?: unknown }>;
  modules: Array<Record<string, unknown>>;
  navigation: Array<Record<string, unknown>>;
  settings: Record<string, unknown>;
}

export interface DomainEvent<T = unknown> {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  payload: T;
}
