import { Controller, Get, Query, Res, UseGuards, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '../config/config.service';
import { AdministratorGuard } from '../auth/guard/isAdmin.guard';
import { JwtGuard } from '../auth/guard/jwt.guard';
import * as crypto from 'crypto';

@Controller('oauth/microsoft')
@UseGuards(JwtGuard, AdministratorGuard)
export class MicrosoftOAuthController {
  private readonly authStateStore = new Map<string, { timestamp: number; provider: string }>();

  constructor(private configService: ConfigService) {}

  @Get('authorize')
  async initiateAuth(@Query('provider') provider: string = 'onedrive', @Res() res: Response) {
    try {
      const clientId = await this.configService.get(`${provider}.clientId`);
      const tenantId = await this.configService.get(`${provider}.tenantId`) || 'common';
      const appUrl = await this.configService.get('general.appUrl') || 'http://localhost:3000';

      if (!clientId) {
        throw new BadRequestException(`${provider} client ID not configured`);
      }

      // Generate random state for CSRF protection
      const state = crypto.randomBytes(32).toString('hex');
      const timestamp = Date.now();

      // Store state with expiry (10 minutes)
      this.authStateStore.set(state, { timestamp, provider });
      
      // Clean up expired states
      this.cleanExpiredStates();

      const scope = this.getScopeForProvider(provider);
      const redirectUri = `${appUrl}/api/oauth/microsoft/callback`;

      const authUrl = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_mode', 'query');
      authUrl.searchParams.set('scope', scope);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('prompt', 'consent'); // Force consent to get refresh token

      return res.redirect(authUrl.toString());
    } catch (error) {
      throw new BadRequestException(`Failed to initiate OAuth: ${error.message}`);
    }
  }

  @Get('callback')
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    try {
      // Handle OAuth errors
      if (error) {
        const frontendUrl = await this.configService.get('general.appUrl') || 'http://localhost:3000';
        return res.redirect(`${frontendUrl}/admin/storage?oauth_error=${encodeURIComponent(errorDescription || error)}`);
      }

      // Validate state parameter
      if (!state || !this.authStateStore.has(state)) {
        const frontendUrl = await this.configService.get('general.appUrl') || 'http://localhost:3000';
        return res.redirect(`${frontendUrl}/admin/storage?oauth_error=${encodeURIComponent('Invalid or expired state parameter')}`);
      }

      const stateData = this.authStateStore.get(state);
      this.authStateStore.delete(state); // Clean up used state

      // Check state expiry (10 minutes)
      if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
        const frontendUrl = await this.configService.get('general.appUrl') || 'http://localhost:3000';
        return res.redirect(`${frontendUrl}/admin/storage?oauth_error=${encodeURIComponent('OAuth state expired')}`);
      }

      if (!code) {
        const frontendUrl = await this.configService.get('general.appUrl') || 'http://localhost:3000';
        return res.redirect(`${frontendUrl}/admin/storage?oauth_error=${encodeURIComponent('No authorization code received')}`);
      }

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(code, stateData.provider);
      
      // Save refresh token to configuration
      await this.saveRefreshToken(stateData.provider, (tokens as any).refresh_token);

      // Test the connection
      await this.testConnection(stateData.provider, (tokens as any).access_token);

      const frontendUrl = await this.configService.get('general.appUrl') || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/admin/storage?oauth_success=${stateData.provider}`);
    } catch (error) {
      const frontendUrl = await this.configService.get('general.appUrl') || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/admin/storage?oauth_error=${encodeURIComponent(error.message)}`);
    }
  }

  private async exchangeCodeForTokens(code: string, provider: string) {
    const clientId = await this.configService.get(`${provider}.clientId`);
    const clientSecret = await this.configService.get(`${provider}.clientSecret`);
    const tenantId = await this.configService.get(`${provider}.tenantId`) || 'common';
    const appUrl = await this.configService.get('general.appUrl') || 'http://localhost:3000';
    const redirectUri = `${appUrl}/api/oauth/microsoft/callback`;

    if (!clientId || !clientSecret) {
      throw new Error(`Config variable not found - clientId: ${clientId ? 'present' : 'missing'}, clientSecret: ${clientSecret ? 'present' : 'missing'}`);
    }

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: this.getScopeForProvider(provider),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    return await response.json();
  }

  private async saveRefreshToken(provider: string, refreshToken: string) {
    try {
      // Update the refresh token in configuration
      await this.configService.updateMany([
        {
          key: `${provider}.refreshToken`,
          value: refreshToken,
        },
        {
          key: `${provider}.accessToken`,
          value: '', // Clear any cached access token
        },
      ]);
    } catch (error) {
      throw error;
    }
  }

  private async testConnection(provider: string, accessToken: string) {
    try {
      // Test the connection by making a simple API call
      if (provider === 'onedrive') {
        const response = await fetch('https://graph.microsoft.com/v1.0/me/drive', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });

        if (!response.ok) {
          throw new Error(`OneDrive connection test failed: ${response.statusText}`);
        }

        const driveInfo = await response.json();
        
        // Save drive ID for future use
        if ((driveInfo as any).id) {
          try {
            await this.configService.updateMany([
              {
                key: 'onedrive.driveId',
                value: (driveInfo as any).id,
              },
            ]);
          } catch (error) {
            throw error;
          }
        }
      }
    } catch (error) {
      console.warn(`Connection test failed for ${provider}:`, error.message);
      // Don't throw error - save the token anyway, connection might work later
    }
  }

  private getScopeForProvider(provider: string): string {
    switch (provider) {
      case 'onedrive':
        return 'https://graph.microsoft.com/Files.ReadWrite.All offline_access';
      case 'googledrive':
        return 'https://www.googleapis.com/auth/drive offline_access';
      default:
        return 'offline_access';
    }
  }

  private cleanExpiredStates() {
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;

    for (const [state, data] of this.authStateStore.entries()) {
      if (now - data.timestamp > tenMinutes) {
        this.authStateStore.delete(state);
      }
    }
  }
}