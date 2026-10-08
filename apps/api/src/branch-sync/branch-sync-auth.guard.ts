import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BranchSyncAuthService } from './branch-sync-auth.service';

// POST-1A — peer transport guard for the three node-to-node wire routes.
//
// The rule this encodes: a request is either an operator session OR a signed peer request, never a
// blend. If an HMAC signature header is present, the peer path must succeed completely and its
// companyId replaces the session's; if it is absent, the ordinary session guards do the work.
//
// Without that rule, a request could present a valid operator session AND a valid-but-different
// peer signature, and whichever ran first would silently decide whose tenant the mutation lands in.

// The two are mutually exclusive: a caller that supplies a signature cannot also rely on a session.
const SIGNATURE_HEADERS = ['x-toko360-signature', 'x-toko360-node-code', 'x-toko360-peer-node-code'] as const;

@Injectable()
export class BranchSyncAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: BranchSyncAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      method: string; route?: { path?: string }; path: string; body: unknown; query: Record<string, unknown>;
      headers: Record<string, string | string[] | undefined>; user?: { companyId?: string | null; sub?: string };
    }>();

    const present = SIGNATURE_HEADERS.filter((h) => {
      const v = request.headers[h] ?? request.headers[h.toLowerCase()];
      const s = Array.isArray(v) ? v[0] : v;
      return typeof s === 'string' && s.trim().length > 0;
    });
    if (present.length === 0) return true; // fall through to the session guards
    if (present.length !== SIGNATURE_HEADERS.length) {
      // A partial signature set is a misconfigured client, not an operator request. Letting it fall
      // through would let someone bypass the peer path by sending one header and omitting the rest.
      throw new UnauthorizedException('Header signature peer sync tidak lengkap.');
    }

    const operation = `${request.method} ${request.route?.path ?? request.path}`;
    // A thrown error here is what rejects the request; returning false would surface as a bare 403
    // and hide the reason the operator needs to fix their peer configuration.
    try {
      const identity = await this.auth.authenticate(request.headers, operation, { body: request.body, query: request.query });
      // The signature, not the URL and not the body, decides the tenant from here on.
      request.user = { ...(request.user ?? {}), companyId: identity.companyId, sub: `sync-peer:${identity.nodeId}` };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Autentikasi peer sync gagal.');
    }
  }
}
