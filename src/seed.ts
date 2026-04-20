import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { UsersService } from './modules/users/users.service';
import * as bcrypt from 'bcrypt';
import { Role } from './common/constants';

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const usersService = app.get(UsersService);

  const email = process.env.ADMIN_EMAIL || 'admin@aiadscreator.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';
  const firstName = process.env.ADMIN_FIRST_NAME || 'Admin';
  const lastName = process.env.ADMIN_LAST_NAME || 'User';

  const existing = await usersService.findByEmail(email);
  if (existing) {
    console.log(`Admin account already exists: ${email}`);
    if (existing.role !== Role.SUPERADMIN) {
      existing.role = Role.SUPERADMIN;
      await existing.save();
      console.log(`Updated role to superadmin.`);
    }
    await app.close();
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  await usersService.create({
    email,
    firstName,
    lastName,
    password: hashedPassword,
    role: Role.SUPERADMIN,
    isEmailVerified: true,
  });

  console.log(`\nAdmin account created successfully!`);
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log(`\nChange the password after first login.\n`);

  await app.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
