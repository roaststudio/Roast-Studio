import { useState, useEffect } from "react";

interface CountdownTimerProps {
  targetTime: Date;
  onComplete?: () => void;
}

export function CountdownTimer({ targetTime, onComplete }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState({ minutes: 0, seconds: 0 });

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const target = targetTime.getTime();
      const difference = target - now;

      if (difference <= 0) {
        onComplete?.();
        return { minutes: 0, seconds: 0 };
      }

      return {
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
      };
    };

    setTimeLeft(calculateTimeLeft());

    const timer = setInterval(() => {
      const newTimeLeft = calculateTimeLeft();
      setTimeLeft(newTimeLeft);
      
      if (newTimeLeft.minutes === 0 && newTimeLeft.seconds === 0) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [targetTime, onComplete]);

  const formatNumber = (num: number) => num.toString().padStart(2, "0");

  return (
    <div className="flex items-center justify-center gap-1">
      <div className="flex flex-col items-center">
        <span className="font-display text-5xl md:text-6xl text-primary countdown-pulse">
          {formatNumber(timeLeft.minutes)}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Min</span>
      </div>
      <span className="font-display text-4xl md:text-5xl text-primary glow-pulse">:</span>
      <div className="flex flex-col items-center">
        <span className="font-display text-5xl md:text-6xl text-primary countdown-pulse">
          {formatNumber(timeLeft.seconds)}
        </span>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Sec</span>
      </div>
    </div>
  );
}
