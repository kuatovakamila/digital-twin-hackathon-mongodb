"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MIME = "audio/mpeg";

function canStream(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaSource !== "undefined" &&
    window.MediaSource.isTypeSupported(MIME)
  );
}

export interface VoicePlayback {
  speaking: boolean;
  /** True from the moment a line is requested until audio actually starts. */
  loading: boolean;
  error: string | null;
  /** Synthesises and plays a line. Resolves when playback finishes or is cut off. */
  speak: (text: string, previousText?: string) => Promise<void>;
  /** Cuts the current line off mid-word. Used for barge-in and director notes. */
  stop: () => void;
}

/**
 * Plays persona lines through the /api/tts proxy.
 *
 * Audio is streamed into a MediaSource so the first syllable lands while the
 * rest is still being generated — a rehearsal partner that waits two seconds
 * before every line does not feel like a person. Browsers without MSE for mp3
 * fall back to buffering the whole clip.
 */
export function useVoicePlayback(): VoicePlayback {
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = "auto";
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const releaseUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    releaseUrl();
    setSpeaking(false);
    setLoading(false);
  }, [releaseUrl]);

  useEffect(() => stop, [stop]);

  const speak = useCallback(
    async (text: string, previousText?: string) => {
      stop();

      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, previousText }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const detail = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(detail.error || `TTS failed (${res.status})`);
        }

        const audio = getAudio();
        if (canStream()) {
          await playStreaming(audio, res.body, controller.signal, () => {
            setLoading(false);
            setSpeaking(true);
          });
        } else {
          const blob = await res.blob();
          if (controller.signal.aborted) return;
          releaseUrl();
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          audio.src = url;
          setLoading(false);
          setSpeaking(true);
          await playToEnd(audio, controller.signal);
        }
      } catch (err) {
        if (controller.signal.aborted) return; // Interrupted on purpose.
        const message = err instanceof Error ? err.message : "Playback failed";
        setError(message);
        console.error("[voice]", err);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setSpeaking(false);
          setLoading(false);
          releaseUrl();
        }
      }
    },
    [getAudio, releaseUrl, stop],
  );

  return { speaking, loading, error, speak, stop };
}

/** Feeds mp3 chunks into a MediaSource and plays as soon as the first lands. */
async function playStreaming(
  audio: HTMLAudioElement,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onFirstChunk: () => void,
): Promise<void> {
  const mediaSource = new MediaSource();
  const url = URL.createObjectURL(mediaSource);
  audio.src = url;

  try {
    await once(mediaSource, "sourceopen", signal);
    const sourceBuffer = mediaSource.addSourceBuffer(MIME);
    const reader = body.getReader();

    let started = false;
    let streamEnded = false;

    // appendBuffer throws if called while the buffer is still updating, so
    // chunks wait their turn here.
    const pending: Uint8Array[] = [];
    let draining = false;

    const drain = async () => {
      if (draining) return;
      draining = true;
      while (pending.length > 0) {
        if (signal.aborted) break;
        const chunk = pending.shift()!;
        try {
          sourceBuffer.appendBuffer(chunk as BufferSource);
          await once(sourceBuffer, "updateend", signal);
        } catch {
          break;
        }
      }
      draining = false;
      if (streamEnded && pending.length === 0 && mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream();
        } catch {
          // Already closed.
        }
      }
    };

    const pump = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done || signal.aborted) break;
        if (!value?.byteLength) continue;
        pending.push(value);
        void drain();
        if (!started) {
          started = true;
          onFirstChunk();
          await audio.play().catch(() => {
            // Autoplay blocked; the caller surfaces this via the error state.
          });
        }
      }
      streamEnded = true;
      void drain();
    })();

    await pump;
    if (signal.aborted) return;
    await playToEnd(audio, signal);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Resolves when the clip finishes, errors, or the caller aborts. */
function playToEnd(audio: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return resolve();

    const cleanup = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Audio playback failed"));
    };
    const onAbort = () => {
      cleanup();
      resolve();
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort);

    void audio.play().catch(() => {
      cleanup();
      reject(new Error("Playback blocked. Click anywhere, then try again."));
    });
  });
}

function once(target: EventTarget, event: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const onEvent = () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      target.removeEventListener(event, onEvent);
      reject(new DOMException("Aborted", "AbortError"));
    };
    target.addEventListener(event, onEvent, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
