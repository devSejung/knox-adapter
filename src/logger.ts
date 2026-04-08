import type { AdapterConfig } from "./config.js";

const levelOrder = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

export type LogLevel = keyof typeof levelOrder;

export class Logger {
  private readonly level: LogLevel;

  constructor(config: AdapterConfig) {
    this.level = config.LOG_LEVEL;
  }

  debug(message: string, fields?: Record<string, unknown>) {
    this.log("debug", message, fields);
  }

  info(message: string, fields?: Record<string, unknown>) {
    this.log("info", message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>) {
    this.log("warn", message, fields);
  }

  error(message: string, fields?: Record<string, unknown>) {
    this.log("error", message, fields);
  }

  private log(level: LogLevel, message: string, fields?: Record<string, unknown>) {
    if (levelOrder[level] < levelOrder[this.level]) {
      return;
    }
    const record = {
      ts: new Date().toISOString(),
      service: "platformclaw-knox-adapter",
      level,
      message,
      ...(fields ?? {}),
    };
    const line = JSON.stringify(record);
    if (level === "error") {
      console.error(line);
      return;
    }
    console.log(line);
  }
}
