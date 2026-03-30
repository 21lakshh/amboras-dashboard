import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import type { StoreContext } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('bootstrap')
  @UseGuards(AuthGuard)
  async bootstrap(@Req() request: Request & { user: StoreContext }) {
    return this.authService.getProvisionedUserSummary(request.user);
  }
}
