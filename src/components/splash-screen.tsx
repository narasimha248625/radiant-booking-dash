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
      <img
        src="/stories-arena-runner-badge.png"
        alt=""
        width={160}
        height={160}
        className="h-36 w-36 object-contain sm:h-44 sm:w-44"
      />
      <p className="mt-2 font-sans text-2xl font-extrabold tracking-[0.12em] text-white sm:text-3xl">
        STORIES ARENA
      </p>
      <p className="mt-4 text-sm font-medium text-white/70 uppercase tracking-widest animate-pulse">
        Premium Box Cricket
      </p>
    </div>
  );
}
