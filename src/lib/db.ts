import { PrismaClient } from "@/generated/prisma";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  skillsInitialized?: boolean;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

globalForPrisma.prisma = prisma;

// Initialize preset skills on first connection
if (!globalForPrisma.skillsInitialized) {
  globalForPrisma.skillsInitialized = true;
  
  // Run initialization asynchronously (don't block module load)
  import("@/lib/skills/init-presets")
    .then((mod) => mod.initializePresetSkills())
    .catch((error) => {
      console.error("[DB] Failed to initialize preset skills:", error);
    });
}
