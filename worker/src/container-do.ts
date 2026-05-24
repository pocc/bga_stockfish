import { Container } from "@cloudflare/containers";

/**
 * Native-Stockfish-binary container. Class name must match `class_name`
 * in wrangler.toml's [[containers]] block AND its [[durable_objects.bindings]]
 * entry. The Container framework auto-forwards .fetch() calls to the
 * HTTP server inside the container (listening on defaultPort).
 *
 * sleepAfter idle is long-ish because spinning a container back up means
 * paying a cold start (~few seconds) — for a chess bot polling tables on
 * 5s alarms, frequent sleep/wake would dominate latency.
 */
export class StockfishContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "15m";
}
