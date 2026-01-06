import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Square, Send, MessageSquare, Play, Trash2, Pause, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AudioWaveform } from "./AudioWaveform";

const MAX_ROASTS_PER_USER = 3;

interface SubmissionFormProps {
  sessionId: string;
  disabled?: boolean;
}

export function SubmissionForm({ sessionId, disabled }: SubmissionFormProps) {
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [isRecording, setIsRecording] = useState(false);
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [userRoastCount, setUserRoastCount] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { toast } = useToast();

  // Storage key is per-session so limit is per round
  const storageKey = `roast-count-session-${sessionId}`;

  // Load user's roast count for this session from localStorage
  useEffect(() => {
    const storedCount = localStorage.getItem(storageKey);
    setUserRoastCount(storedCount ? parseInt(storedCount, 10) : 0);
  }, [storageKey]);

  const incrementRoastCount = () => {
    const newCount = userRoastCount + 1;
    localStorage.setItem(storageKey, String(newCount));
    setUserRoastCount(newCount);
  };

  const hasReachedLimit = userRoastCount >= MAX_ROASTS_PER_USER;

  const transcribeAudio = useCallback(async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;
        
        const { data, error } = await supabase.functions.invoke("transcribe-audio", {
          body: { audio: base64Audio },
        });

        if (error) {
          console.error("Transcription error:", error);
          setTranscript(null);
        } else if (data?.text) {
          setTranscript(data.text);
        } else {
          setTranscript(null);
        }
        setIsTranscribing(false);
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error("Transcription failed:", error);
      setTranscript(null);
      setIsTranscribing(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(audioBlob);
        setRecordedBlob(audioBlob);
        setRecordedUrl(url);
        stream.getTracks().forEach((track) => track.stop());
        
        // Transcribe the recording
        transcribeAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      setTranscript(null);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= 7) {
            stopRecording();
            return 7;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (error) {
      toast({
        title: "Microphone access denied",
        description: "Please allow microphone access to record your roast.",
        variant: "destructive",
      });
    }
  }, [transcribeAudio]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  const playRecording = useCallback(() => {
    if (!recordedUrl) return;
    
    if (audioRef.current) {
      audioRef.current.pause();
    }
    
    const audio = new Audio(recordedUrl);
    audioRef.current = audio;
    
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => setIsPlaying(false);
    
    audio.play();
    setIsPlaying(true);
  }, [recordedUrl]);

  const stopPlaying = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
  }, []);

  const deleteRecording = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
    }
    setRecordedBlob(null);
    setRecordedUrl(null);
    setIsPlaying(false);
    setRecordingTime(0);
    setTranscript(null);
  }, [recordedUrl]);

  const submitRecording = async () => {
    if (!recordedBlob || hasReachedLimit) return;
    
    setIsSubmitting(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;
        
        const { error } = await supabase.from("roast_messages").insert({
          session_id: sessionId,
          audio_url: base64Audio,
          transcript: transcript || "[Voice submission]",
        });

        if (error) throw error;

        incrementRoastCount();
        deleteRecording();
        toast({
          title: "Roast submitted!",
          description: `Your voice clip is in the queue. (${userRoastCount + 1}/${MAX_ROASTS_PER_USER} total)`,
        });
      };
      reader.readAsDataURL(recordedBlob);
    } catch (error) {
      toast({
        title: "Failed to submit",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitText = async () => {
    if (!text.trim() || hasReachedLimit) return;
    
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("roast_messages").insert({
        session_id: sessionId,
        transcript: text.trim(),
      });

      if (error) throw error;

      incrementRoastCount();
      setText("");
      toast({
        title: "Roast submitted!",
        description: `Your message will be converted to voice. (${userRoastCount + 1}/${MAX_ROASTS_PER_USER} total)`,
      });
    } catch (error) {
      toast({
        title: "Failed to submit",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (disabled) {
    return (
      <div className="p-4 rounded-lg bg-studio-surface border border-border text-center">
        <p className="text-muted-foreground text-sm">Submissions are closed for this session.</p>
      </div>
    );
  }

  if (hasReachedLimit) {
    return (
      <div className="p-4 rounded-lg bg-studio-surface border border-border text-center">
        <p className="text-muted-foreground text-sm">You've reached your limit of {MAX_ROASTS_PER_USER} roasts.</p>
        <p className="text-xs text-muted-foreground mt-1">Thanks for participating!</p>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg bg-studio-surface border border-border space-y-2 fade-in-up max-h-[calc(100vh-300px)] overflow-y-auto">
      {/* Mode Toggle */}
      <div className="flex gap-2 p-1 bg-studio-elevated rounded-lg">
        <button
          onClick={() => setMode("voice")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md transition-all ${
            mode === "voice"
              ? "bg-primary text-primary-foreground shadow-neon-cyan"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Mic className="w-4 h-4" />
          Voice
        </button>
        <button
          onClick={() => setMode("text")}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md transition-all ${
            mode === "text"
              ? "bg-primary text-primary-foreground shadow-neon-cyan"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          Text
        </button>
      </div>

      {mode === "voice" ? (
        <div className="flex flex-col items-center gap-2">
          {/* Preview mode - show recorded audio */}
          {recordedBlob ? (
            <>
              <p className="text-sm text-muted-foreground">
                Preview your recording • {recordingTime}s
              </p>
              
              {/* Waveform visualization for playback */}
              <AudioWaveform 
                audioUrl={recordedUrl} 
                isPlaying={isPlaying}
              />
              
              {/* Transcript display */}
              <div className="w-full px-4">
                {isTranscribing ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Transcribing...
                  </div>
                ) : transcript ? (
                  <div className="p-3 bg-studio-elevated rounded-lg border border-border">
                    <p className="text-xs text-muted-foreground mb-1">Your message:</p>
                    <p className="text-sm text-foreground">"{transcript}"</p>
                  </div>
                ) : null}
              </div>
              
              <div className="flex items-center gap-3">
                {/* Play/Pause button */}
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={isPlaying ? stopPlaying : playRecording}
                  className="rounded-full w-14 h-14 border-2 border-primary"
                >
                  {isPlaying ? (
                    <Pause className="w-6 h-6 text-primary" />
                  ) : (
                    <Play className="w-6 h-6 text-primary" />
                  )}
                </Button>
                
                {/* Delete button */}
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={deleteRecording}
                  className="rounded-full w-14 h-14 border-2 border-destructive text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-6 h-6" />
                </Button>
              </div>
              
              {/* Submit button */}
              <Button
                variant="neon"
                size="lg"
                onClick={submitRecording}
                disabled={isSubmitting}
                className="mt-2"
              >
                <Send className="w-4 h-4 mr-2" />
                {isSubmitting ? "Sending..." : "Send Roast"}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Record up to 7 seconds • {isRecording ? `${recordingTime}s` : "Tap to start"}
              </p>
              
              {/* Waveform visualization while recording */}
              {isRecording && (
                <AudioWaveform 
                  stream={streamRef.current} 
                  isPlaying={isRecording}
                />
              )}
              
              {isRecording ? (
                <Button
                  variant="record"
                  size="lg"
                  onClick={stopRecording}
                  className="rounded-full w-16 h-16"
                >
                  <Square className="w-8 h-8" />
                </Button>
              ) : (
                <Button
                  variant="neon"
                  size="lg"
                  onClick={startRecording}
                  disabled={isSubmitting}
                  className="rounded-full w-16 h-16"
                >
                  <Mic className="w-8 h-8" />
                </Button>
              )}

              {/* Recording indicator */}
              {isRecording && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-accent animate-pulse" />
                  <span className="text-sm text-accent">Recording...</span>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Textarea
            placeholder="Type your roast here... Keep it fun! 🔥"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 100))}
            className="min-h-20 bg-studio-elevated border-border focus:border-primary resize-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{text.length}/100</span>
            <Button
              variant="neon"
              onClick={submitText}
              disabled={!text.trim() || isSubmitting}
            >
              <Send className="w-4 h-4 mr-2" />
              Submit Roast
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}