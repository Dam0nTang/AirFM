import { useEffect, useState } from "react";
import type { PlaybackState } from "../shared/types";
import { connectStream } from "./api";
import { PlayerView } from "./player/PlayerView";
import "./styles.css";

export function App() {
  const [state, setState] = useState<PlaybackState>({
    queue: [],
    currentIndex: -1,
    status: "idle",
    messages: [],
    playbackMode: "chat",
    activeView: "chat"
  });

  useEffect(() => {
    const socket = connectStream(setState);
    return () => socket.close();
  }, []);

  return (
    <main className="app-shell">
      <PlayerView state={state} />
    </main>
  );
}
