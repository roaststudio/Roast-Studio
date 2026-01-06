import { forwardRef, useEffect, useRef, useState, useMemo } from "react";

export interface SmallHostProps {
  type: "hostA" | "hostB";
  isSpeaking: boolean;
  size?: "small" | "large";
}

export const SmallHost = forwardRef<SVGSVGElement, SmallHostProps>(
  ({ type, isSpeaking, size = "small" }, ref) => {
    const rafRef = useRef<number | null>(null);
    const [t, setT] = useState(() => performance.now());

    // Random offsets for unique idle behavior (stable per mount)
    const randomOffsets = useMemo(() => ({
      armPhase: Math.random() * Math.PI * 2,
      bobPhase: Math.random() * Math.PI * 2,
      headPhase: Math.random() * Math.PI * 2,
      armSpeed: 1.5 + Math.random() * 1.5,
      bobSpeed: 1 + Math.random() * 1,
      headSpeed: 0.8 + Math.random() * 0.6,
      armAmp: 4 + Math.random() * 6,
      bobAmp: 1 + Math.random() * 2,
      headAmp: 2 + Math.random() * 3,
    }), []);

    useEffect(() => {
      const loop = (now: number) => {
        setT(now);
        rafRef.current = requestAnimationFrame(loop);
      };

      rafRef.current = requestAnimationFrame(loop);
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }, []);

    const seconds = t / 1000;

    const skinColor = type === "hostA" ? "hsl(16 70% 88%)" : "hsl(28 35% 68%)";
    const shirtColor = type === "hostA" ? "hsl(30 80% 50%)" : "hsl(200 80% 40%)";
    const pantsColor = type === "hostA" ? "hsl(220 60% 30%)" : "hsl(0 0% 20%)";
    const hairColor = type === "hostA" ? "hsl(25 28% 22%)" : "hsl(0 0% 10%)";
    const glowColor =
      type === "hostA" ? "hsl(30 100% 50% / 0.7)" : "hsl(200 100% 50% / 0.7)";

    // Idle animations with randomized offsets
    const idleArmL = Math.sin(seconds * randomOffsets.armSpeed + randomOffsets.armPhase) * randomOffsets.armAmp;
    const idleArmR = Math.sin(seconds * randomOffsets.armSpeed * 0.9 + randomOffsets.armPhase + 1) * randomOffsets.armAmp;
    const idleBob = Math.sin(seconds * randomOffsets.bobSpeed + randomOffsets.bobPhase) * randomOffsets.bobAmp;
    const idleHead = Math.sin(seconds * randomOffsets.headSpeed + randomOffsets.headPhase) * randomOffsets.headAmp;
    const idleLean = Math.sin(seconds * 0.7 + randomOffsets.bobPhase) * 1.5;

    // Speaking animations - much more energetic and varied
    const speakArmL = Math.sin(seconds * 14 + Math.sin(seconds * 3) * 2) * 25 + Math.sin(seconds * 7) * 10;
    const speakArmR = Math.sin(seconds * 12 + Math.cos(seconds * 4) * 2) * 25 + Math.cos(seconds * 8) * 10;
    const speakBob = Math.sin(seconds * 18) * 6 + Math.sin(seconds * 11) * 3;
    const speakHead = Math.sin(seconds * 10) * 5 + Math.cos(seconds * 7) * 3;
    const speakLean = Math.sin(seconds * 8) * 3;

    const armSwingL = isSpeaking ? speakArmL : idleArmL;
    const armSwingR = isSpeaking ? speakArmR : idleArmR;
    const bodyBob = isSpeaking ? speakBob : idleBob;
    const headTilt = isSpeaking ? speakHead : idleHead;
    const bodyLean = isSpeaking ? speakLean : idleLean;

    // Mouth animation - more varied when speaking
    const mouthBase = isSpeaking ? 3 : 0;
    const mouthVar = isSpeaking 
      ? Math.abs(Math.sin(seconds * 28)) * 5 + Math.abs(Math.sin(seconds * 19)) * 3
      : 0;
    const mouthOpen = mouthBase + mouthVar;

    // Eye blink
    const blink = Math.sin(seconds * 0.3) > 0.98 ? 0.3 : 1;

    // Size classes - full-body view
    const sizeClass =
      size === "large" ? "w-44 h-44 md:w-64 md:h-64" : "w-24 h-24";

    return (
      <svg
        ref={ref}
        viewBox="0 -15 60 115"
        className={`${sizeClass} transition-all duration-200`}
        style={{
          transformOrigin: "center bottom",
          filter: isSpeaking
            ? `drop-shadow(0 0 25px ${glowColor}) drop-shadow(0 0 50px ${glowColor})`
            : `drop-shadow(0 0 8px ${glowColor.replace("0.7", "0.2")})`,
        }}
      >
        <g transform={`translate(0, ${bodyBob}) rotate(${bodyLean}, 30, 50)`}>
          {/* Head with tilt */}
          <g transform={`rotate(${headTilt * 0.3}, 30, 16)`}>
            <ellipse cx="30" cy="10" rx="12" ry="8" fill={hairColor} />
            <ellipse cx="30" cy="16" rx="10" ry="11" fill={skinColor} />

            {/* Eyes with blink */}
            <ellipse cx="26" cy="14" rx="2" ry={2.5 * blink} fill="white" />
            <ellipse cx="34" cy="14" rx="2" ry={2.5 * blink} fill="white" />
            <circle cx="26" cy="14" r={1 * blink} fill="hsl(0 0% 20%)" />
            <circle cx="34" cy="14" r={1 * blink} fill="hsl(0 0% 20%)" />

            {/* Eyebrows - more expressive when speaking */}
            <path 
              d={`M23 ${11 - (isSpeaking ? Math.sin(seconds * 10) * 1.5 : 0)} L29 12`} 
              stroke="hsl(0 0% 20%)" 
              strokeWidth="1.2" 
              fill="none" 
            />
            <path 
              d={`M31 12 L37 ${11 - (isSpeaking ? Math.sin(seconds * 10 + 0.5) * 1.5 : 0)}`} 
              stroke="hsl(0 0% 20%)" 
              strokeWidth="1.2" 
              fill="none" 
            />

            {/* Nose */}
            <path
              d="M30 16 L28 20 L30 20"
              stroke={skinColor}
              strokeWidth="1"
              fill="none"
              style={{ filter: "brightness(0.9)" }}
            />

            {/* Mouth - more dynamic */}
            <ellipse cx="30" cy="22" rx={3 + (isSpeaking ? Math.sin(seconds * 15) * 0.5 : 0)} ry={1 + mouthOpen} fill="hsl(25 40% 40%)" />
            {mouthOpen > 3 && (
              <>
                <rect x="28" y="21" width="4" height="2" fill="white" rx="0.5" />
                <ellipse cx="30" cy={23 + mouthOpen * 0.3} rx="2" ry="1" fill="hsl(350 60% 45%)" />
              </>
            )}
          </g>

          {/* Neck */}
          <rect x="27" y="26" width="6" height="4" fill={skinColor} />

          {/* Body */}
          <path d="M20 30 L40 30 L42 55 L18 55 Z" fill={shirtColor} />

          {/* Left arm */}
          <g transform={`rotate(${-10 + armSwingL}, 22, 32)`}>
            <rect x="10" y="30" width="12" height="6" rx="3" fill={shirtColor} />
            <ellipse cx="10" cy="33" rx="4" ry="5" fill={skinColor} />
          </g>

          {/* Right arm */}
          <g transform={`rotate(${10 - armSwingR}, 38, 32)`}>
            <rect x="38" y="30" width="12" height="6" rx="3" fill={shirtColor} />
            <ellipse cx="50" cy="33" rx="4" ry="5" fill={skinColor} />
          </g>

          {/* Legs */}
          <path d="M18 55 L22 80 L28 80 L30 60 L32 80 L38 80 L42 55 Z" fill={pantsColor} />
          <ellipse cx="25" cy="82" rx="5" ry="3" fill="hsl(0 0% 20%)" />
          <ellipse cx="35" cy="82" rx="5" ry="3" fill="hsl(0 0% 20%)" />

          {/* Accessories */}
          {type === "hostA" ? (
            <g transform={`rotate(${-30 + armSwingL * 0.5}, 8, 40)`}>
              <rect x="3" y="35" width="2" height="10" fill="hsl(0 0% 40%)" />
              <ellipse cx="4" cy="33" rx="3" ry="4" fill="hsl(0 0% 20%)" />
            </g>
          ) : (
            <>
              <rect
                x="23"
                y="12"
                width="6"
                height="5"
                fill="none"
                stroke="hsl(0 0% 20%)"
                strokeWidth="1"
                rx="1"
              />
              <rect
                x="31"
                y="12"
                width="6"
                height="5"
                fill="none"
                stroke="hsl(0 0% 20%)"
                strokeWidth="1"
                rx="1"
              />
              <path d="M29 14 L31 14" stroke="hsl(0 0% 20%)" strokeWidth="1" />
            </>
          )}
        </g>
      </svg>
    );
  },
);

SmallHost.displayName = "SmallHost";
