import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SwitchBranchContextDto {
  @ApiProperty({ description: 'Branch aktif tujuan di company yang sama.' })
  @IsUUID()
  branchId!: string;
}
