// The HTTP contract between the API and the mobile app. Money is in cents, times are ISO 8601 strings.
import type { Place, TimeMode } from './types';

export type ISODate = string;

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ---- auth & profile -------------------------------------------------------------

export interface OtpStartRequest {
  phone: string;
}
export interface OtpStartResponse {
  phone: string;
  // Only returned by non-production servers using the development code provider.
  devCode?: string;
}
export interface OtpVerifyRequest {
  phone: string;
  code: string;
}
export interface AuthResponse {
  accessToken: string;
  accessTokenExpiresAt: ISODate;
  refreshToken: string;
  user: MeView;
}
export interface RefreshRequest {
  refreshToken: string;
}

export interface PaymentMethodView {
  brand: string;
  last4: string;
}

export interface MeView {
  id: string;
  phone: string;
  firstName: string | null;
  termsAcceptedAt: ISODate | null;
  profileComplete: boolean;
  // They agreed to an earlier version of the Terms and Privacy Policy and need to see the new one.
  termsUpdated: boolean;
  paymentMethod: PaymentMethodView | null;
  ratingAvg: number | null;
  ridesCompleted: number;
  // Revolut username, so travel partners can pay you back on your Revolut page.
  revtag: string | null;
  // Paused while reports about this account are looked into: no new trips, matches or messages.
  paused: boolean;
}

export interface UpdateMeRequest {
  firstName?: string;
  acceptTerms?: true;
  pushToken?: string | null;
  revtag?: string | null;
}

export interface AppConfig {
  currency: string;
  matchFee: number;
  merchantDisplayName: string;
  paymentsMode: 'stripe' | 'test';
  stripePublishableKey: string | null;
  merchantCountryCode: string;
  placesProvider: 'google' | 'builtin';
  termsUrl: string;
  privacyUrl: string;
  supportEmail: string;
  // Set only on the public demo: who runs it, for its privacy notice.
  demo: { operator: string | null } | null;
}

// ---- places ------------------------------------------------------------------------

export interface PlaceSuggestion {
  id: string;
  primary: string;
  secondary: string | null;
}

// ---- payments ----------------------------------------------------------------------

export type PaymentStatus = 'pending' | 'requires_action' | 'authorized' | 'captured' | 'released' | 'refunded' | 'failed';

export interface PaymentSetupResponse {
  mode: 'stripe' | 'test';
  customerId: string | null;
  ephemeralKey: string | null;
  setupIntentClientSecret: string | null;
}

export interface PaymentSummary {
  id: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
}

export interface PaymentView extends PaymentSummary {
  tripId: string;
  trip: { from: string; to: string; time: ISODate };
  history: { status: PaymentStatus; at: ISODate }[];
}

// ---- trips & matches ---------------------------------------------------------------

export type TripStatus = 'pending_payment' | 'searching' | 'proposed' | 'confirmed' | 'completed' | 'expired' | 'cancelled';
export type MatchStatus = 'proposed' | 'confirmed' | 'completed' | 'declined' | 'expired' | 'cancelled';

export const ACTIVE_TRIP_STATUSES: readonly TripStatus[] = ['pending_payment', 'searching', 'proposed', 'confirmed'];

export interface TripInput {
  origin: Place;
  destination: Place;
  timeMode: TimeMode;
  time: ISODate;
  flexMin: number;
  seats: number;
  // The rider asked us to start looking straight away, knowing that once they and their match have both accepted,
  // the service is complete and the match fee is no longer covered by the 14-day right to cancel.
  startNow: true;
}

export interface RiderPlanView {
  soloFare: number;
  share: number;
  fee: number;
  savings: number;
  detourPct: number;
  pickupAt: ISODate;
  dropoffAt: ISODate;
  walkToPickupMin: number;
  walkFromDropMin: number;
}

export interface RouteStopView {
  kind: 'pickup' | 'dropoff';
  you: boolean;
  partner: boolean;
  label: string;
  // Hidden for the partner's stops until both riders have confirmed.
  lat: number | null;
  lng: number | null;
  at: ISODate;
}

export interface SettlementView {
  actualFare: number;
  // Who owes money after the ride: the person who didn't book pays the booker.
  youOwe: number;
  owedToYou: number;
  at: ISODate;
  // When the person who owed money said they'd paid. SplitCab doesn't handle this money itself.
  paidAt: ISODate | null;
  // The booker's Revtag, shown only to the person who owes them.
  bookerRevtag: string | null;
}

// A rider's receipt for a shared ride. Each rider gets their own, showing their side of the split.
export interface ReceiptView {
  number: string;
  issuedAt: ISODate;
  currency: string;
  merchant: { name: string; details: string | null };
  ride: { from: string; to: string; pickupAt: ISODate; dropoffAt: ISODate; partner: string; youBooked: boolean };
  // meterTotal is null when nobody entered the fare; the shares are then the estimates you both accepted.
  fare: { meterTotal: number | null; yourShare: number; partnerShare: number; soloEstimate: number; savings: number };
  matchFee: { amount: number; status: PaymentStatus } | null;
  settleUp: { youOwe: number; owedToYou: number; paidAt: ISODate | null };
}

export interface MatchView {
  id: string;
  status: MatchStatus;
  proposedAt: ISODate;
  expiresAt: ISODate;
  confirmedAt: ISODate | null;
  endedAt: ISODate | null;
  cancelledByPartner: boolean;
  cancelledByMe: boolean;
  youAccepted: boolean;
  partnerAccepted: boolean;
  youBook: boolean;
  youRated: boolean;
  youBlocked: boolean;
  partner: { firstName: string; ratingAvg: number | null; ridesCompleted: number; seats: number };
  plan: {
    startAt: ISODate;
    fare: number;
    totalKm: number;
    totalMin: number;
    savingsPct: number;
    meetUp: boolean;
    you: RiderPlanView;
    partner: { share: number };
    route: RouteStopView[];
  };
  settlement: SettlementView | null;
}

export interface TripView {
  id: string;
  status: TripStatus;
  origin: Place;
  destination: Place;
  timeMode: TimeMode;
  time: ISODate;
  flexMin: number;
  seats: number;
  searchUntil: ISODate;
  soloFare: number;
  createdAt: ISODate;
  payment: PaymentSummary | null;
  // Set when the card issuer needs the rider to authenticate (3-D Secure) before the hold is placed.
  paymentAction: { clientSecret: string } | null;
  match: MatchView | null;
}

export interface RespondRequest {
  accept: boolean;
}

export interface MessageView {
  id: string;
  mine: boolean;
  text: string;
  at: ISODate;
}

export interface SendMessageRequest {
  text: string;
}

export interface CompleteRequest {
  actualFare: number;
}

export interface RatingRequest {
  stars: number;
}

export const REPORT_REASONS = ['no_show', 'unsafe', 'harassment', 'payment', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ReportRequest {
  reason: ReportReason;
  details?: string;
}
