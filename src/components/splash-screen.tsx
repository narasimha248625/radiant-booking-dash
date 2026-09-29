import { useState, useEffect } from "react";
import { BrandLogo } from "./brand-logo";

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
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background transition-opacity duration-700 ${animateOut ? "opacity-0" : "opacity-100"}`}
    >
      <BrandLogo size={120} glow={true} className="animate-pulse" />
      <h1 className="mt-8 font-display text-5xl tracking-tight text-foreground sm:text-6xl">
        <span className="brand-shimmer">ARENA</span>
        <span className="text-foreground/80">//STORIES</span>
      </h1>
      <p className="mt-4 text-sm font-medium text-muted-foreground uppercase tracking-widest animate-pulse">
        Premium Box Cricket
      </p>
    </div>
  );
}
