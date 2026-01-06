import { useEffect, useRef, useState, useCallback } from "react";

interface AudioWaveformProps {
  stream?: MediaStream | null;
  audioUrl?: string | null;
  isPlaying?: boolean;
  isRecording?: boolean;
}

export function AudioWaveform({ stream, audioUrl, isPlaying, isRecording }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const draw = useCallback((analyser: AnalyserNode, dataArray: Uint8Array) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const barCount = 32;
    const barWidth = width / barCount - 2;
    const centerY = height / 2;

    analyser.getByteFrequencyData(dataArray as Uint8Array<ArrayBuffer>);

    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < barCount; i++) {
      const value = dataArray[i] / 255;
      const barHeight = Math.max(4, value * (height / 2 - 4));

      const gradient = ctx.createLinearGradient(0, centerY - barHeight, 0, centerY + barHeight);
      gradient.addColorStop(0, "hsl(180, 100%, 60%)");
      gradient.addColorStop(0.5, "hsl(180, 100%, 50%)");
      gradient.addColorStop(1, "hsl(180, 100%, 60%)");

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(
        i * (barWidth + 2) + 1,
        centerY - barHeight,
        barWidth,
        barHeight * 2,
        2
      );
      ctx.fill();
    }

    animationRef.current = requestAnimationFrame(() => draw(analyser, dataArray));
  }, []);

  // Handle microphone stream visualization
  useEffect(() => {
    if (!stream || !isRecording) return;

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    analyserRef.current = analyser;

    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    draw(analyser, dataArray);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      audioContext.close();
    };
  }, [stream, isRecording, draw]);

  // Handle playback visualization
  useEffect(() => {
    if (!audioUrl || !isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    const audio = new Audio(audioUrl);
    audioElementRef.current = audio;

    const source = audioContext.createMediaElementSource(audio);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    analyserRef.current = analyser;

    source.connect(analyser);
    analyser.connect(audioContext.destination);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    draw(analyser, dataArray);

    audio.play();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      audio.pause();
      audioContext.close();
    };
  }, [audioUrl, isPlaying, draw]);

  // Draw idle state when not active
  useEffect(() => {
    if (!isRecording && !isPlaying) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      const barCount = 32;
      const barWidth = width / barCount - 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < barCount; i++) {
        ctx.fillStyle = "hsl(180, 30%, 30%)";
        ctx.beginPath();
        ctx.roundRect(
          i * (barWidth + 2) + 1,
          centerY - 2,
          barWidth,
          4,
          2
        );
        ctx.fill();
      }
    }
  }, [isRecording, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={60}
      className="w-60 h-15"
    />
  );
}
