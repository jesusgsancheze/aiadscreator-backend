import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as Handlebars from 'handlebars';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      throw new Error('Missing required env var: RESEND_API_KEY');
    }
    this.resend = new Resend(apiKey);
    this.from =
      this.configService.get<string>('MAIL_FROM') ||
      'AI Ads Creator <onboarding@resend.dev>';
  }

  private async send(to: string | string[], subject: string, html: string): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    });
    if (error) {
      throw new Error(`Resend error: ${error.message ?? JSON.stringify(error)}`);
    }
  }

  async sendVerificationEmail(
    email: string,
    firstName: string,
    token: string,
  ): Promise<void> {
    const emailUrl =
      this.configService.get<string>('EMAIL_URL') ||
      this.configService.get<string>('FRONTEND_URL') ||
      'http://localhost:4000';
    const verificationLink = `${emailUrl}/verify-email?token=${token}`;

    const templateSource = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .button { display: inline-block; background: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>AI Ads Creator</h1>
          </div>
          <div class="content">
            <h2>Welcome, {{firstName}}!</h2>
            <p>Thank you for registering with AI Ads Creator. Please verify your email address by clicking the button below:</p>
            <div style="text-align: center;">
              <a href="{{verificationLink}}" class="button">Verify Email</a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; font-size: 14px; color: #4F46E5;">{{verificationLink}}</p>
            <p>This link will expire in 24 hours.</p>
          </div>
          <div class="footer">
            <p>If you did not create an account, please ignore this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const template = Handlebars.compile(templateSource);
    const html = template({ firstName, verificationLink });

    try {
      await this.send(email, 'Verify your email - AI Ads Creator', html);
      this.logger.log(`Verification email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}`, error as Error);
      throw error;
    }
  }

  async sendPaymentNotification(
    adminEmails: string[],
    userEmail: string,
    userName: string,
    amount: number,
    tokens: number,
    paymentMethod: string,
  ): Promise<void> {
    const templateSource = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #F59E0B; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .detail { margin: 10px 0; padding: 8px 12px; background: #fff; border-radius: 4px; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>New Payment Request</h1>
          </div>
          <div class="content">
            <h2>A user has submitted a payment</h2>
            <div class="detail"><strong>User:</strong> {{userName}} ({{userEmail}})</div>
            <div class="detail"><strong>Amount:</strong> \${{amount}}</div>
            <div class="detail"><strong>Tokens:</strong> {{tokens}}</div>
            <div class="detail"><strong>Payment Method:</strong> {{paymentMethod}}</div>
            <p>Please log in to the admin panel to review this transaction.</p>
          </div>
          <div class="footer">
            <p>AI Ads Creator - Admin Notification</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const template = Handlebars.compile(templateSource);
    const html = template({ userName, userEmail, amount, tokens, paymentMethod });

    try {
      await this.send(adminEmails, `New payment request from ${userName}`, html);
      this.logger.log(`Payment notification sent to ${adminEmails.join(', ')}`);
    } catch (error) {
      this.logger.error('Failed to send payment notification email', error as Error);
      throw error;
    }
  }

  async sendPaymentResult(
    userEmail: string,
    userName: string,
    status: string,
    tokens: number,
    adminNote?: string,
  ): Promise<void> {
    const isApproved = status === 'approved';
    const statusColor = isApproved ? '#10B981' : '#EF4444';
    const statusText = isApproved ? 'Approved' : 'Rejected';

    const templateSource = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: {{statusColor}}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .status-badge { display: inline-block; padding: 6px 16px; border-radius: 20px; background: {{statusColor}}; color: white; font-weight: bold; }
          .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Payment {{statusText}}</h1>
          </div>
          <div class="content">
            <h2>Hello, {{userName}}!</h2>
            <p>Your payment request has been <span class="status-badge">{{statusText}}</span></p>
            {{#if isApproved}}
            <p><strong>{{tokens}} tokens</strong> have been added to your account.</p>
            {{else}}
            <p>Unfortunately, your payment request for <strong>{{tokens}} tokens</strong> was not approved.</p>
            {{/if}}
            {{#if adminNote}}
            <p><strong>Note from admin:</strong> {{adminNote}}</p>
            {{/if}}
          </div>
          <div class="footer">
            <p>AI Ads Creator</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const template = Handlebars.compile(templateSource);
    const html = template({
      userName,
      statusColor,
      statusText,
      tokens,
      isApproved,
      adminNote,
    });

    try {
      await this.send(userEmail, `Payment ${statusText} - AI Ads Creator`, html);
      this.logger.log(`Payment result email sent to ${userEmail}`);
    } catch (error) {
      this.logger.error(`Failed to send payment result email to ${userEmail}`, error as Error);
      throw error;
    }
  }
}
