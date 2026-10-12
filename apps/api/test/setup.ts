import { afterAll } from 'vitest';
import { prisma } from '../src/core/db';

afterAll(async () => {
  await prisma.$disconnect();
});
