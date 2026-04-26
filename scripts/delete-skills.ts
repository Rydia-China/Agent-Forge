#!/usr/bin/env tsx
import { prisma } from '../src/lib/db';

async function main() {
  const result = await prisma.skill.deleteMany();
  console.log(`Deleted ${result.count} skills`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
