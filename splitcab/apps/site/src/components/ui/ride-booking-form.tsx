import * as React from "react"
import { domAnimation, LazyMotion, m as motion, MotionConfig, type Variants } from "framer-motion"
import { ArrowRight, Calendar, ChevronDown, Clock, MapPin, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface RideSearch {
  pickup: string
  dropoff: string
  // A local date ("2026-10-13") and either "now" or a time ("18:30").
  date: string
  time: string
}

export interface RideBookingFormProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "onSubmit"> {
  title?: React.ReactNode
  // A short line above the title, e.g. the city.
  city?: string
  cityAction?: { href: string; label: string }
  pickupPlaceholder?: string
  dropoffPlaceholder?: string
  // Place names offered as you type, in both fields.
  suggestions?: string[]
  submitLabel?: string
  secondaryAction?: { href: string; label: string }
  // Shown beside the form on wide screens and under it on narrow ones, e.g. the results.
  aside?: React.ReactNode
  // A decorative picture beside the form, on wide screens only. Ignored when there's an aside.
  imageUrl?: string
  imageAlt?: string
  // How many days ahead can be picked, starting today.
  days?: number
  locale?: string
  onSearch: (details: RideSearch) => void
}

const pad = (n: number) => String(n).padStart(2, "0")
const dayValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`)

function upcomingDays(count: number, locale: string) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    const label =
      i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })
    return { value: dayValue(d), label }
  })
}

// Times still ahead on the chosen day: every half hour, or all of them on a later day.
function timesFor(date: string) {
  const now = new Date()
  if (date !== dayValue(now)) return HALF_HOURS
  const current = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  return HALF_HOURS.filter((t) => t > current)
}

// The next half hour from now, for a later day picked while the time was "now".
function nextHalfHour() {
  const now = new Date()
  return HALF_HOURS.find((t) => t > `${pad(now.getHours())}:${pad(now.getMinutes())}`) ?? "09:00"
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.2 } },
} satisfies Variants

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: "spring", stiffness: 100 } },
} satisfies Variants

const field =
  "flex items-center rounded-lg bg-muted/40 px-4 py-3 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
const select = "w-full cursor-pointer appearance-none bg-transparent pl-3 pr-6 text-foreground focus:outline-none"

export const RideBookingForm = React.forwardRef<HTMLDivElement, RideBookingFormProps>(
  (
    {
      className,
      title = "Where are you going?",
      city,
      cityAction,
      pickupPlaceholder = "Pickup location",
      dropoffPlaceholder = "Drop-off location",
      suggestions,
      submitLabel = "See prices",
      secondaryAction,
      aside,
      imageUrl,
      imageAlt = "",
      days = 7,
      locale = "en-IE",
      onSearch,
      children,
      ...props
    },
    ref,
  ) => {
    const id = React.useId()
    const dates = React.useMemo(() => upcomingDays(days, locale), [days, locale])
    const [pickup, setPickup] = React.useState("")
    const [dropoff, setDropoff] = React.useState("")
    const [date, setDate] = React.useState(dates[0]?.value ?? "")
    const [time, setTime] = React.useState("now")
    const today = dates[0]?.value
    const times = timesFor(date)

    const changeDate = (value: string) => {
      setDate(value)
      // "Now" only makes sense today, and a time that's already passed today falls back to it.
      if (value !== today && time === "now") setTime(nextHalfHour())
      else if (value === today && time !== "now" && !timesFor(value).includes(time)) setTime("now")
    }

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault()
      onSearch({ pickup: pickup.trim(), dropoff: dropoff.trim(), date, time })
    }

    const listId = suggestions?.length ? `${id}-places` : undefined
    const side = aside ?? (imageUrl ? <img src={imageUrl} alt={imageAlt} className="h-full w-full rounded-lg object-cover" /> : null)

    return (
      // Only the basic animations are loaded, which keeps framer-motion small.
      <LazyMotion features={domAnimation} strict>
        <MotionConfig reducedMotion="user">
          <div className={cn("mx-auto w-full max-w-6xl p-4 lg:p-8", className)} ref={ref} {...props}>
            <div className={cn("grid grid-cols-1 items-center gap-8 overflow-hidden rounded-lg", side && "lg:grid-cols-2")}>
              <motion.div className="p-4 sm:p-8" variants={containerVariants} initial="hidden" animate="visible">
                {city ? (
                  <motion.p variants={itemVariants} className="mb-6 text-sm text-muted-foreground">
                    <MapPin className="mr-2 inline-block h-4 w-4" aria-hidden />
                    {city}
                    {cityAction ? (
                      <a href={cityAction.href} className="ml-2 font-medium text-foreground underline-offset-4 hover:underline">
                        {cityAction.label}
                      </a>
                    ) : null}
                  </motion.p>
                ) : null}

                <motion.h2 variants={itemVariants} className="mb-8 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                  {title}
                </motion.h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Pickup and drop-off, joined by a dashed line */}
                  <motion.div variants={itemVariants} className="relative rounded-lg bg-muted/40 p-4">
                    <div className="absolute bottom-9 left-[1.85rem] top-9 border-l border-dashed border-muted-foreground/50" aria-hidden />
                    <label className="relative mb-2 flex items-center rounded-md focus-within:ring-2 focus-within:ring-ring">
                      <span className="z-10 rounded-full border bg-background p-1">
                        <MapPin className="h-4 w-4 text-foreground" aria-hidden />
                      </span>
                      <span className="sr-only">Pickup</span>
                      <input
                        type="text"
                        required
                        autoComplete="off"
                        list={listId}
                        placeholder={pickupPlaceholder}
                        value={pickup}
                        onChange={(e) => setPickup(e.target.value)}
                        className="w-full bg-transparent py-2 pl-4 pr-2 text-foreground placeholder:text-muted-foreground focus:outline-none"
                      />
                    </label>

                    <hr className="mx-12 border-border" />

                    <label className="relative mt-2 flex items-center rounded-md focus-within:ring-2 focus-within:ring-ring">
                      <span className="z-10 rounded-full border bg-background p-1">
                        <Plus className="h-4 w-4 text-foreground" aria-hidden />
                      </span>
                      <span className="sr-only">Drop-off</span>
                      <input
                        type="text"
                        required
                        autoComplete="off"
                        list={listId}
                        placeholder={dropoffPlaceholder}
                        value={dropoff}
                        onChange={(e) => setDropoff(e.target.value)}
                        className="w-full bg-transparent py-2 pl-4 pr-2 text-foreground placeholder:text-muted-foreground focus:outline-none"
                      />
                    </label>
                    {listId ? (
                      <datalist id={listId}>
                        {suggestions?.map((s) => <option key={s} value={s} />)}
                      </datalist>
                    ) : null}
                  </motion.div>

                  {/* When */}
                  <motion.div variants={itemVariants} className="grid grid-cols-2 gap-4">
                    <label className={cn(field, "relative")}>
                      <Calendar className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="sr-only">Date</span>
                      <select value={date} onChange={(e) => changeDate(e.target.value)} className={select}>
                        {dates.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground" aria-hidden />
                    </label>
                    <label className={cn(field, "relative")}>
                      <Clock className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="sr-only">Time</span>
                      <select value={time} onChange={(e) => setTime(e.target.value)} className={select}>
                        {date === today ? <option value="now">Now</option> : null}
                        {times.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground" aria-hidden />
                    </label>
                  </motion.div>

                  <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-4">
                    <Button type="submit" size="lg" className="h-12 px-8 text-base font-semibold">
                      {submitLabel}
                    </Button>
                    {secondaryAction ? (
                      <a href={secondaryAction.href} className="group text-sm text-muted-foreground transition-colors hover:text-foreground">
                        {secondaryAction.label}
                        <ArrowRight className="ml-1 inline-block h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
                      </a>
                    ) : null}
                  </motion.div>
                </form>
                {children}
              </motion.div>

              {side ? (
                <motion.div
                  className={cn("h-full w-full p-4 sm:p-8", !aside && "hidden lg:block")}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                >
                  {side}
                </motion.div>
              ) : null}
            </div>
          </div>
        </MotionConfig>
      </LazyMotion>
    )
  },
)

RideBookingForm.displayName = "RideBookingForm"
