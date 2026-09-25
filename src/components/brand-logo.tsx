import type { SVGProps } from "react";

interface BrandLogoProps extends SVGProps<SVGSVGElement> {
  size?: number;
  glow?: boolean;
}

export function BrandLogo({ size = 36, glow = true, className = "", ...props }: BrandLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={`shrink-0 select-none ${glow ? "filter drop-shadow-[0_0_12px_rgba(245,158,11,0.6)]" : ""} ${className}`}
      {...props}
    >
      <defs>
        <linearGradient id="blGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
        <linearGradient id="blEmerald" x1="100%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#047857" />
          <stop offset="50%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#6ee7b7" />
        </linearGradient>
        <linearGradient id="blDarkEmerald" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#022c22" />
          <stop offset="100%" stopColor="#064e3b" />
        </linearGradient>
        <filter id="blGlow">
          <feGaussianBlur stdDeviation="8" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Hexagon Base / Stadium shape */}
      <polygon points="256,24 464,144 464,368 256,488 48,368 48,144" fill="url(#blDarkEmerald)" stroke="url(#blEmerald)" strokeWidth="12" />

      {/* Abstract A overlapping shapes */}
      <path d="M256 80 L120 380 L180 380 L256 190 L332 380 L392 380 Z" fill="url(#blGold)" filter="url(#blGlow)" />
      
      <path d="M180 280 L332 280" stroke="url(#blEmerald)" strokeWidth="32" strokeLinecap="round" filter="url(#blGlow)"/>

      {/* Star at the apex */}
      <polygon points="256,50 266,75 296,85 266,95 256,120 246,95 216,85 246,75" fill="#ffffff" filter="url(#blGlow)"/>
    </svg>
  );
}
