import { Task, CreateTaskInput, UpdateTaskInput } from "../types/Task.js";
import { TaskRepository } from "../repositories/TaskRepository.js";

export class TaskService {
  constructor(private readonly repo: TaskRepository) {}

  createTask(input: CreateTaskInput): Task {
    return this.repo.create(input);
  }

  getTask(id: string): Task {
    const task = this.repo.findById(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }

  listTasks(): Task[] {
    return this.repo.findAll();
  }

  updateTask(id: string, input: UpdateTaskInput): Task {
    const task = this.repo.update(id, input);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }

  deleteTask(id: string): void {
    const deleted = this.repo.delete(id);
    if (!deleted) throw new Error(`Task not found: ${id}`);
  }
}
