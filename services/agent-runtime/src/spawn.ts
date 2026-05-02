/**
 * Agent CLI spawner — wraps child_process.spawn for safe, stream-friendly invocation.
 *
 * 设计要点：
 * - 永不用 shell:true，所有参数走 args 数组，杜绝 command injection
 * - 强制超时，子进程跑超时直接 SIGKILL，防止 hub 端 hang
 * - stdout / stderr 分别透出，调用方拿 AsyncIterable 走 SSE
 * - prompt 走 stdin 而非命令行参数，避免 ps -ef 泄漏 + 长度上限问题
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface SpawnConfig {
  bin: string;
  args: string[];
  prompt: string;
  cwd?: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

export interface AgentEvent {
  type: "stdout" | "stderr" | "exit" | "error";
  data: string;
  exitCode?: number | null;
}

export async function* runAgent(config: SpawnConfig): AsyncGenerator<AgentEvent> {
  const child: ChildProcessWithoutNullStreams = spawn(config.bin, config.args, {
    cwd: config.cwd,
    env: { ...process.env, ...config.env },
    shell: false,
  });

  const queue: AgentEvent[] = [];
  let resolveNext: (() => void) | null = null;
  let done = false;

  const pushEvent = (event: AgentEvent) => {
    queue.push(event);
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk: string) => pushEvent({ type: "stdout", data: chunk }));
  child.stderr.on("data", (chunk: string) => pushEvent({ type: "stderr", data: chunk }));
  child.on("error", (err) => {
    pushEvent({ type: "error", data: err.message });
    done = true;
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  });
  child.on("close", (code) => {
    pushEvent({ type: "exit", data: "", exitCode: code });
    done = true;
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  });

  const timeoutHandle = setTimeout(() => {
    if (!child.killed) {
      child.kill("SIGKILL");
      pushEvent({ type: "error", data: `timeout after ${config.timeoutMs}ms` });
    }
  }, config.timeoutMs);

  try {
    child.stdin.write(config.prompt);
    child.stdin.end();

    while (!done || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
        continue;
      }
      const event = queue.shift();
      if (event) yield event;
    }
  } finally {
    clearTimeout(timeoutHandle);
    if (!child.killed) child.kill("SIGTERM");
  }
}
