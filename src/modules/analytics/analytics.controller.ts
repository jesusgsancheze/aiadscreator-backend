import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('insights')
  getInsights(
    @CurrentUser('userId') userId: string,
    @Query('platform') platform?: string,
  ) {
    return this.analyticsService.getPerformanceInsights(userId, platform);
  }

  @Get('dashboard')
  getDashboard(@CurrentUser('userId') userId: string) {
    return this.analyticsService.getDashboardStats(userId);
  }

  @Get('timeline')
  getTimeline(@CurrentUser('userId') userId: string) {
    return this.analyticsService.getPerformanceTimeline(userId);
  }
}
