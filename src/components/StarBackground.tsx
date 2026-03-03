import React, { useMemo } from "react";

interface Star {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  opacity: number;
  color: string;
}

const starColors = [
  "hsl(180 100% 85%)",  // cyan
  "hsl(330 100% 85%)",  // pink
  "hsl(270 100% 85%)",  // purple
  "hsl(55 100% 85%)",   // yellow
  "hsl(210 40% 92%)",   // white
  "hsl(120 100% 85%)",  // green
];

const StarBackground: React.FC = () => {
  const stars = useMemo<Star[]>(() => {
    return Array.from({ length: 120 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 0.5,
      delay: Math.random() * 5,
      duration: Math.random() * 3 + 2,
      opacity: Math.random() * 0.8 + 0.2,
      color: starColors[Math.floor(Math.random() * starColors.length)],
    }));
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {/* Deep space gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at 70% 20%, hsl(270 40% 12%) 0%, hsl(230 25% 8%) 50%, hsl(230 30% 4%) 100%)",
        }}
      />

      {/* Nebula glow */}
      <div
        className="absolute"
        style={{
          top: "10%",
          left: "60%",
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: "radial-gradient(circle, hsl(270 100% 60% / 0.06), transparent 70%)",
          filter: "blur(60px)",
        }}
      />
      <div
        className="absolute"
        style={{
          bottom: "20%",
          left: "10%",
          width: 300,
          height: 300,
          borderRadius: "50%",
          background: "radial-gradient(circle, hsl(180 100% 50% / 0.04), transparent 70%)",
          filter: "blur(50px)",
        }}
      />

      {/* Moon */}
      <div
        className="absolute animate-float"
        style={{ top: "6%", right: "10%", width: 70, height: 70 }}
      >
        <div
          className="rounded-full w-full h-full"
          style={{
            background: "radial-gradient(circle at 30% 30%, hsl(50 90% 95%), hsl(45 60% 75%), hsl(40 40% 55%))",
            boxShadow:
              "0 0 30px hsl(50 80% 80% / 0.5), 0 0 60px hsl(50 80% 80% / 0.2), 0 0 100px hsl(50 80% 80% / 0.1)",
          }}
        />
        {/* Moon craters */}
        <div
          className="absolute rounded-full"
          style={{
            top: "25%",
            left: "40%",
            width: 10,
            height: 10,
            background: "hsl(45 30% 60% / 0.4)",
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            top: "50%",
            left: "25%",
            width: 7,
            height: 7,
            background: "hsl(45 30% 60% / 0.3)",
          }}
        />
      </div>

      {/* Stars */}
      {stars.map((star) => (
        <div
          key={star.id}
          className="absolute rounded-full"
          style={{
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: star.size,
            height: star.size,
            backgroundColor: star.color,
            opacity: star.opacity,
            animation: `twinkle ${star.duration}s ease-in-out ${star.delay}s infinite`,
            boxShadow: star.size > 2 ? `0 0 ${star.size * 2}px ${star.color}` : "none",
          }}
        />
      ))}

      {/* Shooting star */}
      <div
        className="absolute"
        style={{
          top: "15%",
          left: "30%",
          width: 2,
          height: 2,
          backgroundColor: "hsl(180 100% 90%)",
          borderRadius: "50%",
          animation: "shooting-star 8s linear infinite",
          boxShadow: "0 0 6px hsl(180 100% 80%)",
        }}
      />
    </div>
  );
};

export default StarBackground;
