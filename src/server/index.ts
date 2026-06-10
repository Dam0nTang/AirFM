import { readFile } from "node:fs/promises";
import { runClaudeFmProgram, runClaudeIntent, runClaudePlan, runClaudeSongInfo } from "./agent/claudeAdapter";
import { createApp } from "./app";
import { loadConfig } from "./config";
import {
  buildContextPrompt,
  buildFmContinuationPrompt,
  buildFmFirstSegmentPrompt,
  buildIntentPrompt,
  buildSongInfoPrompt
} from "./context/contextBuilder";
import { loadUserProfile } from "./context/profile";
import { createNeteaseAuthService } from "./music/neteaseAuth";
import { resolveNeteaseSong } from "./music/neteaseAdapter";
import { getNeteaseCookie } from "./music/neteaseSession";
import { synthesizeFishSpeech } from "./tts/fishAdapter";

const config = loadConfig();

const app = await createApp({
  agent: {
    async classify(prompt, messages, queue, currentIndex) {
      const current = queue[currentIndex];
      const intentPrompt = buildIntentPrompt({
        userPrompt: prompt,
        conversation: messages.map((message) => ({
          role: message.role,
          text: message.text
        })),
        queue,
        current
      });
      return runClaudeIntent(config.claudeCommand, config.claudeArgs, intentPrompt);
    },
    async explain(prompt, messages, queue, intent, currentIndex) {
      const current = queue[currentIndex];
      const persona = await readFile("prompts/dj-persona.md", "utf8");
      const infoPrompt = buildSongInfoPrompt({
        persona,
        userPrompt: prompt,
        conversation: messages.map((message) => ({
          role: message.role,
          text: message.text
        })),
        queue,
        current,
        target: intent.target
      });
      return runClaudeSongInfo(config.claudeCommand, config.claudeArgs, infoPrompt);
    },
    async plan(prompt, messages, avoidTracks) {
      const [persona, profile] = await Promise.all([
        readFile("prompts/dj-persona.md", "utf8"),
        loadUserProfile()
      ]);
      const contextPrompt = buildContextPrompt({
        persona,
        profile,
        now: new Date(),
        recentPlays: [],
        userPrompt: prompt,
        conversation: messages.map((message) => ({
          role: message.role,
          text: message.text
        })),
        avoidTracks
      });
      return runClaudePlan(config.claudeCommand, config.claudeArgs, contextPrompt);
    },
    async planFm(messages, avoidTracks) {
      const [persona, profile] = await Promise.all([
        readFile("prompts/dj-persona.md", "utf8"),
        loadUserProfile()
      ]);
      const contextPrompt = buildFmFirstSegmentPrompt({
        persona,
        profile,
        now: new Date(),
        recentPlays: [],
        conversation: messages.map((message) => ({
          role: message.role,
          text: message.text
        })),
        avoidTracks
      });
      const program = await runClaudeFmProgram(config.claudeCommand, config.claudeArgs, contextPrompt);
      return {
        ...program,
        segments: program.segments.slice(0, 1)
      };
    },
    async planFmContinuation(fmProgram, queue, messages, avoidTracks) {
      const [persona, profile] = await Promise.all([
        readFile("prompts/dj-persona.md", "utf8"),
        loadUserProfile()
      ]);
      const songs = queue.filter((item) => item.kind === "song");
      const lastTrack = songs.at(-1);
      const contextPrompt = buildFmContinuationPrompt({
        persona,
        profile,
        now: new Date(),
        recentPlays: [],
        program: {
          title: fmProgram.title,
          reason: fmProgram.reason,
          lastTrack: lastTrack ? { title: lastTrack.title, artist: lastTrack.artist } : undefined,
          plannedTracks: songs.map((item) => ({
            title: item.title,
            artist: item.artist,
            query: item.query
          }))
        },
        avoidTracks: [
          ...avoidTracks,
          ...songs.map((item) => ({ title: item.title, artist: item.artist, query: item.query }))
        ],
        conversation: messages.map((message) => ({
          role: message.role,
          text: message.text
        }))
      });
      const program = await runClaudeFmProgram(config.claudeCommand, config.claudeArgs, contextPrompt);
      return {
        ...program,
        segments: program.segments.slice(0, 5)
      };
    }
  },
  music: {
    resolve: async (request) =>
      resolveNeteaseSong(config.neteaseApiBase, request, {
        cookie: await getNeteaseCookie(config.neteaseSessionPath, config.neteaseCookie)
      })
  },
  netease: createNeteaseAuthService(config.neteaseApiBase, config.neteaseSessionPath),
  tts: {
    synthesize: (text) =>
      synthesizeFishSpeech(config.fishApiKey, config.fishVoiceId, text, config.fishProxy)
  }
});

await app.listen({ port: config.port, host: "0.0.0.0" });
