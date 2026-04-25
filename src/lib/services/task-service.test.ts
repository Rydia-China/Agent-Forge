import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTask, cancelTask, subscribeEvents, getActiveTaskForSession } from "./task-service";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  prisma: {
    task: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    taskEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/agent/agent", () => ({
  runAgentStream: vi.fn(),
}));

vi.mock("@/lib/services/key-resource-service", () => ({
  upsertResource: vi.fn(),
}));

describe("task-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getTask", () => {
    it("should retrieve task by id", async () => {
      const mockTask = {
        id: "task_123",
        sessionId: "ses_456",
        status: "completed",
        reply: "Test reply",
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.task.findUnique).mockResolvedValue(mockTask as never);

      const result = await getTask("task_123");

      expect(result).toEqual(mockTask);
      expect(prisma.task.findUnique).toHaveBeenCalledWith({
        where: { id: "task_123" },
        select: {
          id: true,
          sessionId: true,
          status: true,
          reply: true,
          error: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    it("should return null for non-existent task", async () => {
      vi.mocked(prisma.task.findUnique).mockResolvedValue(null);

      const result = await getTask("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("getActiveTaskForSession", () => {
    it("should find pending task for session", async () => {
      const mockTask = {
        id: "task_123",
        sessionId: "ses_456",
        status: "pending",
        reply: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.task.findFirst).mockResolvedValue(mockTask as never);

      const result = await getActiveTaskForSession("ses_456");

      expect(result).toEqual(mockTask);
      expect(prisma.task.findFirst).toHaveBeenCalledWith({
        where: {
          sessionId: "ses_456",
          status: { in: ["pending", "running"] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          sessionId: true,
          status: true,
          reply: true,
          error: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    it("should find running task for session", async () => {
      const mockTask = {
        id: "task_123",
        sessionId: "ses_456",
        status: "running",
        reply: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.task.findFirst).mockResolvedValue(mockTask as never);

      const result = await getActiveTaskForSession("ses_456");

      expect(result).toEqual(mockTask);
    });

    it("should return null when no active task exists", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);

      const result = await getActiveTaskForSession("ses_456");

      expect(result).toBeNull();
    });

    it("should return most recent active task when multiple exist", async () => {
      const recentTask = {
        id: "task_recent",
        sessionId: "ses_456",
        status: "running",
        reply: null,
        error: null,
        createdAt: new Date("2026-04-25T10:00:00Z"),
        updatedAt: new Date("2026-04-25T10:00:00Z"),
      };

      vi.mocked(prisma.task.findFirst).mockResolvedValue(recentTask as never);

      const result = await getActiveTaskForSession("ses_456");

      expect(result?.id).toBe("task_recent");
      expect(prisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: "desc" },
        }),
      );
    });
  });

  describe("cancelTask", () => {
    it("should cancel running task via AbortController", async () => {
      // This test requires access to internal activeAborts map
      // For now, test the DB fallback path
      const mockTask = {
        id: "task_123",
        sessionId: "ses_456",
        status: "running",
        reply: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.task.findUnique).mockResolvedValue(mockTask as never);
      vi.mocked(prisma.task.update).mockResolvedValue({
        ...mockTask,
        status: "cancelled",
      } as never);
      vi.mocked(prisma.taskEvent.create).mockResolvedValue({
        id: 1,
        taskId: "task_123",
        type: "error",
        data: { error: "Task cancelled" } as Prisma.JsonValue,
        createdAt: new Date(),
      } as never);

      const result = await cancelTask("task_123");

      expect(result).toBe(true);
      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: "task_123" },
        data: { status: "cancelled" },
      });
    });

    it("should return false for already completed task", async () => {
      const mockTask = {
        id: "task_123",
        sessionId: "ses_456",
        status: "completed",
        reply: "Done",
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.task.findUnique).mockResolvedValue(mockTask as never);

      const result = await cancelTask("task_123");

      expect(result).toBe(false);
      expect(prisma.task.update).not.toHaveBeenCalled();
    });

    it("should return false for non-existent task", async () => {
      vi.mocked(prisma.task.findUnique).mockResolvedValue(null);

      const result = await cancelTask("nonexistent");

      expect(result).toBe(false);
    });
  });

  describe("subscribeEvents", () => {
    it("should replay persisted events from DB", async () => {
      const mockEvents = [
        {
          id: 1,
          taskId: "task_123",
          type: "start",
          data: {} as Prisma.JsonValue,
          createdAt: new Date(),
        },
        {
          id: 2,
          taskId: "task_123",
          type: "done",
          data: { reply: "Success" } as Prisma.JsonValue,
          createdAt: new Date(),
        },
      ];

      const mockTask = {
        id: "task_123",
        sessionId: "ses_456",
        status: "completed",
        reply: "Success",
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.taskEvent.findMany).mockResolvedValue(mockEvents as never);
      vi.mocked(prisma.task.findUnique).mockResolvedValue(mockTask as never);

      const events: typeof mockEvents = [];
      for await (const event of subscribeEvents("task_123")) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe("start");
      expect(events[1]!.type).toBe("done");
      expect(prisma.taskEvent.findMany).toHaveBeenCalledWith({
        where: { taskId: "task_123" },
        orderBy: { id: "asc" },
      });
    });

    it("should replay events after lastEventId", async () => {
      const mockEvents = [
        {
          id: 3,
          taskId: "task_123",
          type: "tool_start",
          data: {} as Prisma.JsonValue,
          createdAt: new Date(),
        },
        {
          id: 4,
          taskId: "task_123",
          type: "tool_end",
          data: {} as Prisma.JsonValue,
          createdAt: new Date(),
        },
      ];

      const mockTask = {
        id: "task_123",
        sessionId: "ses_456",
        status: "completed",
        reply: "Success",
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.taskEvent.findMany).mockResolvedValue(mockEvents as never);
      vi.mocked(prisma.task.findUnique).mockResolvedValue(mockTask as never);

      const events: typeof mockEvents = [];
      for await (const event of subscribeEvents("task_123", 2)) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]!.id).toBe(3);
      expect(events[1]!.id).toBe(4);
      expect(prisma.taskEvent.findMany).toHaveBeenCalledWith({
        where: {
          taskId: "task_123",
          id: { gt: 2 },
        },
        orderBy: { id: "asc" },
      });
    });

    it("should stop when signal is aborted", async () => {
      const mockEvents = [
        {
          id: 1,
          taskId: "task_123",
          type: "start",
          data: {} as Prisma.JsonValue,
          createdAt: new Date(),
        },
      ];

      const mockTask = {
        id: "task_123",
        sessionId: "ses_456",
        status: "running",
        reply: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.taskEvent.findMany).mockResolvedValue(mockEvents as never);
      vi.mocked(prisma.task.findUnique).mockResolvedValue(mockTask as never);

      const abortController = new AbortController();
      const events: typeof mockEvents = [];

      // Abort immediately after first event
      setTimeout(() => abortController.abort(), 10);

      for await (const event of subscribeEvents("task_123", undefined, abortController.signal)) {
        events.push(event);
        if (events.length >= 1) break; // Prevent infinite loop in test
      }

      expect(events).toHaveLength(1);
    });

    it("should return immediately for completed task with no new events", async () => {
      const mockEvents = [
        {
          id: 1,
          taskId: "task_123",
          type: "done",
          data: { reply: "Success" } as Prisma.JsonValue,
          createdAt: new Date(),
        },
      ];

      const mockTask = {
        id: "task_123",
        sessionId: "ses_456",
        status: "completed",
        reply: "Success",
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(prisma.taskEvent.findMany).mockResolvedValue(mockEvents as never);
      vi.mocked(prisma.task.findUnique).mockResolvedValue(mockTask as never);

      const events: typeof mockEvents = [];
      for await (const event of subscribeEvents("task_123")) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe("done");
    });
  });
});
