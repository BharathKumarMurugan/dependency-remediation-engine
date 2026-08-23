import { Mutex } from "async-mutex";
import path from "path";

class FilePathMutexManager {
  private mutexes: Map<string, Mutex> = new Map();

  /**
   * Retrieves or creates a Mutex instance keyed by normalized absolute file path
   */
  getMutex(filePath: string): Mutex {
    const normalizedPath = path.resolve(filePath).toLowerCase();
    let mutex = this.mutexes.get(normalizedPath);
    if (!mutex) {
      mutex = new Mutex();
      this.mutexes.set(normalizedPath, mutex);
    }
    return mutex;
  }

  /**
   * Executes an asynchronous file writing operation under an exclusive lock for the specified file path
   */
  async runExclusive<T>(filePath: string, task: () => Promise<T>): Promise<T> {
    const mutex = this.getMutex(filePath);
    return mutex.runExclusive(task);
  }
}

export const filePathMutex = new FilePathMutexManager();
