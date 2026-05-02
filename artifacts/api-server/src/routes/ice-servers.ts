import { Router } from "express";

interface MeteredIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const STUN_ONLY: MeteredIceServer[] = [
  { urls: "stun:stun.l.google.com:19302"  },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

const router = Router();

/**
 * GET /api/ice-servers
 *
 * Returns ICE server config for the client to use when building an RTCPeerConnection.
 *
 * If METERED_API_KEY + METERED_APP_NAME are set, fetches short-lived TURN credentials
 * from Metered (https://www.metered.ca) and returns them alongside their STUN servers.
 * Otherwise returns Google STUN only — good for same-network / WiFi calls but
 * unreliable for mobile ↔ mobile across different carriers (symmetric NAT).
 *
 * Sign up free at https://www.metered.ca/stun-turn to get your APP_NAME and API_KEY.
 * Free tier: 50 GB/month TURN bandwidth.
 */
router.get("/ice-servers", async (req, res) => {
  const apiKey  = process.env["METERED_API_KEY"];
  const appName = process.env["METERED_APP_NAME"];

  if (!apiKey || !appName) {
    req.log.info("TURN not configured (METERED_API_KEY / METERED_APP_NAME missing) — returning STUN-only");
    res.json({ iceServers: STUN_ONLY, turnEnabled: false });
    return;
  }

  try {
    const url = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`;
    const upstream = await fetch(url, { signal: AbortSignal.timeout(5_000) });

    if (!upstream.ok) {
      throw new Error(`Metered API returned HTTP ${upstream.status}`);
    }

    const servers = await upstream.json() as MeteredIceServer[];
    req.log.info({ count: servers.length }, "TURN credentials fetched from Metered");
    res.json({ iceServers: servers, turnEnabled: true });
  } catch (err) {
    req.log.warn({ err }, "Failed to fetch TURN credentials — falling back to STUN-only");
    res.json({ iceServers: STUN_ONLY, turnEnabled: false });
  }
});

export default router;
