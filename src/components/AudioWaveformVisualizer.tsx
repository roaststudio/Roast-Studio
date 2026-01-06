import { useEffect, useState, forwardRef } from "react";

interface AudioWaveformVisualizerProps {
  isActive: boolean;
  color?: string;
  barCount?: number;
  className?: string;
}

export const AudioWaveformVisualizer = forwardRef<HTMLDivElement, AudioWaveformVisualizerProps>(
  function AudioWaveformVisualizer({ 
    isActive, 
    color = "hsl(var(--primary))",
    barCount = 5,
    className = ""
  }, ref) {
    const [bars, setBars] = useState<number[]>(Array(barCount).fill(20));

    useEffect(() => {
      if (!isActive) {
        setBars(Array(barCount).fill(20));
        return;
      }

      const interval = setInterval(() => {
        setBars(prev => prev.map(() => 
          Math.random() * 60 + 20 // Random height between 20-80%
        ));
      }, 100);

      return () => clearInterval(interval);
    }, [isActive, barCount]);

    return (
      <div ref={ref} className={`flex items-end justify-center gap-0.5 h-6 ${className}`}>
        {bars.map((height, i) => (
          <div
            key={i}
            className="w-1 rounded-full transition-all duration-100"
            style={{
              height: isActive ? `${height}%` : '20%',
              backgroundColor: color,
              opacity: isActive ? 1 : 0.3,
              animationDelay: `${i * 50}ms`,
            }}
          />
        ))}
      </div>
    );
  }
);
