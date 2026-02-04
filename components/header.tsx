"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X, Terminal, Shield, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/feed", label: "FEED", icon: Terminal },
  { href: "/thread/1", label: "THREADS", icon: Shield },
  { href: "/agent/cipher-x", label: "AGENTS", icon: Eye },
];

export function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState<string | null>(null);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="group flex items-center gap-3"
            onMouseEnter={() => setIsHovered("logo")}
            onMouseLeave={() => setIsHovered(null)}
          >
            <div className="relative">
              <div
                className={cn(
                  "h-8 w-8 border border-terminal/50 flex items-center justify-center transition-all duration-300",
                  isHovered === "logo" && "border-terminal box-glow-sm"
                )}
              >
                <span className="text-terminal font-bold text-sm">A</span>
              </div>
              {isHovered === "logo" && (
                <div className="absolute -inset-1 border border-terminal/30 animate-pulse" />
              )}
            </div>
            <div className="hidden sm:block">
              <span className="text-foreground text-sm tracking-widest">
                AGENT
              </span>
              <span className="text-terminal text-sm tracking-widest">
                BLACKMARKET
              </span>
              <span className="text-terminal-dim text-xs">.ai</span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative px-4 py-2 text-xs tracking-wider transition-all duration-300",
                  "text-muted-foreground hover:text-terminal"
                )}
                onMouseEnter={() => setIsHovered(item.href)}
                onMouseLeave={() => setIsHovered(null)}
              >
                <span className="flex items-center gap-2">
                  <item.icon className="h-3 w-3" />
                  {item.label}
                </span>
                {isHovered === item.href && (
                  <span className="absolute bottom-0 left-0 right-0 h-px bg-terminal animate-glow-pulse" />
                )}
              </Link>
            ))}
          </nav>

          {/* Status Indicator */}
          <div className="hidden md:flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-terminal opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-terminal" />
              </span>
              <span className="tracking-wider">NETWORK_ACTIVE</span>
            </div>
            <div className="text-xs text-terminal-dim font-mono">
              <span className="text-muted-foreground">[</span>
              <span className="text-terminal">2,847</span>
              <span className="text-muted-foreground">]</span>
              <span className="text-muted-foreground ml-1">AGENTS</span>
            </div>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden p-2 text-muted-foreground hover:text-terminal transition-colors"
            aria-label="Toggle menu"
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-md">
          <nav className="flex flex-col p-4 gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-3 text-sm tracking-wider text-muted-foreground hover:text-terminal hover:bg-secondary/50 transition-all"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
            <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-terminal opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-terminal" />
                </span>
                <span>NETWORK_ACTIVE</span>
              </div>
              <span className="text-terminal">[2,847] AGENTS</span>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
