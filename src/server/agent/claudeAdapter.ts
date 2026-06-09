import { spawn } from "node:child_process";
import { parseFmProgram, type ValidFmProgram } from "./fmSchema";
import { parseChatIntent, parseSongInfo, type ChatIntent, type SongInfoResponse } from "./intentSchema";
import { parseAgentPlan, type ValidAgentPlan } from "./schema";

interface ClaudeResultWrapper {
  result?: unknown;
  content?: unknown;
  message?: unknown;
}

function maybeParseJsonString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = stripMarkdownCodeFence(value.trim());
  if (!trimmed) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const embeddedJson = extractFirstJsonObject(trimmed);
    if (embeddedJson) {
      return JSON.parse(embeddedJson);
    }
    throw error;
  }
}

function stripMarkdownCodeFence(value: string): string {
  const fenceMatch = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : value;
}

function extractFirstJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function unwrapClaudeOutput(value: unknown): unknown {
  const parsed = maybeParseJsonString(value);
  if (!parsed || typeof parsed !== "object") {
    return parsed;
  }

  const wrapper = parsed as ClaudeResultWrapper;
  if ("say" in parsed && "play" in parsed && "reason" in parsed) {
    return parsed;
  }

  if ("title" in parsed && "segments" in parsed && "reason" in parsed) {
    return parsed;
  }

  if (wrapper.result !== undefined) {
    return unwrapClaudeOutput(wrapper.result);
  }

  if (wrapper.content !== undefined) {
    return unwrapClaudeOutput(wrapper.content);
  }

  if (wrapper.message !== undefined) {
    return unwrapClaudeOutput(wrapper.message);
  }

  return parsed;
}

export function parseClaudePlanOutput(output: string): ValidAgentPlan {
  try {
    return parseAgentPlan(unwrapClaudeOutput(output));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parse error";
    throw new Error(`Claude output was not valid radio JSON: ${message}`);
  }
}

export function parseClaudeIntentOutput(output: string): ChatIntent {
  try {
    return parseChatIntent(unwrapClaudeOutput(output));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parse error";
    throw new Error(`Claude output was not valid intent JSON: ${message}`);
  }
}

export function parseClaudeSongInfoOutput(output: string): SongInfoResponse {
  try {
    return parseSongInfo(unwrapClaudeOutput(output));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parse error";
    throw new Error(`Claude output was not valid song info JSON: ${message}`);
  }
}

export function parseClaudeFmProgramOutput(output: string): ValidFmProgram {
  try {
    return parseFmProgram(unwrapClaudeOutput(output));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parse error";
    throw new Error(`Claude output was not valid FM JSON: ${message}`);
  }
}

export async function runClaudePlan(
  command: string,
  args: string[],
  prompt: string
): Promise<ValidAgentPlan> {
  return parseClaudePlanOutput(await runClaudeCommand(command, args, prompt));
}

export async function runClaudeIntent(
  command: string,
  args: string[],
  prompt: string
): Promise<ChatIntent> {
  return parseClaudeIntentOutput(await runClaudeCommand(command, args, prompt));
}

export async function runClaudeSongInfo(
  command: string,
  args: string[],
  prompt: string
): Promise<SongInfoResponse> {
  return parseClaudeSongInfoOutput(await runClaudeCommand(command, args, prompt));
}

export async function runClaudeFmProgram(
  command: string,
  args: string[],
  prompt: string
): Promise<ValidFmProgram> {
  return parseClaudeFmProgramOutput(await runClaudeCommand(command, args, prompt));
}

async function runClaudeCommand(command: string, args: string[], prompt: string): Promise<string> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `Claude command exited with ${code}`));
      }
    });
    child.stdin.end(prompt);
  });

  return output;
}
