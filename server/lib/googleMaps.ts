import { GOOGLE_MAPS_SERVER_KEY } from "../../lib/mapsConfig";
const GOOGLE_MAPS_KEY = GOOGLE_MAPS_SERVER_KEY;

const GOOGLE_API_BASE = "https://maps.googleapis.com/maps/api";

const directionsMetrics = {
  startedAt: Date.now(),
  etaCalls: 0,
  etaCacheHits: 0,
  buildRouteCalls: 0,
  buildRouteCacheHits: 0,
  recomputeRequests: 0,
  recomputeThrottled: 0,
  trackingRequests: 0,
};

const ROLLING_WINDOW_MS = 60_000;
const rollingCallTimestamps: number[] = [];

function pruneRollingWindow() {
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  while (rollingCallTimestamps.length > 0 && rollingCallTimestamps[0] < cutoff) {
    rollingCallTimestamps.shift();
  }
}

function recordDirectionsCall(reason?: string, tripId?: number) {
  pruneRollingWindow();
  rollingCallTimestamps.push(Date.now());
  if (process.env.NODE_ENV !== "production") {
    console.debug("[UCM] Directions call", { tripId: tripId ?? null, reason: reason ?? "unknown", ts: Date.now() });
  }
}

export function getDirectionsCallsLast60s(): number {
  pruneRollingWindow();
  return rollingCallTimestamps.length;
}

export function getDirectionsMetrics() {
  pruneRollingWindow();
  const uptimeMs = Date.now() - directionsMetrics.startedAt;
  const uptimeMin = Math.max(1, uptimeMs / 60_000);
  return {
    directions_calls_per_min: Math.round(((directionsMetrics.etaCalls + directionsMetrics.buildRouteCalls) / uptimeMin) * 100) / 100,
    directions_calls_last_60s: rollingCallTimestamps.length,
    eta_calls_total: directionsMetrics.etaCalls,
    eta_cache_hits: directionsMetrics.etaCacheHits,
    build_route_calls_total: directionsMetrics.buildRouteCalls,
    build_route_cache_hits: directionsMetrics.buildRouteCacheHits,
    recompute_requests_total: directionsMetrics.recomputeRequests,
    recompute_blocked_by_throttle: directionsMetrics.recomputeThrottled,
    tracking_requests_total: directionsMetrics.trackingRequests,
    tracking_requests_per_min: Math.round((directionsMetrics.trackingRequests / uptimeMin) * 100) / 100,
    uptime_minutes: Math.round(uptimeMin * 10) / 10,
  };
}

export function incrDirectionsMetric(key: keyof typeof directionsMetrics, reason?: string, tripId?: number) {
  if (key !== "startedAt") (directionsMetrics as any)[key]++;
  if (key === "etaCalls" || key === "buildRouteCalls") {
    recordDirectionsCall(reason ?? key, tripId);
  }
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private ttlMs: number;

  constructor(ttlSeconds: number) {
    this.ttlMs = ttlSeconds * 1000;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set(key: string, data: T): void {
    if (this.store.size > 5000) {
      const now = Date.now();
      const keysToDelete: string[] = [];
      this.store.forEach((v, k) => {
        if (now > v.expiresAt) keysToDelete.push(k);
      });
      keysToDelete.forEach((k) => this.store.delete(k));
      if (this.store.size > 5000) {
        const oldest = this.store.keys().next().value;
        if (oldest) this.store.delete(oldest);
      }
    }
    this.store.set(key, { data, expiresAt: Date.now() + this.ttlMs });
  }
}

const geocodeCache = new TTLCache<GeocodeResult>(30 * 24 * 3600);
const autocompleteCache = new TTLCache<AutocompleteResult[]>(600);
const etaCache = new TTLCache<ETAResult>(60);
const routeCache = new TTLCache<RouteResult>(90);
const distanceMatrixCache = new TTLCache<DistanceMatrixResult>(60);

export interface GeocodeResult {
  formattedAddress: string;
  lat: number;
  lng: number;
}

export interface AutocompleteResult {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PlaceDetailsResult {
  formattedAddress: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
}

export interface ETAResult {
  minutes: number;
  distanceMiles: number;
  usedTraffic: boolean;
}

export interface RouteLeg {
  startAddress: string;
  endAddress: string;
  distanceMiles: number;
  durationMinutes: number;
}

export interface RouteResult {
  polyline: string;
  legs: RouteLeg[];
  totalMinutes: number;
  totalMiles: number;
}

type LatLng = { lat: number; lng: number };
type LocationInput = LatLng | string;

function locationToString(loc: LocationInput): string {
  if (typeof loc === "string") return loc;
  return `${loc.lat},${loc.lng}`;
}

function cacheKey(...parts: string[]): string {
  return parts.map((p) => p.trim().toLowerCase()).join("|");
}

async function googleFetch(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Maps API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const key = cacheKey("geo", address);
  const cached = geocodeCache.get(key);
  if (cached) return cached;

  const url = `${GOOGLE_API_BASE}/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_KEY}`;
  const data = await googleFetch(url);

  if (data.status !== "OK" || !data.results?.length) {
    throw new Error(`Geocode failed: ${data.status} - ${data.error_message || "No results found"}`);
  }

  const r = data.results[0];
  const result: GeocodeResult = {
    formattedAddress: r.formatted_address,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
  };

  geocodeCache.set(key, result);
  return result;
}

export async function placesAutocomplete(input: string): Promise<AutocompleteResult[]> {
  const key = cacheKey("ac", input);
  const cached = autocompleteCache.get(key);
  if (cached) return cached;

  const url = `${GOOGLE_API_BASE}/place/autocomplete/json?input=${encodeURIComponent(input)}&types=address&key=${GOOGLE_MAPS_KEY}`;
  const data = await googleFetch(url);

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Places autocomplete failed: ${data.status} - ${data.error_message || ""}`);
  }

  const results: AutocompleteResult[] = (data.predictions || []).map((p: any) => ({
    placeId: p.place_id,
    description: p.description,
    mainText: p.structured_formatting?.main_text || "",
    secondaryText: p.structured_formatting?.secondary_text || "",
  }));

  autocompleteCache.set(key, results);
  return results;
}

const placeDetailsCache = new TTLCache<PlaceDetailsResult>(30 * 24 * 3600);

export async function placeDetails(placeId: string): Promise<PlaceDetailsResult> {
  const key = cacheKey("pd", placeId);
  const cached = placeDetailsCache.get(key);
  if (cached) return cached;

  const url =
    `${GOOGLE_API_BASE}/place/details/json` +
    `?place_id=${encodeURIComponent(placeId)}` +
    `&fields=formatted_address,geometry,address_components` +
    `&key=${GOOGLE_MAPS_KEY}`;

  const data = await googleFetch(url);

  if (data.status !== "OK" || !data.result) {
    throw new Error(`Place details failed: ${data.status} - ${data.error_message || ""}`);
  }

  const r = data.result;
  const components = r.address_components || [];

  function getComponent(type: string): string {
    const c = components.find((c: any) => c.types?.includes(type));
    return c?.long_name || "";
  }
  function getShort(type: string): string {
    const c = components.find((c: any) => c.types?.includes(type));
    return c?.short_name || "";
  }

  const streetNumber = getComponent("street_number");
  const route = getShort("route");
  const street = streetNumber ? `${streetNumber} ${route}` : route;

  const result: PlaceDetailsResult = {
    formattedAddress: r.formatted_address || "",
    street,
    city: getComponent("locality") || getComponent("sublocality_level_1") || getComponent("administrative_area_level_2") || "",
    state: getShort("administrative_area_level_1"),
    zip: getComponent("postal_code"),
    lat: r.geometry?.location?.lat || 0,
    lng: r.geometry?.location?.lng || 0,
  };

  placeDetailsCache.set(key, result);
  return result;
}

export async function etaMinutes(
  origin: LocationInput,
  destination: LocationInput
): Promise<ETAResult> {
  const originStr = locationToString(origin);
  const destStr = locationToString(destination);
  const key = cacheKey("eta", originStr, destStr);
  const cached = etaCache.get(key);
  if (cached) {
    directionsMetrics.etaCacheHits++;
    return cached;
  }
  directionsMetrics.etaCalls++;

  const url =
    `${GOOGLE_API_BASE}/directions/json` +
    `?origin=${encodeURIComponent(originStr)}` +
    `&destination=${encodeURIComponent(destStr)}` +
    `&departure_time=now` +
    `&traffic_model=best_guess` +
    `&key=${GOOGLE_MAPS_KEY}`;

  const data = await googleFetch(url);

  if (data.status !== "OK" || !data.routes?.length) {
    throw new Error(`ETA failed: ${data.status} - ${data.error_message || "No route found"}`);
  }

  const leg = data.routes[0].legs[0];
  const durationSec = leg.duration_in_traffic?.value ?? leg.duration.value;
  const distanceMeters = leg.distance.value;

  const result: ETAResult = {
    minutes: Math.round(durationSec / 60),
    distanceMiles: Math.round((distanceMeters / 1609.344) * 10) / 10,
    usedTraffic: !!leg.duration_in_traffic,
  };

  etaCache.set(key, result);
  return result;
}

export async function buildRoute(
  origin: LocationInput,
  destination: LocationInput,
  waypoints?: LocationInput[]
): Promise<RouteResult> {
  const originStr = locationToString(origin);
  const destStr = locationToString(destination);
  const wpStrs = (waypoints || []).map(locationToString);
  const key = cacheKey("route", originStr, destStr, ...wpStrs);
  const cached = routeCache.get(key);
  if (cached) {
    directionsMetrics.buildRouteCacheHits++;
    return cached;
  }
  directionsMetrics.buildRouteCalls++;

  let url =
    `${GOOGLE_API_BASE}/directions/json` +
    `?origin=${encodeURIComponent(originStr)}` +
    `&destination=${encodeURIComponent(destStr)}` +
    `&departure_time=now` +
    `&traffic_model=best_guess` +
    `&key=${GOOGLE_MAPS_KEY}`;

  if (wpStrs.length > 0) {
    url += `&waypoints=optimize:true|${wpStrs.map(encodeURIComponent).join("|")}`;
  }

  const data = await googleFetch(url);

  if (data.status !== "OK" || !data.routes?.length) {
    throw new Error(`Route failed: ${data.status} - ${data.error_message || "No route found"}`);
  }

  const route = data.routes[0];
  const legs: RouteLeg[] = route.legs.map((leg: any) => ({
    startAddress: leg.start_address,
    endAddress: leg.end_address,
    distanceMiles: Math.round((leg.distance.value / 1609.344) * 10) / 10,
    durationMinutes: Math.round(
      (leg.duration_in_traffic?.value ?? leg.duration.value) / 60
    ),
  }));

  const totalMinutes = legs.reduce((s, l) => s + l.durationMinutes, 0);
  const totalMiles = legs.reduce((s, l) => s + l.distanceMiles, 0);

  const result: RouteResult = {
    polyline: route.overview_polyline?.points || "",
    legs,
    totalMinutes,
    totalMiles: Math.round(totalMiles * 10) / 10,
  };

  routeCache.set(key, result);
  return result;
}

export interface DistanceMatrixElement {
  durationSeconds: number;
  distanceMeters: number;
  status: string;
}

export interface DistanceMatrixResult {
  elements: DistanceMatrixElement[];
}

let distanceMatrixAvailable = true;

export async function googleDistanceMatrix(
  origin: { lat: number; lng: number },
  destinations: { lat: number; lng: number }[]
): Promise<DistanceMatrixResult> {
  if (!GOOGLE_MAPS_KEY) {
    throw new Error("[DistanceMatrix] GOOGLE_MAPS_API_KEY not configured");
  }
  if (destinations.length === 0) {
    return { elements: [] };
  }

  const originStr = `${origin.lat},${origin.lng}`;
  const destStrs = destinations.map(d => `${d.lat},${d.lng}`);
  const key = cacheKey("dm", originStr, ...destStrs);
  const cached = distanceMatrixCache.get(key);
  if (cached) return cached;

  if (!distanceMatrixAvailable) {
    return fallbackDirectionsEta(origin, destinations);
  }

  const destParam = destStrs.join("|");
  const url =
    `${GOOGLE_API_BASE}/distancematrix/json` +
    `?origins=${encodeURIComponent(originStr)}` +
    `&destinations=${encodeURIComponent(destParam)}` +
    `&mode=driving&units=imperial` +
    `&departure_time=now` +
    `&key=${GOOGLE_MAPS_KEY}`;

  let data: any;
  try {
    data = await googleFetch(url);
  } catch (err: any) {
    console.warn(`[DistanceMatrix] First attempt failed: ${err.message}. Retrying...`);
    try {
      await new Promise(r => setTimeout(r, 500));
      data = await googleFetch(url);
    } catch (retryErr: any) {
      console.error(`[DistanceMatrix] Retry also failed, falling back to Directions API`);
      return fallbackDirectionsEta(origin, destinations);
    }
  }

  if (data.status === "REQUEST_DENIED") {
    console.warn(`[DistanceMatrix] API key denied for Distance Matrix. Falling back to Directions API for all future requests.`);
    distanceMatrixAvailable = false;
    return fallbackDirectionsEta(origin, destinations);
  }

  if (data.status !== "OK") {
    console.warn(`[DistanceMatrix] API error: ${data.status}. Falling back to Directions API.`);
    return fallbackDirectionsEta(origin, destinations);
  }

  const row = data.rows?.[0];
  if (!row || !row.elements) {
    return fallbackDirectionsEta(origin, destinations);
  }

  const elements: DistanceMatrixElement[] = row.elements.map((el: any) => ({
    durationSeconds: el.status === "OK" ? (el.duration_in_traffic?.value ?? el.duration?.value ?? 0) : -1,
    distanceMeters: el.status === "OK" ? (el.distance?.value ?? 0) : -1,
    status: el.status,
  }));

  const result: DistanceMatrixResult = { elements };
  distanceMatrixCache.set(key, result);
  return result;
}

function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fallbackDirectionsEta(
  origin: { lat: number; lng: number },
  destinations: { lat: number; lng: number }[]
): Promise<DistanceMatrixResult> {
  const elements: DistanceMatrixElement[] = [];
  for (const dest of destinations) {
    try {
      const eta = await etaMinutes(origin, dest);
      elements.push({
        durationSeconds: eta.minutes * 60,
        distanceMeters: Math.round(eta.distanceMiles * 1609.344),
        status: "OK",
      });
    } catch {
      const distMeters = haversineDistanceMeters(origin.lat, origin.lng, dest.lat, dest.lng);
      const distMiles = distMeters / 1609.344;
      const etaSeconds = Math.round((distMiles / 25) * 3600);
      elements.push({ durationSeconds: etaSeconds, distanceMeters: Math.round(distMeters), status: "OK" });
    }
  }
  const result: DistanceMatrixResult = { elements };
  distanceMatrixCache.set(
    cacheKey("dm", `${origin.lat},${origin.lng}`, ...destinations.map(d => `${d.lat},${d.lng}`)),
    result
  );
  return result;
}

export interface StaticMapUrls {
  thumbUrl: string;
  fullUrl: string;
}

export function buildStaticMapUrls(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
): StaticMapUrls | null {
  if (!GOOGLE_MAPS_KEY) return null;

  const markers = [
    `markers=color:green|label:A|${pickupLat},${pickupLng}`,
    `markers=color:red|label:B|${dropoffLat},${dropoffLng}`,
  ].join("&");

  const path = `path=weight:3|color:0x4285F4|${pickupLat},${pickupLng}|${dropoffLat},${dropoffLng}`;

  const base = `https://maps.googleapis.com/maps/api/staticmap`;

  const thumbUrl = `${base}?size=320x160&${markers}&${path}&key=${GOOGLE_MAPS_KEY}`;
  const fullUrl = `${base}?size=640x320&scale=2&${markers}&${path}&key=${GOOGLE_MAPS_KEY}`;

  return { thumbUrl, fullUrl };
}
