import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';

jest.mock('bcrypt');
jest.mock('uuid', () => ({ v4: () => 'fixed-token-uuid' }));

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<Partial<UsersService>>;
  let mailService: jest.Mocked<Partial<MailService>>;
  let jwtService: jest.Mocked<Partial<JwtService>>;

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findByPasswordResetToken: jest.fn(),
      create: jest.fn(),
      findByVerificationToken: jest.fn(),
      findById: jest.fn(),
      updateLanguage: jest.fn(),
    };
    mailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('signed-jwt'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: MailService, useValue: mailService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get(AuthService);

    // Silence Nest's logger output during tests (the error path test logs an
    // expected message). Spying lets individual tests assert on it if needed.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // login
  // ---------------------------------------------------------------------------
  describe('login', () => {
    const buildUser = (overrides: Partial<any> = {}) => ({
      _id: { toString: () => 'user-id' },
      email: 'user@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      password: 'hashed-password',
      role: 'user',
      language: 'en',
      tokenBalance: 100,
      isEmailVerified: true,
      ...overrides,
    });

    it('returns an access token + sanitized user on success', async () => {
      usersService.findByEmail!.mockResolvedValue(buildUser() as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        email: 'user@example.com',
        password: 'correct-horse',
      });

      expect(result.accessToken).toBe('signed-jwt');
      expect(result.user).toMatchObject({
        id: 'user-id',
        email: 'user@example.com',
        role: 'user',
        language: 'en',
        tokenBalance: 100,
      });
      // Password must never leak into the response.
      expect(result.user).not.toHaveProperty('password');
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-id',
        email: 'user@example.com',
        role: 'user',
      });
    });

    it('throws Unauthorized when email is unknown', async () => {
      usersService.findByEmail!.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nope@example.com', password: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws Forbidden when email is not verified', async () => {
      usersService.findByEmail!.mockResolvedValue(
        buildUser({ isEmailVerified: false }) as any,
      );

      await expect(
        service.login({ email: 'user@example.com', password: 'x' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws Unauthorized when password is wrong', async () => {
      usersService.findByEmail!.mockResolvedValue(buildUser() as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'user@example.com', password: 'bad' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  // ---------------------------------------------------------------------------
  // forgotPassword
  // ---------------------------------------------------------------------------
  describe('forgotPassword', () => {
    it('returns the generic success message when the email is unknown', async () => {
      usersService.findByEmail!.mockResolvedValue(null);

      const result = await service.forgotPassword('ghost@example.com');

      expect(result.message).toMatch(/password reset link has been sent/i);
      // Wait for the dispatch microtask to settle.
      await flushPromises();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('returns immediately and emails the user out-of-band when the account exists', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const user = {
        email: 'user@example.com',
        firstName: 'Ada',
        passwordResetToken: null,
        passwordResetExpires: null,
        save,
      };
      usersService.findByEmail!.mockResolvedValue(user as any);

      const result = await service.forgotPassword('user@example.com');

      // Returns the generic message regardless of account existence.
      expect(result.message).toMatch(/password reset link has been sent/i);
      // The dispatch hasn't necessarily completed yet — but flushing microtasks
      // should let the fire-and-forget chain finish.
      await flushPromises();

      expect(user.passwordResetToken).toBe('fixed-token-uuid');
      expect(user.passwordResetExpires).toBeInstanceOf(Date);
      expect(save).toHaveBeenCalledTimes(1);
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'user@example.com',
        'Ada',
        'fixed-token-uuid',
      );
    });

    it('does not propagate dispatch errors to the caller', async () => {
      usersService.findByEmail!.mockRejectedValue(new Error('mongo down'));

      await expect(
        service.forgotPassword('user@example.com'),
      ).resolves.toEqual({
        message: expect.stringMatching(/password reset link has been sent/i),
      });

      // Allow the swallowed error to propagate through the logger path.
      await flushPromises();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // resetPassword
  // ---------------------------------------------------------------------------
  describe('resetPassword', () => {
    it('updates the password and clears the reset token on success', async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const user = {
        password: 'old-hash',
        passwordResetToken: 'reset-token',
        passwordResetExpires: new Date(Date.now() + 30 * 60 * 1000),
        save,
      };
      usersService.findByPasswordResetToken!.mockResolvedValue(user as any);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

      const result = await service.resetPassword('reset-token', 'new-password');

      expect(bcrypt.hash).toHaveBeenCalledWith('new-password', 12);
      expect(user.password).toBe('new-hash');
      expect(user.passwordResetToken).toBeNull();
      expect(user.passwordResetExpires).toBeNull();
      expect(save).toHaveBeenCalledTimes(1);
      expect(result.message).toMatch(/password reset successfully/i);
    });

    it('throws BadRequest when the token is unknown', async () => {
      usersService.findByPasswordResetToken!.mockResolvedValue(null);

      await expect(
        service.resetPassword('bogus', 'new-password'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when the token has expired', async () => {
      const save = jest.fn();
      usersService.findByPasswordResetToken!.mockResolvedValue({
        passwordResetToken: 'reset-token',
        passwordResetExpires: new Date(Date.now() - 60 * 1000),
        save,
      } as any);

      await expect(
        service.resetPassword('reset-token', 'new-password'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(save).not.toHaveBeenCalled();
    });
  });
});
