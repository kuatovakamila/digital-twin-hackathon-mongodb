"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseSpeechRecognitionOptions {
  lang?: string;
  /** Fires once per completed utterance, with the tidied transcript. */
  onFinal: (transcript: string) => void;
}

export interface SpeechRecognitionState {
  supported: boolean;
  listening: boolean;
  /** Words heard so far in the current utterance. */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

function getConstructor() {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

/**
 * Microphone input via the browser's Web Speech API.
 *
 * Chrome ends a recognition session on its own after a stretch of silence and
 * roughly every minute regardless, so this restarts it whenever the caller
 * still intends to be listening. Without that the mic goes dead mid-rehearsal.
 */
export function useSpeechRecognition({
  lang = "en-US",
  onFinal,
}: UseSpeechRecognitionOptions): SpeechRecognitionState {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  /** What the caller wants, as opposed to what the engine is currently doing. */
  const wantListeningRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  useEffect(() => {
    const Ctor = getConstructor();
    if (!Ctor) {
      setSupported(false);
      setError("This browser has no Web Speech API. Use Chrome or Edge.");
      return;
    }
    setSupported(true);

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const cleaned = text.trim();
          if (cleaned) onFinalRef.current(cleaned);
        } else {
          pending += text;
        }
      }
      setInterim(pending.trim());
    };

    recognition.onerror = (event) => {
      // Silence and self-cancellation are routine, not failures.
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        wantListeningRef.current = false;
        setError("Microphone permission denied. Allow it in the address bar and reload.");
        return;
      }
      setError(event.error);
    };

    recognition.onend = () => {
      setListening(false);
      setInterim("");
      if (!wantListeningRef.current) return;
      // Chrome stops on its own; pick the session back up.
      try {
        recognition.start();
      } catch {
        // A start already in flight will fire onstart shortly.
      }
    };

    recognitionRef.current = recognition;

    return () => {
      wantListeningRef.current = false;
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onstart = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [lang]);

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || wantListeningRef.current) return;
    wantListeningRef.current = true;
    try {
      recognition.start();
    } catch {
      // Already running; onstart has us covered.
    }
  }, []);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    wantListeningRef.current = false;
    setInterim("");
    // abort() drops the in-flight utterance instead of emitting it late.
    recognition.abort();
    setListening(false);
  }, []);

  return { supported, listening, interim, error, start, stop };
}
