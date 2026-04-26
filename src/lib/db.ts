import { PrismaClient } from "@/generated/prisma";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  skillsInitialized?: boolean;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

globalForPrisma.prisma = prisma;

// Initialize builtin skills on first connection
if (!globalForPrisma.skillsInitialized) {
  globalForPrisma.skillsInitialized = true;
  
  // Run initialization asynchronously (don't block module load)
  import("@/lib/skills/init-builtins")
    .then((mod) => mod.initializeBuiltinSkills())
    .catch((error) => {
      console.error("[DB] Failed to initialize builtin skills:", error);
    });
}
