type LogLevel = "debug" | "info" | "warn" | "error";

function write(level: LogLevel, message: string, ...meta: unknown[]) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] ${level.toUpperCase()}`;

  switch (level) {
    case "debug":
    case "info":
      console.log(prefix, message, ...meta);
      break;
    case "warn":
      console.warn(prefix, message, ...meta);
      break;
    case "error":
      console.error(prefix, message, ...meta);
      break;
  }
}

export const logger = {
  debug(message: string, ...meta: unknown[]) {
    if (process.env.DEBUG === "1") {
      write("debug", message, ...meta);
    }
  },
  info(message: string, ...meta: unknown[]) {
    write("info", message, ...meta);
  },
  warn(message: string, ...meta: unknown[]) {
    write("warn", message, ...meta);
  },
  error(message: string, ...meta: unknown[]) {
    write("error", message, ...meta);
  },
};
