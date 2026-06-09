import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ChatMessage, PlaybackState, QueueItem } from "../../shared/types";
import {
  getNeteaseLoginStatus,
  importNeteaseCookie,
  logoutNetease,
  nextTrack,
  playQueueItem,
  previousTrack,
  resolveSong,
  sendPrompt,
  startFmProgram,
  stopPlaybackSession
} from "../api";
import { shouldSubmitPrompt } from "./composer";
import { isBenignPlaybackInterruption, isUnsupportedPlaybackSource } from "./playbackErrors";

export function PlayerView({ state }: { state: PlaybackState }) {
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFmStarting, setIsFmStarting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [neteaseLoggedIn, setNeteaseLoggedIn] = useState(false);
  const [neteaseMessage, setNeteaseMessage] = useState("");
  const [isNeteaseGuideOpen, setIsNeteaseGuideOpen] = useState(false);
  const [isCookieImportOpen, setIsCookieImportOpen] = useState(false);
  const [neteaseCookieInput, setNeteaseCookieInput] = useState("");
  const [activeView, setActiveView] = useState<"fm" | "chat">(state.activeView ?? "chat");
  const [isTransportOpen, setIsTransportOpen] = useState(false);
  const [isFmQueueOpen, setIsFmQueueOpen] = useState(false);
  const [transportMode, setTransportMode] = useState<"fm" | "chat">(state.playbackMode === "fm" ? "fm" : "chat");
  const [chatQueue, setChatQueue] = useState<QueueItem[]>([]);
  const [chatIndex, setChatIndex] = useState(-1);
  const [isFmPausedByChat, setIsFmPausedByChat] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceReplayRef = useRef<HTMLAudioElement | null>(null);
  const neteaseLoginRef = useRef<HTMLDivElement | null>(null);
  const lastFmProgramIdRef = useRef<string | undefined>(state.fmProgram?.id);
  const suppressNextAutoPlayRef = useRef(false);
  const fmResumeTimeRef = useRef(0);
  const pendingSeekRef = useRef<number | undefined>(undefined);
  const refreshedChatItemIdsRef = useRef(new Set<string>());
  const refreshedFmItemIdsRef = useRef(new Set<string>());
  const fmCurrent = state.queue[state.currentIndex];
  const chatCurrent = chatIndex >= 0 ? chatQueue[chatIndex] : undefined;
  const current = transportMode === "fm" ? fmCurrent : chatCurrent;
  const audioSrc = current?.url;
  const upcoming = useMemo(
    () => transportMode === "fm" ? state.queue.slice(state.currentIndex + 1) : chatQueue.slice(chatIndex + 1),
    [chatIndex, chatQueue, state.currentIndex, state.queue, transportMode]
  );
  const hasActiveFmProgram = state.playbackMode === "fm" && Boolean(state.fmProgram);
  const isComposerLocked = activeView === "fm";
  const fmSongs = useMemo(
    () =>
      state.queue.filter(
        (item) =>
          item.kind === "song" &&
          item.playbackStatus !== "unavailable" &&
          (item.fmRole === "song" || state.playbackMode === "fm")
      ),
    [state.playbackMode, state.queue]
  );
  const queuedSongs = upcoming.filter((item) => item.kind === "song").length;
  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const progressTail = transportMode === "fm"
    ? `${queuedSongs} QUEUED`
    : duration ? formatTime(duration) : audioSrc ? "LOADING" : `${upcoming.length} QUEUED`;
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const weekday = now.toLocaleDateString([], { weekday: "long" });
  const date = now
    .toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" })
    .replaceAll(" ", " · ");

  async function submit() {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || isSubmitting) {
      return;
    }

    setError("");
    setPrompt("");
    setIsSubmitting(true);
    try {
      await sendPrompt(nextPrompt);
    } catch (requestError) {
      setPrompt(nextPrompt);
      setError(requestError instanceof Error ? requestError.message : "Request failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function startFm() {
    if (state.status === "planning" || isFmStarting) {
      return;
    }

    setError("");
    setIsFmStarting(true);
    setActiveView("fm");
    setTransportMode("fm");
    setChatIndex(-1);
    setIsFmPausedByChat(false);
    setIsTransportOpen(true);
    try {
      await startFmProgram();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "FM start failed");
    } finally {
      setIsFmStarting(false);
    }
  }

  function openFmTransport() {
    const wasChatTransport = transportMode === "chat";
    if (wasChatTransport && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (isFmPausedByChat) {
      suppressNextAutoPlayRef.current = true;
      pendingSeekRef.current = fmResumeTimeRef.current;
      setIsPaused(true);
    }
    if (wasChatTransport) {
      setChatIndex(-1);
      setCurrentTime(0);
      setDuration(0);
    }
    setTransportMode("fm");
    setActiveView("fm");
    setIsTransportOpen(true);
  }

  function playChatItem(item: QueueItem, queue: QueueItem[]) {
    const playableQueue = queue.filter((entry) => entry.kind === "song" && entry.url);
    const index = playableQueue.findIndex((entry) => entry.id === item.id);
    if (index < 0) {
      setError("Play failed: Queue item is not playable");
      return;
    }

    if (transportMode === "fm" && audioRef.current) {
      fmResumeTimeRef.current = audioRef.current.currentTime;
      audioRef.current.pause();
    } else {
      audioRef.current?.pause();
    }
    if (state.playbackMode === "fm") {
      setIsFmPausedByChat(true);
    }
    setChatQueue(playableQueue);
    setChatIndex(index);
    refreshedChatItemIdsRef.current.clear();
    setTransportMode("chat");
    setIsFmQueueOpen(false);
    setIsTransportOpen(true);
    setCurrentTime(0);
    setDuration(0);
    setIsPaused(false);
  }

  function openNeteaseGuide() {
    setError("");
    setNeteaseMessage("");
    setIsCookieImportOpen(false);
    setIsNeteaseGuideOpen(true);
  }

  async function disconnectNetease() {
    setError("");
    try {
      await logoutNetease();
      setNeteaseLoggedIn(false);
      setNeteaseMessage("");
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Netease logout failed");
    }
  }

  async function saveNeteaseCookie() {
    const cookie = neteaseCookieInput.trim();
    if (!cookie) {
      return;
    }

    setError("");
    try {
      const status = await importNeteaseCookie(cookie);
      setNeteaseLoggedIn(status.loggedIn);
      setNeteaseCookieInput("");
      setIsCookieImportOpen(false);
      setIsNeteaseGuideOpen(false);
      setNeteaseMessage("Netease connected");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Netease cookie import failed");
    }
  }

  useEffect(() => {
    void getNeteaseLoginStatus()
      .then((status) => setNeteaseLoggedIn(status.loggedIn))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!error) {
      return;
    }

    const timeout = window.setTimeout(() => setError(""), 2000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    if (!isNeteaseGuideOpen && !isCookieImportOpen) {
      return;
    }

    function closeNeteasePopovers(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || neteaseLoginRef.current?.contains(target)) {
        return;
      }

      setIsNeteaseGuideOpen(false);
      setIsCookieImportOpen(false);
    }

    document.addEventListener("pointerdown", closeNeteasePopovers);
    return () => document.removeEventListener("pointerdown", closeNeteasePopovers);
  }, [isCookieImportOpen, isNeteaseGuideOpen]);

  useEffect(() => {
    if (state.fmProgram?.id && state.fmProgram.id !== lastFmProgramIdRef.current) {
      lastFmProgramIdRef.current = state.fmProgram.id;
      refreshedFmItemIdsRef.current.clear();
      setActiveView("fm");
      setTransportMode("fm");
      setIsTransportOpen(true);
      return;
    }

    if (!lastFmProgramIdRef.current && state.playbackMode === "fm" && state.fmProgram) {
      lastFmProgramIdRef.current = state.fmProgram.id;
    }
  }, [state.fmProgram?.id, state.playbackMode]);

  useEffect(() => {
    if (!isTransportOpen || transportMode !== "fm") {
      setIsFmQueueOpen(false);
    }
  }, [isTransportOpen, transportMode]);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsPaused(false);
  }, [current?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audioSrc || !audio) {
      return;
    }

    audio.volume = volume;
    if (suppressNextAutoPlayRef.current) {
      suppressNextAutoPlayRef.current = false;
      audio.pause();
      setIsPaused(true);
      return;
    }

    void audio.play().catch((playError) => {
      if (isBenignPlaybackInterruption(playError)) {
        return;
      }
      if (isUnsupportedPlaybackSource(playError) && transportMode === "fm" && current?.kind === "song") {
        void refreshCurrentFmTrack(playError);
        return;
      }
      setIsPaused(true);
      if (playError instanceof DOMException && playError.name === "NotAllowedError") {
        return;
      }
      setError(playError instanceof Error ? playError.message : "Playback was blocked");
    });
  }, [audioSrc, volume]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused) {
      void audio.play()
        .then(() => {
          setIsPaused(false);
          if (transportMode === "fm") {
            setIsFmPausedByChat(false);
          }
        })
        .catch((playError) => {
          if (isBenignPlaybackInterruption(playError) || playError instanceof DOMException && playError.name === "NotAllowedError") {
            return;
          }
          if (isUnsupportedPlaybackSource(playError) && transportMode === "fm" && current?.kind === "song") {
            void refreshCurrentFmTrack(playError);
            return;
          }
          setIsPaused(true);
          setError(playError instanceof Error ? playError.message : "Playback was blocked");
        });
    } else {
      audio.pause();
      setIsPaused(true);
    }
  }

  function stopPlayback() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
    setIsPaused(true);
    if (transportMode === "chat") {
      setChatIndex(-1);
    }
  }

  function nextChatTrack() {
    if (chatIndex + 1 < chatQueue.length) {
      setChatIndex((index) => index + 1);
      return;
    }

    stopPlayback();
  }

  function previousChatTrack() {
    if (chatIndex > 0) {
      setChatIndex((index) => index - 1);
      return;
    }

    seek(0);
  }

  function goNextTrack() {
    if (transportMode === "fm") {
      if (current) {
        void nextTrack(current.id);
      }
      return;
    }

    nextChatTrack();
  }

  function goPreviousTrack() {
    if (transportMode === "fm") {
      void previousTrack();
      return;
    }

    previousChatTrack();
  }

  async function refreshCurrentChatTrack(errorCode?: number) {
    if (!chatCurrent || chatIndex < 0) {
      setError(`Audio failed to load${errorCode ? `: ${errorCode}` : ""}`);
      return;
    }

    if (refreshedChatItemIdsRef.current.has(chatCurrent.id)) {
      setError(`Audio failed to load${errorCode ? `: ${errorCode}` : ""}`);
      setIsPaused(true);
      return;
    }

    refreshedChatItemIdsRef.current.add(chatCurrent.id);

    try {
      const refreshed = await resolveSong(chatCurrent);
      setChatQueue((queue) =>
        queue.map((item, index) =>
          index === chatIndex
            ? {
                ...item,
                ...refreshed,
                id: item.id,
                reason: item.reason
              }
            : item
        )
      );
      setCurrentTime(0);
      setDuration(0);
      setIsPaused(false);
    } catch (refreshError) {
      setIsPaused(true);
      setError(refreshError instanceof Error ? refreshError.message : `Audio failed to load${errorCode ? `: ${errorCode}` : ""}`);
    }
  }

  async function refreshCurrentFmTrack(playbackError?: unknown, errorCode?: number) {
    if (!fmCurrent || fmCurrent.kind !== "song") {
      setError(`Audio failed to load${errorCode ? `: ${errorCode}` : ""}`);
      return;
    }

    if (refreshedFmItemIdsRef.current.has(fmCurrent.id)) {
      setIsPaused(true);
      setError(playbackError instanceof Error ? playbackError.message : `Audio failed to load${errorCode ? `: ${errorCode}` : ""}`);
      void nextTrack(fmCurrent.id).catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Next track failed");
      });
      return;
    }

    refreshedFmItemIdsRef.current.add(fmCurrent.id);

    try {
      const nextState = await playQueueItem(fmCurrent.id, { refresh: true });
      const refreshedItem = nextState.queue.find((item) => item.id === fmCurrent.id);
      if (!refreshedItem?.url) {
        throw new Error("Audio refresh returned no playable URL");
      }

      const audio = audioRef.current;
      if (!audio) {
        return;
      }

      audio.pause();
      audio.src = refreshedItem.url;
      audio.volume = volume;
      audio.load();
      setCurrentTime(0);
      setDuration(0);
      setIsPaused(false);
      await audio.play();
    } catch (refreshError) {
      if (isBenignPlaybackInterruption(refreshError)) {
        return;
      }
      setIsPaused(true);
      setError(refreshError instanceof Error ? refreshError.message : `Audio failed to load${errorCode ? `: ${errorCode}` : ""}`);
      void nextTrack(fmCurrent.id).catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Next track failed");
      });
    }
  }

  function endFmProgram() {
    stopPlayback();
    void stopPlaybackSession()
      .then(() => {
        setIsTransportOpen(false);
        setIsFmQueueOpen(false);
        setIsFmPausedByChat(false);
        setTransportMode("chat");
        fmResumeTimeRef.current = 0;
        pendingSeekRef.current = undefined;
        suppressNextAutoPlayRef.current = false;
      })
      .catch((stopError) => {
        setError(stopError instanceof Error ? stopError.message : "Stop failed");
      });
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(duration) || duration <= 0) {
      return;
    }

    audio.currentTime = value;
    setCurrentTime(value);
  }

  function changeVolume(value: number) {
    setVolume(value);
    if (audioRef.current) {
      audioRef.current.volume = value;
    }
  }

  function replayVoice(item: QueueItem) {
    if (!item.url) {
      return;
    }

    voiceReplayRef.current?.pause();
    const audio = new Audio(item.url);
    audio.volume = volume;
    voiceReplayRef.current = audio;
    void audio.play().catch((playError) => {
      if (isBenignPlaybackInterruption(playError)) {
        return;
      }
      setError(playError instanceof Error ? playError.message : "Voice replay failed");
    });
  }

  return (
    <section className="console" data-theme={theme}>
      <header className="console-header">
        <div className="brand">
          <div className="avatar" />
          <span className="dot-logo">AirFM</span>
        </div>
        <div className="header-actions">
          <div className="netease-login" ref={neteaseLoginRef}>
            <button
              className="pill ghost"
              onClick={neteaseLoggedIn ? () => void disconnectNetease() : openNeteaseGuide}
            >
              {neteaseLoggedIn ? "NETEASE ON" : "NETEASE LOGIN"}
            </button>
            {!neteaseLoggedIn && (
              <button
                className="pill ghost"
                onClick={() => {
                  setIsNeteaseGuideOpen(false);
                  setIsCookieImportOpen(true);
                }}
              >
                IMPORT COOKIE
              </button>
            )}
            {isNeteaseGuideOpen && (
              <div className="netease-popover guide">
                <strong>网易云 Cookie 登录</strong>
                <ol>
                  <li>在浏览器打开网易云音乐官网并登录账号。</li>
                  <li>登录成功后，打开浏览器开发者工具，复制 music.163.com 的 Cookie。</li>
                  <li>回到 AirFM，点击“导入 Cookie”，粘贴后保存。</li>
                </ol>
                <div className="cookie-actions">
                  <a className="pill ghost" href="https://music.163.com/" target="_blank" rel="noreferrer">
                    打开官网
                  </a>
                  <button className="pill" onClick={() => {
                    setIsNeteaseGuideOpen(false);
                    setIsCookieImportOpen(true);
                  }}>
                    导入 Cookie
                  </button>
                </div>
              </div>
            )}
            {isCookieImportOpen && (
              <div className="netease-popover wide cookie-import">
                <textarea
                  value={neteaseCookieInput}
                  onChange={(event) => setNeteaseCookieInput(event.target.value)}
                  placeholder="Paste Netease Cookie with MUSIC_U=..."
                />
                <div className="cookie-actions">
                  <button className="pill ghost" onClick={() => setIsCookieImportOpen(false)}>
                    CANCEL
                  </button>
                  <button className="pill" onClick={() => void saveNeteaseCookie()}>
                    SAVE
                  </button>
                </div>
              </div>
            )}
            {neteaseMessage && <span className="netease-status">{neteaseMessage}</span>}
          </div>
          <div className="theme-toggle" aria-label="Theme">
            <button onClick={() => setTheme("dark")} data-active={theme === "dark"}>
              DARK
            </button>
            <button onClick={() => setTheme("light")} data-active={theme === "light"}>
              LIGHT
            </button>
          </div>
        </div>
      </header>

      <section className="clock-panel" data-transport-open={isTransportOpen}>
        <div className="dot-clock">{time}</div>
        <div className="clock-meta">
          <strong>{weekday}</strong>
          <span>{date}</span>
          <em>{state.status === "planning" ? "THINKING" : "ON AIR"}</em>
        </div>
      </section>

      <div className="transport-drawer" data-open={isTransportOpen} data-mode={transportMode}>
        <div className="transport-drawer-inner" aria-hidden={!isTransportOpen}>
          <section className="transport" data-mode={transportMode} data-playing={!isPaused && Boolean(audioSrc)}>
            <div className="track-card">
              <div className="bars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="track-copy">
                <strong>{current?.title ?? "AirFM"}</strong>
                <span>{current?.artist ?? current?.kind ?? "waiting"}</span>
              </div>
            </div>
            <div className="controls" aria-label="Playback controls">
              {transportMode === "chat" && (
                <button className="transport-primary" title="Previous" onClick={goPreviousTrack}>
                  |‹
                </button>
              )}
              <button className="transport-primary" title={isPaused ? "Play" : "Pause"} onClick={togglePlay}>
                {isPaused ? "▶" : "Ⅱ"}
              </button>
              {transportMode === "chat" && (
                <button className="transport-primary" title="Next" onClick={goNextTrack}>
                  ›|
                </button>
              )}
              <button
                className={transportMode === "fm" ? "transport-primary" : undefined}
                title={transportMode === "fm" ? "End FM" : "Stop"}
                onClick={transportMode === "fm" ? endFmProgram : stopPlayback}
              >
                ■
              </button>
              {transportMode === "fm" && (
                <>
                  <button className="pill" onClick={() => setIsTransportOpen(false)}>
                    HIDE
                  </button>
                  <button
                    className="pill"
                    onClick={() => setIsFmQueueOpen((open) => !open)}
                    data-active={isFmQueueOpen}
                  >
                    LIST
                  </button>
                </>
              )}
            </div>
            <div className="volume">
              <span>VOL</span>
              <div className="progress-line volume-line" style={{ "--progress": volume } as CSSProperties}>
                <input
                  aria-label="Volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={(event) => changeVolume(Number(event.target.value))}
                />
              </div>
            </div>
            {transportMode === "fm" && isFmQueueOpen && (
              <div className="fm-queue-popover" role="status" aria-live="polite">
                <strong>FM QUEUE</strong>
                <div>
                  {fmSongs.length > 0 ? (
                    fmSongs.map((item, index) => (
                      <div key={item.id} className="fm-queue-row" data-current={item.id === current?.id}>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <div>
                          <em>{item.title}</em>
                          <small>{item.artist ?? "Unknown artist"}</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p>No FM songs queued</p>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="progress-strip" data-mode={transportMode}>
            <span>{formatTime(currentTime)}</span>
            {transportMode === "fm" ? (
              <div className="progress-line live-progress" aria-label="FM live progress">
                <span />
              </div>
            ) : (
              <div className="progress-line chat-progress" style={{ "--progress": progressRatio } as CSSProperties}>
                <input
                  aria-label="Playback progress"
                  type="range"
                  min="0"
                  max={duration || 0}
                  step="0.1"
                  value={Math.min(currentTime, duration || 0)}
                  onChange={(event) => seek(Number(event.target.value))}
                  disabled={!duration}
                />
              </div>
            )}
            <span>{progressTail}</span>
          </section>
        </div>
      </div>

      <section className="station">
        <div className="station-title">
          <div className="station-title-main">
            <span className="live-dot" data-live={hasActiveFmProgram} />
            <button
              className="fm-start"
              onClick={hasActiveFmProgram ? openFmTransport : () => void startFm()}
              disabled={isFmStarting || state.status === "planning"}
            >
              {(isFmStarting || (state.status === "planning" && activeView === "fm")) ? "FM LOADING" : hasActiveFmProgram ? "LIVE" : "FM START"}
            </button>
            <strong className="dot-logo small">AirFM</strong>
          </div>
          <div className="view-switch" aria-label="Window mode">
            <button data-active={activeView === "fm"} onClick={() => setActiveView("fm")}>
              FM
            </button>
            <button data-active={activeView === "chat"} onClick={() => setActiveView("chat")}>
              Chat
            </button>
          </div>
        </div>
        {activeView === "fm" ? (
          <FmLog state={state} current={current} onReplayVoice={replayVoice} />
        ) : (
          <div className="chat-log">
            {state.messages.length === 0 && (
              <p className="connected">Connected to AirFM server</p>
            )}
            {state.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                current={current}
                onPlay={(item, queue) => playChatItem(item, queue)}
                onReplayVoice={replayVoice}
              />
            ))}
          </div>
        )}
      </section>

      <footer className="composer">
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (
              shouldSubmitPrompt({
                key: event.key,
                shiftKey: event.shiftKey,
                altKey: event.altKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                nativeIsComposing: event.nativeEvent.isComposing
              })
            ) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={isComposerLocked ? "FM mode is on air..." : "Say something to the DJ..."}
          disabled={isSubmitting || isComposerLocked}
        />
        <button className="round" title="Voice input" disabled={isComposerLocked}>◌</button>
        <button className="round send" onClick={() => void submit()} title="Send" disabled={isSubmitting || isComposerLocked}>
          ↑
        </button>
      </footer>

      {error && <p className="error floating">{error}</p>}

      <div className="status-footer">
        <span>AIRFM</span>
        <span>{state.status === "error" ? "ERROR" : "CONNECTED"}</span>
      </div>

      <div className="hidden-audio">
        {audioSrc && (
          <audio
            ref={audioRef}
            src={audioSrc}
            playsInline
            preload="auto"
            onPlay={() => setIsPaused(false)}
            onPause={() => setIsPaused(true)}
            onError={(event) => {
              const code = event.currentTarget.error?.code;
              if (transportMode === "fm" && current?.kind === "song") {
                void refreshCurrentFmTrack(undefined, code);
                return;
              }
              if (transportMode === "chat" && current?.kind === "song") {
                void refreshCurrentChatTrack(code);
                return;
              }
              setError(`Audio failed to load${code ? `: ${code}` : ""}`);
            }}
            onLoadedMetadata={(event) => {
              const audio = event.currentTarget;
              audio.volume = volume;
              if (pendingSeekRef.current !== undefined && Number.isFinite(audio.duration)) {
                audio.currentTime = Math.min(pendingSeekRef.current, audio.duration);
                setCurrentTime(audio.currentTime);
                pendingSeekRef.current = undefined;
              }
              setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onEnded={() => {
              if (transportMode === "fm" && current) {
                void nextTrack(current.id);
                return;
              }

              nextChatTrack();
            }}
          />
        )}
      </div>
    </section>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function FmLog({
  state,
  current,
  onReplayVoice
}: {
  state: PlaybackState;
  current?: QueueItem;
  onReplayVoice(item: QueueItem): void;
}) {
  const currentIndex = Math.max(state.currentIndex, 0);
  const visibleMessages = (state.fmProgram?.messages ?? []).filter((message) => {
    const itemId = message.type === "segue" ? message.voiceItemId : message.songItemId;
    const itemIndex = state.queue.findIndex((item) => item.id === itemId);
    const item = state.queue[itemIndex];
    if (itemIndex < 0 || itemIndex > currentIndex || !item?.url) {
      return false;
    }

    if (message.type === "nowPlaying") {
      return item.kind === "song" && item.playbackStatus !== "unavailable";
    }

    return item.kind === "voice";
  });

  return (
    <div className="chat-log fm-log">
      {!state.fmProgram && <p className="connected">FM program is waiting to start</p>}
      {state.fmProgram && visibleMessages.length === 0 && (
        <p className="connected">Preparing AirFM</p>
      )}
      {visibleMessages.map((message) => {
        if (message.type === "nowPlaying") {
          return (
            <div key={message.id} className="now-playing-line">
              Now playing: {message.title}{message.artist ? ` - ${message.artist}` : ""}
            </div>
          );
        }

        const voice = state.queue.find((item) => item.id === message.voiceItemId);
        const replayItem = voice ?? {
          id: message.voiceItemId,
          kind: "voice" as const,
          title: `FM Segue ${message.segmentIndex + 1}`,
          text: message.text
        };

        return (
          <article key={message.id} className="message dj fm-message">
            <div className="message-avatar" />
            <div className="message-body">
              <span className="speaker">AIRFM</span>
              <p>{message.text}</p>
              <button
                className="voice-replay"
                data-active={current?.id === replayItem.id}
                onClick={() => onReplayVoice(replayItem)}
                title={replayItem.url ? "Replay DJ voice" : "DJ voice unavailable"}
                disabled={!replayItem.url}
              >
                <span>{current?.id === replayItem.id ? "Ⅱ" : replayItem.url ? "↻" : "×"}</span>
                <em>{replayItem.url ? "REPLAY" : "VOICE UNAVAILABLE"}</em>
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function MessageBubble({
  message,
  current,
  onPlay,
  onReplayVoice
}: {
  message: ChatMessage;
  current?: QueueItem;
  onPlay(item: QueueItem, queue: QueueItem[]): void;
  onReplayVoice(item: QueueItem): void;
}) {
  const isUser = message.role === "user";
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

  return (
    <article className={`message ${isUser ? "user" : "dj"}`}>
      <div className="message-avatar" />
      <div className="message-body">
        <span className="speaker">{isUser ? "YOU" : "AIRFM"}</span>
        <p>{message.text}</p>
        {!isUser && message.voice?.url && (
          <button
            className="voice-replay"
            data-active={current?.id === message.voice.id}
            onClick={() => onReplayVoice(message.voice as QueueItem)}
            title="Replay DJ voice"
          >
            <span>{current?.id === message.voice.id ? "Ⅱ" : "↻"}</span>
            <em>REPLAY</em>
          </button>
        )}
        {message.recommendations && message.recommendations.length > 0 && (
          <div className="recommendations">
            {message.recommendations.map((item) => (
              <button
                key={item.id}
                className="recommendation"
                data-active={current?.id === item.id}
                disabled={!item.url}
                onClick={() => onPlay(item, message.recommendations ?? [item])}
              >
                <span>{!item.url ? "×" : current?.id === item.id ? "★" : "▶"}</span>
                <strong>{item.title}</strong>
                <em>{item.url ? item.artist ?? item.reason ?? "Netease" : "不可播放 · 网易云未返回音频"}</em>
              </button>
            ))}
          </div>
        )}
        <small>{time}</small>
      </div>
    </article>
  );
}
