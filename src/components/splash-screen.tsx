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
        src="/stories-arena-logo.png"
        alt="Stories Arena"
        width={360}
        height={240}
        className="w-72 max-w-[85vw] object-contain sm:w-96"
      />
      <p className="mt-4 text-sm font-medium text-white/70 uppercase tracking-widest animate-pulse">
        Premium Box Cricket
      </p>
    </div>
  );
}
