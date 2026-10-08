import { Module } from '@nestjs/common';
import { HrModule } from '../hr/hr.module';
import { EmployeeSelfServiceController } from './employee-self-service.controller';
import { EmployeeSelfServiceService } from './employee-self-service.service';
@Module({ imports: [HrModule], controllers: [EmployeeSelfServiceController], providers: [EmployeeSelfServiceService] })
export class EmployeeSelfServiceModule {}
