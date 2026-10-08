import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class SaveCashierTargetsDto {
  @ApiProperty({ type: Object, additionalProperties: { type: 'number', minimum: 0 } })
  @IsObject() targets!: Record<string, number>;
}
