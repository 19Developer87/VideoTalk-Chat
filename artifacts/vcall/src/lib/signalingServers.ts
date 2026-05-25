export type SavedSignalingServer = {
  id: string;
  name: string;
  url: string;
};

export type SignalingServerResolution = {
  url: string;
  source: "selected-saved" | "manual" | "env" | "dev-origin" | "local-fallback";
  apkNeedsConfiguration: boolean;
};

const LS_SELECTED_SERVER_ID = "signalingServer:selectedId";
const LS_ACTIVE_SERVER_URL = "signalingServer:activeUrl";
const LS_SAVED_SERVERS = "signalingServer:savedServers";
const FINAL_LOCAL_SIGNALING_URL = "http://10.249.111.188:3000";

export function normalizeSignalingUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isValidSignalingUrl(url: string): boolean {
  const normalized = normalizeSignalingUrl(url);
  return normalized.length > 0 && /^https?:\/\//i.test(normalized);
}

export function defaultServerName(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host || url;
  } catch {
    return url.replace(/^https?:\/\//i, "") || "Signaling Server";
  }
}

export function getSavedSignalingServers(): SavedSignalingServer[] {
  try {
    const raw = localStorage.getItem(LS_SAVED_SERVERS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<SavedSignalingServer>[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : "",
        name: typeof item.name === "string" ? item.name : "",
        url: typeof item.url === "string" ? normalizeSignalingUrl(item.url) : "",
      }))
      .filter((item) => item.id && item.name && isValidSignalingUrl(item.url));
  } catch {
    return [];
  }
}

export function saveSignalingServers(servers: SavedSignalingServer[]): void {
  localStorage.setItem(LS_SAVED_SERVERS, JSON.stringify(servers));
}

export function getSelectedSignalingServerId(): string {
  return localStorage.getItem(LS_SELECTED_SERVER_ID) ?? "";
}

export function setSelectedSignalingServerId(id: string): void {
  if (id) {
    localStorage.setItem(LS_SELECTED_SERVER_ID, id);
  } else {
    localStorage.removeItem(LS_SELECTED_SERVER_ID);
  }
}

export function getManualSignalingServerUrl(): string {
  const raw = localStorage.getItem(LS_ACTIVE_SERVER_URL) ?? "";
  return normalizeSignalingUrl(raw);
}

export function setManualSignalingServerUrl(url: string): void {
  const normalized = normalizeSignalingUrl(url);
  if (normalized) {
    localStorage.setItem(LS_ACTIVE_SERVER_URL, normalized);
  } else {
    localStorage.removeItem(LS_ACTIVE_SERVER_URL);
  }
}

export function upsertSavedSignalingServer(url: string, name?: string): SavedSignalingServer {
  const normalized = normalizeSignalingUrl(url);
  const servers = getSavedSignalingServers();
  const existing = servers.find((server) => server.url === normalized);
  if (existing) {
    if (name?.trim()) existing.name = name.trim();
    saveSignalingServers(servers);
    return existing;
  }

  const server: SavedSignalingServer = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name?.trim() || defaultServerName(normalized),
    url: normalized,
  };
  servers.push(server);
  saveSignalingServers(servers);
  return server;
}

export function renameSavedSignalingServer(id: string, name: string): SavedSignalingServer[] {
  const servers = getSavedSignalingServers().map((server) =>
    server.id === id ? { ...server, name: name.trim() || defaultServerName(server.url) } : server,
  );
  saveSignalingServers(servers);
  return servers;
}

export function removeSavedSignalingServer(id: string): SavedSignalingServer[] {
  const selectedId = getSelectedSignalingServerId();
  const servers = getSavedSignalingServers().filter((server) => server.id !== id);
  saveSignalingServers(servers);
  if (selectedId === id) {
    setSelectedSignalingServerId("");
  }
  return servers;
}

export function getEnvSignalingUrl(): string {
  return normalizeSignalingUrl((import.meta.env.VITE_SIGNALING_URL as string | undefined) ?? "");
}

export function isAndroidApkLocation(): boolean {
  return window.location.protocol === "capacitor:" || window.location.origin === "https://localhost";
}

function getAutomaticDevOriginUrl(): string {
  const { protocol, hostname, port } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:3000`;
  }
  if (port === "5173") {
    return `${protocol}//${hostname}:3000`;
  }
  return "";
}

export function resolveSignalingServerUrl(): SignalingServerResolution {
  const saved = getSavedSignalingServers();
  const selected = saved.find((server) => server.id === getSelectedSignalingServerId());
  if (selected && isValidSignalingUrl(selected.url)) {
    return { url: selected.url, source: "selected-saved", apkNeedsConfiguration: false };
  }

  const manual = getManualSignalingServerUrl();
  if (isValidSignalingUrl(manual)) {
    return { url: manual, source: "manual", apkNeedsConfiguration: false };
  }

  const envUrl = getEnvSignalingUrl();
  if (isValidSignalingUrl(envUrl)) {
    return { url: envUrl, source: "env", apkNeedsConfiguration: false };
  }

  if (!isAndroidApkLocation()) {
    const devOriginUrl = getAutomaticDevOriginUrl();
    if (isValidSignalingUrl(devOriginUrl)) {
      return { url: devOriginUrl, source: "dev-origin", apkNeedsConfiguration: false };
    }
  }

  return {
    url: FINAL_LOCAL_SIGNALING_URL,
    source: "local-fallback",
    apkNeedsConfiguration: isAndroidApkLocation(),
  };
}

export function getSignalingStorageSnapshot() {
  const servers = getSavedSignalingServers();
  const selectedId = getSelectedSignalingServerId();
  const selected = servers.find((server) => server.id === selectedId) ?? null;
  const manualUrl = getManualSignalingServerUrl();
  const resolved = resolveSignalingServerUrl();
  return { servers, selectedId, selected, manualUrl, resolved };
}
