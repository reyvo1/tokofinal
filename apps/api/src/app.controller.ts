import { createHash } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './auth/public.decorator';

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function runtimeDatabaseIdentity() {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const explicitProfile = process.env.DATABASE_PROFILE?.trim().toLowerCase();
  const profile = explicitProfile || (/^postgres(?:ql)?:/i.test(databaseUrl) ? 'postgresql' : /^file:/i.test(databaseUrl) ? 'sqlite' : null);
  if (!databaseUrl) return { profile, hostHash: null, databaseHash: null };

  if (profile === 'postgresql' || /^postgres(?:ql)?:/i.test(databaseUrl)) {
    try {
      const parsed = new URL(databaseUrl);
      const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
      return {
        profile: 'postgresql',
        hostHash: parsed.hostname ? shortHash(parsed.hostname.toLowerCase()) : null,
        databaseHash: database ? shortHash(database) : null,
      };
    } catch {
      return { profile: 'postgresql', hostHash: null, databaseHash: null };
    }
  }

  return { profile: profile || 'sqlite', hostHash: null, databaseHash: shortHash(databaseUrl) };
}

@ApiTags('system')
@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'toko360-api',
      timestamp: new Date().toISOString(),
      release: {
        version: process.env.APP_VERSION ?? '0.5.3',
        sourceFingerprint: process.env.T360_SOURCE_FINGERPRINT ?? null,
        buildId: process.env.T360_BUILD_ID ?? null,
        buildArtifactId: process.env.T360_BUILD_ARTIFACT_ID ?? null,
        databaseTarget: runtimeDatabaseIdentity(),
      },
    };
  }
}
