import { useState, useEffect } from "react";

export function SplashScreen() {
  const [show, setShow] = useState(true);
  const [animateOut, setAnimateOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimateOut(true);
      setTimeout(() => setShow(false), 800);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black transition-opacity duration-700 ${animateOut ? "opacity-0" : "opacity-100"}`}
    >
      <div className="relative flex items-center justify-center">
        <div className="absolute -inset-4 rounded-full bg-gradient-to-tr from-amber-500/40 via-yellow-400/30 to-emerald-500/20 blur-xl animate-pulse" />
        <img
          src="/stories-arena-runner-badge.png"
          alt="Stories Arena"
          width={160}
          height={160}
          className="relative h-36 w-36 object-contain drop-shadow-[0_8px_24px_rgba(217,119,6,0.6)] sm:h-44 sm:w-44"
        />
      </div>
      <div className="mt-4 flex items-baseline gap-2 font-brand text-2xl font-black tracking-[0.16em] sm:text-4xl">
        <span className="text-white">STORIES</span>
        <span className="text-primary drop-shadow-[0_2px_12px_rgba(34,197,94,0.5)]">ARENA</span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="h-[1px] w-4 bg-gradient-to-r from-transparent to-primary/80" />
        <p className="text-xs font-bold tracking-[0.28em] text-primary uppercase animate-pulse">
          Premium Box Cricket · Vizag
        </p>
        <span className="h-[1px] w-4 bg-gradient-to-l from-transparent to-primary/80" />
      </div>
    </div>
  );
}
