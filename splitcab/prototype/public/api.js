import { TripService, ServiceError, createState } from './core/service.js';
import { seedDemo, addNearbyTraveler } from './core/demo.js';

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Storage can be unavailable (private mode, previews). The app still works for this visit.
    }
  },
};

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Talks to server.js, so travelers on different devices can match each other.
class RemoteApi {
  mode = 'server';

  constructor(demo) {
    this.demo = demo;
    this.riderId = store.get('splitcab.server.rider');
  }

  async call(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(this.riderId ? { 'x-rider-id': this.riderId } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error ?? 'Something went wrong.', res.status);
    return data;
  }

  async register(name) {
    const { riderId, view } = await this.call('POST', 'api/riders', { name });
    this.riderId = riderId;
    store.set('splitcab.server.rider', riderId);
    return view;
  }

  me() {
    return this.call('GET', 'api/me');
  }
  postTrip(input) {
    return this.call('POST', 'api/trips', input);
  }
  cancelTrip(tripId) {
    return this.call('POST', `api/trips/${tripId}/cancel`);
  }
  addNearbyTraveler(tripId) {
    return this.call('POST', `api/trips/${tripId}/demo-traveler`);
  }
  respond(matchId, accept) {
    return this.call('POST', `api/matches/${matchId}/respond`, { accept });
  }
  sendMessage(matchId, text) {
    return this.call('POST', `api/matches/${matchId}/messages`, { text });
  }
  complete(matchId, actualFare) {
    return this.call('POST', `api/matches/${matchId}/complete`, { actualFare });
  }
  signOut() {
    this.riderId = null;
    store.set('splitcab.server.rider', null);
  }
}

// Runs the same service entirely in this browser with simulated travelers. Used when no server is present.
class LocalApi {
  mode = 'local';
  demo = true;

  constructor() {
    let state = null;
    try {
      state = JSON.parse(store.get('splitcab.local.state'));
    } catch {
      state = null;
    }
    this.service = new TripService(state ?? createState());
    if (!state) seedDemo(this.service, Date.now());
    this.riderId = store.get('splitcab.local.rider');
    if (this.riderId && !this.service.state.riders[this.riderId]) this.riderId = null;
    this.save();
    setInterval(() => {
      if (this.service.tick(Date.now())) this.save();
    }, 1000);
  }

  save() {
    store.set('splitcab.local.state', JSON.stringify(this.service.state));
    store.set('splitcab.local.rider', this.riderId);
  }

  async run(fn) {
    try {
      const now = Date.now();
      fn(now);
      this.save();
      return this.service.viewFor(this.riderId, now);
    } catch (err) {
      if (err instanceof ServiceError) throw new ApiError(err.message, err.status);
      throw err;
    }
  }

  register(name) {
    return this.run((now) => {
      this.riderId = this.service.createRider({ name }, now).id;
    });
  }
  me() {
    return this.run(() => {});
  }
  postTrip(input) {
    return this.run((now) => this.service.postTrip(this.riderId, input, now));
  }
  cancelTrip(tripId) {
    return this.run((now) => this.service.cancelTrip(this.riderId, tripId, now));
  }
  addNearbyTraveler(tripId) {
    return this.run((now) => addNearbyTraveler(this.service, this.service.ownTrip(this.riderId, tripId), now));
  }
  respond(matchId, accept) {
    return this.run((now) => this.service.respond(this.riderId, matchId, accept, now));
  }
  sendMessage(matchId, text) {
    return this.run((now) => this.service.sendMessage(this.riderId, matchId, text, now));
  }
  complete(matchId, actualFare) {
    return this.run((now) => this.service.completeMatch(this.riderId, matchId, actualFare, now));
  }
  signOut() {
    this.riderId = null;
    this.save();
  }

  // Demo-only: play both sides on one device.
  travelers() {
    return Object.values(this.service.state.riders).filter((r) => !r.simulated);
  }
  switchTo(riderId) {
    this.riderId = riderId;
    this.save();
  }
  reset() {
    store.set('splitcab.local.state', null);
    store.set('splitcab.local.rider', null);
    location.reload();
  }
}

export async function connect() {
  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    if (res.ok) {
      const { demo } = await res.json();
      return new RemoteApi(Boolean(demo));
    }
  } catch {
    // No server: fall through to the in-browser demo.
  }
  return new LocalApi();
}
