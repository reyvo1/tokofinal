import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class SecretProtectorService {
  private readonly key?: Buffer;
  private readonly keyId: string;

  constructor(private readonly config: ConfigService) {
    this.keyId = this.config.get<string>('SECRET_KEY_ID') ?? 'env-v1';
    this.key = this.parseKey(this.config.get<string>('SECRET_MASTER_KEY') ?? this.config.get<string>('ENCRYPTION_KEY'));
    const environment = (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development').trim().toLowerCase();
    const protectedEnvironment = environment === 'production' || environment === 'staging';
    if (protectedEnvironment && !this.key) {
      throw new Error('SECRET_MASTER_KEY/ENCRYPTION_KEY staging/production wajib dikonfigurasi sebagai key 32-byte (hex/base64).');
    }
  }

  private parseKey(raw?: string): Buffer | undefined {
    if (!raw) return undefined;
    const trimmed = raw.trim();
    try {
      if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
      const value = Buffer.from(trimmed, 'base64');
      return value.length === 32 ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private requireKey(): Buffer {
    if (!this.key) throw new BadRequestException('Secret encryption key belum dikonfigurasi pada server.');
    return this.key;
  }

  encryptText(plainText: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['enc', 'v1', this.keyId, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
  }

  decryptText(payload: string): string {
    const key = this.requireKey();
    const [prefix, version, , ivEncoded, tagEncoded, cipherEncoded] = payload.split(':');
    if (prefix !== 'enc' || version !== 'v1' || !ivEncoded || !tagEncoded || !cipherEncoded) {
      throw new BadRequestException('Format secret terenkripsi tidak valid.');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivEncoded, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(cipherEncoded, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new BadRequestException('Secret tidak dapat didekripsi dengan key aktif.');
    }
  }

  encryptJson(value: unknown): { __toko360Encrypted: string } {
    return { __toko360Encrypted: this.encryptText(JSON.stringify(value)) };
  }

  decryptJson(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const encrypted = (value as Record<string, unknown>).__toko360Encrypted;
    if (typeof encrypted !== 'string') return value;
    return JSON.parse(this.decryptText(encrypted));
  }
}
