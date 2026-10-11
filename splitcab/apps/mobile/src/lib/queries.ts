import { ACTIVE_TRIP_STATUSES, type AppConfig, type MessageView, type PaymentView, type ReceiptView, type TripInput, type TripView } from '@splitcab/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const keys = {
  config: ['config'] as const,
  trips: (scope: 'active' | 'past') => ['trips', scope] as const,
  trip: (id: string) => ['trip', id] as const,
  payments: ['payments'] as const,
  messages: (matchId: string) => ['messages', matchId] as const,
  receipt: (tripId: string) => ['receipt', tripId] as const,
};

export const isActive = (t: Pick<TripView, 'status'>) => ACTIVE_TRIP_STATUSES.includes(t.status);

export function useConfig() {
  return useQuery({ queryKey: keys.config, queryFn: () => api.public.get<AppConfig>('/v1/config'), staleTime: 10 * 60_000 });
}

export function useTrips(scope: 'active' | 'past') {
  return useQuery({
    queryKey: keys.trips(scope),
    queryFn: () => api.get<TripView[]>(`/v1/trips?scope=${scope}`),
    // Matches happen on the server; poll while something is in flight. Push notifications cover the rest.
    refetchInterval: (q) => (scope === 'active' && q.state.data?.length ? 5_000 : false),
  });
}

export function useTrip(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.trip(id),
    queryFn: () => api.get<TripView>(`/v1/trips/${id}`),
    initialData: () => qc.getQueryData<TripView[]>(keys.trips('active'))?.find((t) => t.id === id),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data) ? 4_000 : false),
  });
}

export function useReceipt(tripId: string) {
  return useQuery({ queryKey: keys.receipt(tripId), queryFn: () => api.get<ReceiptView>(`/v1/trips/${tripId}/receipt`) });
}

export function usePayments() {
  return useQuery({ queryKey: keys.payments, queryFn: () => api.get<PaymentView[]>('/v1/payments') });
}

export function useMessages(matchId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.messages(matchId),
    queryFn: () => api.get<MessageView[]>(`/v1/matches/${matchId}/messages`),
    enabled,
    refetchInterval: enabled ? 3_000 : false,
  });
}

// Puts a fresh trip view everywhere it appears.
export function useStoreTrip() {
  const qc = useQueryClient();
  return (trip: TripView) => {
    qc.setQueryData(keys.trip(trip.id), trip);
    qc.invalidateQueries({ queryKey: ['trips'] });
    qc.invalidateQueries({ queryKey: keys.payments });
    qc.invalidateQueries({ queryKey: keys.receipt(trip.id) });
  };
}

function useTripMutation<V>(fn: (vars: V) => Promise<TripView>) {
  const store = useStoreTrip();
  return useMutation({ mutationFn: fn, onSuccess: store });
}

export const usePostTrip = () => useTripMutation((input: TripInput) => api.post<TripView>('/v1/trips', input));
export const useConfirmHold = () => useTripMutation((tripId: string) => api.post<TripView>(`/v1/trips/${tripId}/payment-confirmed`));
export const useCancelTrip = () => useTripMutation((tripId: string) => api.post<TripView>(`/v1/trips/${tripId}/cancel`));
export const useRespond = () =>
  useTripMutation(({ matchId, accept }: { matchId: string; accept: boolean }) => api.post<TripView>(`/v1/matches/${matchId}/respond`, { accept }));
export const useComplete = () =>
  useTripMutation(({ matchId, actualFare }: { matchId: string; actualFare: number }) => api.post<TripView>(`/v1/matches/${matchId}/complete`, { actualFare }));
export const useRate = () =>
  useTripMutation(({ matchId, stars }: { matchId: string; stars: number }) => api.post<TripView>(`/v1/matches/${matchId}/rating`, { stars }));
export const useBlock = () => useTripMutation((matchId: string) => api.post<TripView>(`/v1/matches/${matchId}/block`));
export const useMarkPaid = () => useTripMutation((matchId: string) => api.post<TripView>(`/v1/matches/${matchId}/paid`));

export function useSendMessage(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.post<MessageView>(`/v1/matches/${matchId}/messages`, { text }),
    onSuccess: (msg) => {
      qc.setQueryData<MessageView[]>(keys.messages(matchId), (old = []) => (old.some((m) => m.id === msg.id) ? old : [...old, msg]));
    },
  });
}
