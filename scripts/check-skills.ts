#!/usr/bin/env tsx
import { prisma } from '../src/lib/db';

async function main() {
  const skills = await prisma.skill.findMany();
  console.log(JSON.stringify(skills, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
