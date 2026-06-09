import "dotenv/config";

export function loadConfig() {
  return {
    port: Number(process.env.PORT ?? 3000),
    databasePath: process.env.DATABASE_PATH ?? "data/radio-agent.sqlite",
    claudeCommand: process.env.CLAUDE_COMMAND ?? "claude",
    claudeArgs: (process.env.CLAUDE_ARGS ?? "-p,--output-format,json").split(","),
    neteaseApiBase: process.env.NETEASE_API_BASE ?? "http://localhost:3001",
    neteaseCookie: process.env.NETEASE_COOKIE ?? "",
    neteaseSessionPath: process.env.NETEASE_SESSION_PATH ?? "data/netease-session.json",
    fishApiKey: process.env.FISH_API_KEY ?? "",
    fishVoiceId: process.env.FISH_VOICE_ID ?? "",
    fishProxy: process.env.FISH_PROXY ?? ""
  };
}
