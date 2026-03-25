import { describe, it, expect, beforeEach } from "vitest";
import { TaskRepository } from "../src/repositories/TaskRepository.js";

describe("TaskRepository", () => {
  let repo: TaskRepository;

  beforeEach(() => {
    repo = new TaskRepository();
  });

  describe("create", () => {
    it("creates a task with the given title", () => {
      const task = repo.create({ title: "Buy milk" });
      expect(task.title).toBe("Buy milk");
      expect(task.completed).toBe(false);
      expect(task.id).toBeDefined();
      expect(task.createdAt).toBeInstanceOf(Date);
    });

    it("assigns unique IDs to each task", () => {
      const t1 = repo.create({ title: "Task 1" });
      const t2 = repo.create({ title: "Task 2" });
      expect(t1.id).not.toBe(t2.id);
    });
  });

  describe("findById", () => {
    it("returns the task when found", () => {
      const created = repo.create({ title: "Find me" });
      const found = repo.findById(created.id);
      expect(found).toBeDefined();
      expect(found?.title).toBe("Find me");
    });

    it("returns undefined when not found", () => {
      expect(repo.findById("nonexistent")).toBeUndefined();
    });
  });

  describe("findAll", () => {
    it("returns empty array when no tasks", () => {
      expect(repo.findAll()).toEqual([]);
    });

    it("returns all tasks", () => {
      repo.create({ title: "Task 1" });
      repo.create({ title: "Task 2" });
      expect(repo.findAll()).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("updates title", () => {
      const task = repo.create({ title: "Original" });
      const updated = repo.update(task.id, { title: "Updated" });
      expect(updated?.title).toBe("Updated");
    });

    it("updates completed status", () => {
      const task = repo.create({ title: "Do this" });
      const updated = repo.update(task.id, { completed: true });
      expect(updated?.completed).toBe(true);
    });

    it("returns undefined for nonexistent task", () => {
      expect(repo.update("nonexistent", { title: "X" })).toBeUndefined();
    });

    it("updates updatedAt timestamp", async () => {
      const task = repo.create({ title: "Time check" });
      await new Promise((r) => setTimeout(r, 10));
      const updated = repo.update(task.id, { title: "New title" });
      expect(updated!.updatedAt.getTime()).toBeGreaterThan(
        task.updatedAt.getTime()
      );
    });
  });

  describe("delete", () => {
    it("deletes an existing task and returns true", () => {
      const task = repo.create({ title: "Delete me" });
      expect(repo.delete(task.id)).toBe(true);
      expect(repo.findById(task.id)).toBeUndefined();
    });

    it("returns false for nonexistent task", () => {
      expect(repo.delete("nonexistent")).toBe(false);
    });

    it("deletes the correct task when multiple exist", () => {
      const t1 = repo.create({ title: "Keep" });
      const t2 = repo.create({ title: "Delete" });
      const t3 = repo.create({ title: "Also keep" });
      repo.delete(t2.id);
      expect(repo.findById(t1.id)).toBeDefined();
      expect(repo.findById(t2.id)).toBeUndefined();
      expect(repo.findById(t3.id)).toBeDefined();
    });
  });
});
