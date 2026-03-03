import React, { useMemo } from "react";

interface Star {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  opacity: number;
}

const StarBackground: React.FC = () => {
  const stars = useMemo<Star[]>(() => {
    return Array.from({ length: 80 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2.5 + 0.5,
      delay: Math.random() * 5,
      duration: Math.random() * 3 + 2,
      opacity: Math.random() * 0.7 + 0.3,
    }));
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {/* Moon */}
      <div
        className="absolute animate-float"
        style={{ top: "8%", right: "12%", width: 60, height: 60 }}
      >
        <div
          className="rounded-full w-full h-full"
          style={{
            background: "radial-gradient(circle at 35% 35%, hsl(50 80% 90%), hsl(45 60% 70%))",
            boxShadow: "0 0 40px hsl(50 80% 80% / 0.4), 0 0 80px hsl(50 80% 80% / 0.15)",
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
            backgroundColor: `hsl(${180 + Math.random() * 60} 80% 85%)`,
            opacity: star.opacity,
            animation: `twinkle ${star.duration}s ease-in-out ${star.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
};

export default StarBackground;
