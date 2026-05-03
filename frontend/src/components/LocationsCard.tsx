import "leaflet/dist/leaflet.css";

import { useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import { useLocations } from "../api/hooks";
import { formatEUR } from "../lib/format";

function flagFor(cc: string | null): string {
  if (!cc || cc.length !== 2) return "";
  const base = 0x1f1e6 - "A".charCodeAt(0);
  return String.fromCodePoint(cc.charCodeAt(0) + base, cc.charCodeAt(1) + base);
}

/** Re-fits the map to the supplied bounds whenever they change. */
function FitToBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  if (bounds) {
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12 });
  }
  return null;
}

export default function LocationsCard() {
  const { data, isLoading } = useLocations(365);
  const rows = data ?? [];
  const mapped = rows.filter((r) => r.lat != null && r.lon != null);

  const bounds: LatLngBoundsExpression | null = useMemo(() => {
    if (mapped.length === 0) return null;
    const lats = mapped.map((r) => r.lat as number);
    const lons = mapped.map((r) => r.lon as number);
    return [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    ];
  }, [mapped]);

  const maxVisits = mapped.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  function radiusFor(count: number): number {
    // 6 px (1 visit) → 22 px (max)
    return 6 + Math.round((count / maxVisits) * 16);
  }

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-3">
        <div className="font-medium">Places you shop</div>
        {rows.length > 0 && (
          <div className="text-xs text-subink">last 12 months · {rows.length} places</div>
        )}
      </div>

      {isLoading && <div className="text-xs text-subink py-6">Loading…</div>}

      {!isLoading && rows.length === 0 && (
        <div className="text-xs text-subink py-6">
          No location data yet. KBC exports include merchant cities — re-import a CSV to populate this.
        </div>
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-xl overflow-hidden border border-line bg-white" style={{ height: 360 }}>
            {mapped.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-subink p-6 text-center">
                Map data is still being geocoded. Reload in a moment to see the markers.
              </div>
            ) : (
              <MapContainer
                center={[mapped[0].lat as number, mapped[0].lon as number]}
                zoom={5}
                scrollWheelZoom
                style={{ height: "100%", width: "100%" }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {mapped.map((r) => (
                  <CircleMarker
                    key={`${r.city}-${r.country ?? ""}`}
                    center={[r.lat as number, r.lon as number]}
                    radius={radiusFor(r.count)}
                    pathOptions={{
                      color: "#1E3A5F",
                      weight: 1.5,
                      fillColor: "#1E3A5F",
                      fillOpacity: 0.45,
                    }}
                  >
                    <Popup>
                      <div className="text-xs leading-snug">
                        <div className="font-semibold text-sm">
                          {flagFor(r.country)} {r.city}
                          {r.country ? `, ${r.country}` : ""}
                        </div>
                        <div className="mt-1">
                          <strong>{r.count}</strong> visit{r.count === 1 ? "" : "s"}
                        </div>
                        <div>
                          Total spent: <strong>{formatEUR(-r.total_spent_cents)}</strong>
                        </div>
                        <div className="text-subink mt-1">
                          Last: {new Date(r.last_visit).toLocaleDateString("en-GB")}
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
                <FitToBounds bounds={bounds} />
              </MapContainer>
            )}
          </div>

          <ul className="flex flex-col divide-y divide-line max-h-[360px] overflow-auto">
            {rows.slice(0, 25).map((r) => (
              <li
                key={`${r.city}-${r.country ?? ""}`}
                className="py-2 flex items-center justify-between text-xs gap-2"
              >
                <span className="truncate">
                  <span className="mr-1">{flagFor(r.country)}</span>
                  <span className="font-medium text-ink">{r.city}</span>
                  {r.country && <span className="text-subink ml-1">· {r.country}</span>}
                  {r.lat == null && (
                    <span className="ml-1 text-[10px] text-amber-700">(no map)</span>
                  )}
                </span>
                <span className="tabular-nums text-subink shrink-0">
                  {r.count} · {formatEUR(-r.total_spent_cents)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
