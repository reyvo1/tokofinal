import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ProductionRecipeItemDto {
  @ApiProperty() @IsString() componentProductId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) quantityPerBatch!: number;
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 100 }) @IsOptional() @IsNumber() @Min(0) @Max(100) wastePct?: number;
}

export class CreateProductionRecipeDto {
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() outputProductId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) outputQtyPerBatch!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiProperty({ type: [ProductionRecipeItemDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ProductionRecipeItemDto) items!: ProductionRecipeItemDto[];
}

export class CreateProductionOrderDto {
  @ApiProperty() @IsString() recipeId!: string;
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) batchCount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CompleteProductionOrderDto {
  @ApiPropertyOptional({ description: 'Default memakai plannedOutputQty.' }) @IsOptional() @IsInt() @Min(1) actualOutputQty?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CancelProductionOrderDto {
  @ApiProperty() @IsString() reason!: string;
}
