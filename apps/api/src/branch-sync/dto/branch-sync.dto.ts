import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// POST-1A DTOs — edge topology and sync foundation.
//
// Every payload that crosses a node boundary carries its own tenant and branch scope, the origin
// node, and a schema version. A peer that cannot parse the version must fail closed rather than
// guess: forwarding an unknown version would apply a business mutation under a schema the
// receiver does not understand, which is exactly how duplicate stock or journal postings happen.

export class RegisterSyncNodeDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) code!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiProperty({ enum: ['CENTRAL', 'BRANCH'] }) @IsIn(['CENTRAL', 'BRANCH']) @IsString() role!: 'CENTRAL' | 'BRANCH';
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) protocolVersion?: number;
  @ApiPropertyOptional() @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class RegisterPeerDto {
  @ApiProperty() @IsUUID() peerNodeId!: string;
  @ApiPropertyOptional({ enum: ['PUSH', 'PULL', 'BIDIRECTIONAL'], default: 'BIDIRECTIONAL' })
  @IsOptional() @IsIn(['PUSH', 'PULL', 'BIDIRECTIONAL']) @IsString() direction?: 'PUSH' | 'PULL' | 'BIDIRECTIONAL';
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(200) sharedSecretRef!: string;
}

// One business event as it crosses the wire. aggregateType/aggregateId identify WHAT changed;
// eventId is the idempotency key and must be stable across retries of the same logical event.
export class SyncEventDto {
  @ApiProperty({ description: 'Idempotency key. The same eventId replayed must never post twice.' })
  @IsString() @MinLength(8) @MaxLength(120) eventId!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60) aggregateType!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) aggregateId!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) eventType!: string;
  @ApiProperty({ default: 1 }) @IsOptional() @IsInt() @Min(1) schemaVersion!: number;
  @ApiProperty() @IsObject() payload!: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsDateString() occurredAt?: string;
}

export class PublishSyncEventsDto {
  @ApiProperty({ type: [SyncEventDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true }) @Type(() => SyncEventDto) events!: SyncEventDto[];
}

export class PullSyncEventsDto {
  @ApiProperty() @IsUUID() peerNodeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ default: 200 }) @IsOptional() @IsInt() @Min(1) @Max(500) limit?: number;
}

export class EnqueueSyncEventDto extends SyncEventDto {}

// Observability payload. lagCount is computed by the server from the outbox, never taken from the
// caller: a client-supplied lag number would be a self-report, not evidence.
export class SyncHealthQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() nodeId?: string;
}

export class RevokePeerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400) reason?: string;
}

// A branch bootstrapping from central authoritative state. Fail-closed by construction: the caller
// may only name a cursor, never raw rows.
export class BootstrapBranchDto {
  @ApiProperty() @IsUUID() peerNodeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) fromCursor?: string;
}

export class NodeHeartbeatDto {
  @ApiPropertyOptional() @IsOptional() @IsObject() health?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) pendingCount?: number;
}

export class SetPeerActiveDto {
  @ApiProperty() @IsBoolean() isActive!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400) reason?: string;
}

export class ReceiveSyncEventsDto {
  @ApiProperty() @IsUUID() peerNodeId!: string;
  @ApiProperty({ type: [EnqueueSyncEventDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true }) @Type(() => EnqueueSyncEventDto) events!: EnqueueSyncEventDto[];
}

export class RecordSyncFailureDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) eventId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) error!: string;
}

export class AdvanceAggregateVersionDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
}

export class RecordSyncConflictDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) remoteVersion?: number;
}

export class ResolveSyncConflictDto {
  @ApiProperty({ enum: ['KEEP_LOCAL', 'KEEP_REMOTE', 'MANUAL_REVIEW'] })
  @IsIn(['KEEP_LOCAL', 'KEEP_REMOTE', 'MANUAL_REVIEW']) strategy!: 'KEEP_LOCAL' | 'KEEP_REMOTE' | 'MANUAL_REVIEW';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
