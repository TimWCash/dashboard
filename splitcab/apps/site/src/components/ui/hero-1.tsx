"use client"

import type { ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

interface HeroProps {
  eyebrow?: string
  // Where the eyebrow links to. Without one it's plain text.
  eyebrowHref?: string
  title: string
  subtitle: string
  ctaLabel?: string
  ctaHref?: string
  secondaryCta?: { label: string; href: string }
  // Shown under the buttons and faded into the page, such as a product screenshot.
  children?: ReactNode
}

// Elements that animate in start transparent; anyone who prefers reduced motion sees them straight away.
const enter = "motion-reduce:animate-none motion-reduce:opacity-100 motion-reduce:translate-y-0"

export function Hero({
  eyebrow = "Innovate Without Limits",
  eyebrowHref,
  title,
  subtitle,
  ctaLabel = "Explore Now",
  ctaHref = "#",
  secondaryCta,
  children,
}: HeroProps) {
  const eyebrowPill = eyebrow && (
    <span
      className="text-sm text-muted-foreground mx-auto px-5 py-2
      bg-gradient-to-tr from-zinc-300/5 via-gray-400/5 to-transparent
      border-[2px] border-foreground/10
      rounded-3xl w-fit tracking-tight uppercase flex items-center justify-center"
    >
      {eyebrow}
      {eyebrowHref && (
        <ChevronRight aria-hidden className="inline w-4 h-4 ml-2 transition-transform duration-300 group-hover:translate-x-1" />
      )}
    </span>
  )

  return (
    <section
      id="hero"
      className="relative isolate mx-auto w-full pt-28 md:pt-36 px-6 text-center md:px-8
      overflow-hidden
      bg-[linear-gradient(to_bottom,var(--background),var(--background)_45%,#fff1c2_88%)]
      dark:bg-[linear-gradient(to_bottom,var(--background),var(--background)_35%,#3a3010_80%,#5c4a0f_100%)]
      rounded-b-xl"
    >
      {/* Grid BG */}
      <div
        aria-hidden
        className="absolute -z-10 inset-0 opacity-80 h-[600px] w-full
        bg-[linear-gradient(to_right,var(--grid)_1px,transparent_1px),linear-gradient(to_bottom,var(--grid)_1px,transparent_1px)]
        bg-[size:6rem_5rem]
        [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]"
      />

      {/* Radial Accent */}
      <div
        aria-hidden
        className={`absolute -z-10 left-1/2 top-[calc(100%-90px)] lg:top-[calc(100%-150px)]
        h-[500px] w-[700px] md:h-[500px] md:w-[1100px] lg:h-[750px] lg:w-[140%]
        -translate-x-1/2 rounded-[100%] border-t-2 border-primary/60
        bg-[radial-gradient(closest-side,var(--background)_82%,var(--primary))]
        opacity-0 animate-fade-up ${enter}`}
      />

      {/* Eyebrow */}
      {eyebrowPill &&
        (eyebrowHref ? (
          <a href={eyebrowHref} className="group inline-block rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {eyebrowPill}
          </a>
        ) : (
          eyebrowPill
        ))}

      {/* Title */}
      <h1
        className={`animate-fade-in -translate-y-4 text-balance
        bg-gradient-to-br from-foreground from-30% to-foreground/50
        bg-clip-text py-6 text-5xl font-semibold leading-none tracking-tighter
        text-transparent opacity-0 sm:text-6xl md:text-7xl lg:text-8xl ${enter}`}
      >
        {title}
      </h1>

      {/* Subtitle */}
      <p
        className={`animate-fade-in mx-auto mb-12 max-w-2xl -translate-y-4 text-balance
        text-lg tracking-tight text-muted-foreground
        opacity-0 md:text-xl ${enter}`}
      >
        {subtitle}
      </p>

      {/* CTA */}
      {ctaLabel && (
        <div className="relative z-20 -mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row sm:gap-3">
          <Button asChild size="lg" className="w-fit md:w-56 tracking-tight text-center text-lg font-semibold">
            <a href={ctaHref}>{ctaLabel}</a>
          </Button>
          {secondaryCta && (
            <Button asChild size="lg" variant="ghost" className="w-fit tracking-tight text-lg">
              <a href={secondaryCta.href}>{secondaryCta.label}</a>
            </Button>
          )}
        </div>
      )}

      {/* Bottom Fade: whatever is passed in rises into view and fades into the page below. */}
      <div
        className={`animate-fade-up relative mt-16 md:mt-20 opacity-0 [perspective:2000px]
        after:pointer-events-none after:absolute after:inset-0 after:z-50
        after:[background:linear-gradient(to_top,var(--background)_6%,transparent_40%)] ${enter}`}
      >
        {children}
      </div>
    </section>
  )
}
