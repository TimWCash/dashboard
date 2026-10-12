import { CarTaxiFront, Lock, QrCode, ReceiptText, ShieldCheck, Wallet } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Hero } from "@/components/ui/hero-1"
import { FareEstimator } from "@/components/fare-estimator"

// The public demo: the real app in the browser, where two people can match each other.
const DEMO_URL = "https://splitcab-demo.vercel.app"

const steps = [
  {
    image: "/screens/plan-filled.webp",
    alt: "Planning a trip from St Stephen's Green to Dublin Airport, leaving around 10:00, about €30.93 on your own.",
    title: "Tell us where and roughly when",
    text: "Leave around a time, or arrive by one. You see what the taxi would cost on your own.",
  },
  {
    image: "/screens/trip-proposed.webp",
    alt: "A match with Cian: both pickups and the drop-off, a share of €16.42 instead of €30.93 on your own, and Accept or Decline.",
    title: "See your share before you say yes",
    text: "We find someone going your way and show who gets in where, who books, and what you'll each pay.",
  },
  {
    image: "/screens/trip-completed.webp",
    alt: "After the ride: Cian owes you €15.30 of the €31.40 fare, with a QR code for Cian to scan and pay.",
    title: "Split the fare fairly",
    text: "Whoever is picked up first books the taxi. After the ride the other pays their share back, by Revolut or in cash.",
  },
]

const features: { icon: ReactNode; title: string; text: string }[] = [
  {
    icon: <Wallet aria-hidden />,
    title: "Pay less than going alone",
    text: "Each of you pays in proportion to what the trip would cost on your own, and you see your share before you say yes.",
  },
  {
    icon: <ShieldCheck aria-hidden />,
    title: "Safety built in",
    text: "Mobile-verified accounts. Your exact pickup and chat open only after you both accept. Your number is never shown. Block or report anyone from the trip screen.",
  },
  {
    icon: <CarTaxiFront aria-hidden />,
    title: "Book the way you like",
    text: "Uber opens with your pickup and destination filled in. If your partner has their own stop, you add it in Uber. Or use FREENOW, or walk to a rank.",
  },
  {
    icon: <QrCode aria-hidden />,
    title: "Easy to pay back",
    text: "Add your Revtag and your partner pays you through Revolut, or scans your QR code. Cash works too.",
  },
  {
    icon: <ReceiptText aria-hidden />,
    title: "A receipt for both of you",
    text: "The fare, both shares, the match fee and what you saved, ready to save as a PDF.",
  },
  {
    icon: <Lock aria-hidden />,
    title: "Your data, your call",
    text: "No ads and no tracking. Download or delete everything from the app whenever you like.",
  },
]

const faqs = [
  {
    q: "How much does it cost?",
    a: "Your share of the taxi fare, plus a €1.99 match fee. The fee is only charged if you're matched and you both say yes. If your match cancels after that, it's refunded and we look again. If you cancel, it isn't.",
  },
  {
    q: "Who books the taxi?",
    a: "Whoever is picked up first books the taxi in Uber, FREENOW or at a rank, and the app tells them exactly what to book. The other person pays their share back after the ride.",
  },
  {
    q: "Is it safe to share with a stranger?",
    a: "Everyone signs in with a mobile number, but you only ever see a first name and rating. The exact pickup point and chat open only once you've both said yes. Tap Safety on any trip to report or block someone. Reports reach us straight away, and if more than one person reports someone, their account is paused while we look into it. In an emergency, call 112.",
  },
  {
    q: "Where does it work?",
    a: "In the Republic of Ireland. Each share is worked out from the National Transport Authority's taxi fares, which don't apply in Northern Ireland.",
  },
]

function Phone({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`mx-auto w-full max-w-[290px] rounded-[2.4rem] border-[10px] border-[#16181d] bg-[#16181d] shadow-2xl dark:ring-1 dark:ring-white/15 ${className}`}>
      <img src={src} alt={alt} width={780} height={1688} loading="lazy" decoding="async" className="block h-auto w-full rounded-[1.8rem]" />
    </div>
  )
}

export default function App() {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2">
        Skip to content
      </a>

      <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <a href="/" className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight">
            <img src="/icon.png" alt="" width={32} height={32} className="rounded-[9px]" />
            SplitCab
          </a>
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-4">
            <a href="#how" className="hidden rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground sm:inline">
              How it works
            </a>
            <a href="#prices" className="hidden rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground sm:inline">
              Prices
            </a>
            <a href="#faq" className="hidden rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground sm:inline">
              Questions
            </a>
            <a href="/support" className="hidden rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground sm:inline">
              Support
            </a>
            <Button asChild size="sm" className="font-semibold">
              <a href={DEMO_URL}>Try the demo</a>
            </Button>
          </nav>
        </div>
      </header>

      <main id="main">
        <Hero
          eyebrow="Taxi sharing for Ireland"
          eyebrowHref="#how"
          title="Share the taxi. Split the fare."
          subtitle="SplitCab matches you with someone heading the same way at roughly the same time. You share one taxi and each pay less. No match, no charge."
          ctaLabel="Try the live demo"
          ctaHref={DEMO_URL}
          secondaryCta={{ label: "How it works", href: "#how" }}
        >
          <Phone
            src="/screens/trip-confirmed.webp"
            alt="A confirmed shared ride with Cian: you book the taxi, with Uber and FREENOW buttons and both pickup times."
            className="max-w-[320px] [transform:rotateX(14deg)]"
          />
        </Hero>

        <section id="prices" aria-label="Prices" className="scroll-mt-16 border-y border-border bg-card py-8 md:py-12">
          <FareEstimator demoUrl={DEMO_URL} />
        </section>

        <section id="how" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20 md:py-28">
          <h2 id="how-title" className="text-center text-3xl font-semibold tracking-tight md:text-5xl">
            How it works
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-lg text-muted-foreground">Three steps, and the app does the arithmetic.</p>
          <ol className="mt-14 grid gap-14 md:grid-cols-3 md:gap-8">
            {steps.map((s, i) => (
              <li key={s.title} className="flex flex-col items-center text-center">
                <Phone src={s.image} alt={s.alt} className="max-w-[240px]" />
                <span className="mt-8 flex h-9 w-9 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground" aria-hidden>
                  {i + 1}
                </span>
                <h3 className="mt-3 text-xl font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-2 max-w-xs text-muted-foreground">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="why-title" className="border-y border-border bg-card">
          <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
            <h2 id="why-title" className="text-center text-3xl font-semibold tracking-tight md:text-5xl">
              Why share with SplitCab
            </h2>
            <ul className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <li key={f.title}>
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground [&_svg]:h-5 [&_svg]:w-5">
                    {f.icon}
                  </span>
                  <h3 className="mt-4 text-lg font-semibold tracking-tight">{f.title}</h3>
                  <p className="mt-2 text-muted-foreground">{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="fee-title" className="mx-auto max-w-3xl px-6 py-20 text-center md:py-28">
          <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">The only fee</p>
          <h2 id="fee-title" className="mt-3 text-5xl font-semibold tracking-tighter md:text-7xl">€1.99</h2>
          <p className="mx-auto mt-4 max-w-lg text-lg text-muted-foreground">
            Per shared ride, charged only when you're matched and you both accept. Your card is held, not charged, while we look.
          </p>
        </section>

        <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-3xl scroll-mt-20 px-6 pb-20 md:pb-28">
          <h2 id="faq-title" className="text-3xl font-semibold tracking-tight md:text-4xl">
            Questions
          </h2>
          <div className="mt-8 divide-y divide-border border-y border-border">
            {faqs.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span aria-hidden className="text-2xl leading-none text-muted-foreground transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="cta-title" className="px-6 pb-20 md:pb-28">
          <div className="mx-auto max-w-6xl rounded-3xl bg-primary px-6 py-16 text-center text-primary-foreground md:py-20">
            <h2 id="cta-title" className="text-3xl font-semibold tracking-tight md:text-5xl">
              See it for yourself
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg opacity-80">
              Open the demo on two phones and you'll be matched with each other. Nothing is texted or charged.
            </p>
            <Button asChild size="lg" className="mt-8 bg-primary-foreground text-lg font-semibold text-primary hover:bg-primary-foreground/90">
              <a href={DEMO_URL}>Try the live demo</a>
            </Button>
            <p className="mt-6 text-sm opacity-70">Coming to the App Store and Google Play.</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 SplitCab · Run by Tim Cashman</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="/support" className="hover:text-foreground">Support</a>
            <a href="/privacy" className="hover:text-foreground">Privacy</a>
            <a href="/terms" className="hover:text-foreground">Terms</a>
            <a href="/delete-account" className="hover:text-foreground">Delete your account</a>
          </nav>
        </div>
      </footer>
    </>
  )
}
