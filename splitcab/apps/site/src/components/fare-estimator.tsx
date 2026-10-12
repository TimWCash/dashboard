import { CONFIG, formatMoney, irishTime, PLACES, sameTripQuote, searchKnownPlaces, type KnownPlace, type SameTripQuote } from "@splitcab/core"
import { useState } from "react"
import { RideBookingForm, type RideSearch } from "@/components/ui/ride-booking-form"
import { cn } from "@/lib/utils"

type Estimate =
  | { ok: true; example: boolean; from: KnownPlace; to: KnownPlace; at: number; now: boolean; quote: SameTripQuote }
  | { ok: false; message: string }

const fold = (s: string) => s.trim().toLowerCase()

// The place someone typed: an exact name from the list, or the best match for what they wrote.
function findPlace(query: string): KnownPlace | undefined {
  if (!query.trim()) return undefined
  return PLACES.find((p) => fold(p.label) === fold(query)) ?? searchKnownPlaces(query, 1)[0]
}

function estimate({ pickup, dropoff, date, time }: RideSearch, example = false): Estimate {
  if (!pickup.trim() || !dropoff.trim()) return { ok: false, message: "Enter a pickup and a drop-off." }
  const from = findPlace(pickup)
  const to = findPlace(dropoff)
  const unknown = !from ? pickup : !to ? dropoff : null
  if (unknown !== null || !from || !to) {
    return { ok: false, message: `We don't have "${unknown}" yet. Pick a place from the list, like Heuston Station or Dublin Airport.` }
  }
  if (from.id === to.id) return { ok: false, message: "The pickup and drop-off are the same place." }
  const now = time === "now"
  const at = now ? Date.now() : irishTime(date, time)
  return { ok: true, example, from, to, at, now, quote: sameTripQuote(from, to, at) }
}

const whenFormat = new Intl.DateTimeFormat(CONFIG.locale, { timeZone: CONFIG.timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

function Row({ label, value, note, strong, good }: { label: string; value: string; note?: string; strong?: boolean; good?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">
        {label}
        {note ? <span className="block text-xs">{note}</span> : null}
      </dt>
      <dd className={cn("tabular-nums", strong && "text-3xl font-bold text-foreground", good && "font-semibold text-emerald-700 dark:text-emerald-400")}>{value}</dd>
    </div>
  )
}

function Result({ result }: { result: Estimate }) {
  if (!result.ok) {
    return (
      <div role="status" className="rounded-2xl border border-border bg-background p-6 text-foreground">
        {result.message}
      </div>
    )
  }
  const { quote: q, from, to } = result
  const when = result.now ? "leaving now" : `leaving ${whenFormat.format(result.at)}`
  return (
    <div role="status" className="rounded-2xl border border-border bg-background p-6 shadow-sm sm:p-8">
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{result.example ? "For example" : "Your estimate"}</p>
      <p className="mt-2 text-lg font-semibold leading-snug">
        {from.label} → {to.label}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        About {q.km.toFixed(1)} km and {Math.round(q.minutes)} minutes, {when} ({q.tariffLabel})
      </p>
      <dl className="mt-6 space-y-4">
        <Row label="On your own" value={formatMoney(q.fare)} />
        <Row label="Your share, shared" value={formatMoney(q.share)} strong />
        <Row label="Match fee" note="Only if you're matched and both say yes" value={formatMoney(q.matchFee)} />
        <div className="border-t border-border pt-4">
          {q.savings > 0 ? (
            <Row label="You save" value={formatMoney(q.savings)} good />
          ) : (
            <p className="text-sm text-muted-foreground">On a trip this short, the match fee is more than you'd save.</p>
          )}
        </div>
      </dl>
      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        At the National Transport Authority's maximum taxi fares, sharing with someone making the same trip. A travel partner with a
        different stop adds a little to your share; the app shows the exact amount before you say yes.
      </p>
    </div>
  )
}

const EXAMPLE: RideSearch = { pickup: "St Stephen's Green", dropoff: "Dublin Airport T1 (taxi rank)", date: "", time: "now" }

export function FareEstimator({ demoUrl }: { demoUrl: string }) {
  const [result, setResult] = useState<Estimate>(() => estimate(EXAMPLE, true))
  return (
    <RideBookingForm
      title="See what you'd pay"
      city="Ireland, at the NTA's maximum taxi fares"
      pickupPlaceholder="Pickup, e.g. Heuston Station"
      dropoffPlaceholder="Drop-off, e.g. Dublin Airport"
      suggestions={PLACES.map((p) => p.label)}
      submitLabel="See prices"
      secondaryAction={{ href: demoUrl, label: "Try the whole trip in the demo" }}
      aside={<Result result={result} />}
      onSearch={(details) => setResult(estimate(details))}
    />
  )
}
