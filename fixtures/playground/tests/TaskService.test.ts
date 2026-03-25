import { describe, it, expect, beforeEach } from "vitest";
import { TaskService } from "../src/services/TaskService.js";
import { TaskRepository } from "../src/repositories/TaskRepository.js";

describe("TaskService", () => {
  let service: TaskService;

  beforeEach(() => {
    service = new TaskService(new TaskRepository());
  });

  describe("createTask", () => {
    it("creates and returns a task", () => {
      const task = service.createTask({ title: "Write tests" });
      expect(task.title).toBe("Write tests");
      expect(task.completed).toBe(false);
    });
  });

  describe("getTask", () => {
    it("returns existing task", () => {
      const created = service.createTask({ title: "Get me" });
      const found = service.getTask(created.id);
      expect(found.id).toBe(created.id);
    });

    it("throws for nonexistent task", () => {
      expect(() => service.getTask("nonexistent")).toThrow("Task not found");
    });
  });

  describe("listTasks", () => {
    it("returns empty list initially", () => {
      expect(service.listTasks()).toEqual([]);
    });

    it("returns all tasks", () => {
      service.createTask({ title: "A" });
      service.createTask({ title: "B" });
      expect(service.listTasks()).toHaveLength(2);
    });
  });

  describe("updateTask", () => {
    it("updates task title", () => {
      const task = service.createTask({ title: "Old" });
      const updated = service.updateTask(task.id, { title: "New" });
      expect(updated.title).toBe("New");
    });

    it("marks task as completed", () => {
      const task = service.createTask({ title: "Do this" });
      const updated = service.updateTask(task.id, { completed: true });
      expect(updated.completed).toBe(true);
    });

    it("throws for nonexistent task", () => {
      expect(() => service.updateTask("nonexistent", { title: "X" })).toThrow(
        "Task not found"
      );
    });
  });

  describe("deleteTask", () => {
    it("deletes existing task", () => {
      const task = service.createTask({ title: "Delete me" });
      service.deleteTask(task.id);
      expect(() => service.getTask(task.id)).toThrow("Task not found");
    });

    it("throws for nonexistent task", () => {
      expect(() => service.deleteTask("nonexistent")).toThrow("Task not found");
    });
  });
});
