export interface AuthUser {
  sub: string;
  sid?: string;
  email: string;
  name: string;
  companyId?: string | null;
  branchId?: string | null;
  roles: string[];
  permissions: string[];
  authType?: 'JWT' | 'API_KEY';
  apiKeyId?: string;
}
