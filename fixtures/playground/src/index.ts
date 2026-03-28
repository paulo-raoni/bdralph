// Public API surface for the playground task module
// Barrel file — re-exports the core building blocks for consumers
// Entry point used by bdralph playground fixtures
export { TaskRepository } from "./repositories/TaskRepository.js";
export { TaskService } from "./services/TaskService.js";
export type { Task, CreateTaskInput, UpdateTaskInput } from "./types/Task.js";
