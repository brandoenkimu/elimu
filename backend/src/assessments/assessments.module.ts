import { Module } from '@nestjs/common';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';
import { GradingService } from './grading.service';

@Module({ controllers: [AssessmentsController], providers: [AssessmentsService, GradingService] })
export class AssessmentsModule {}
