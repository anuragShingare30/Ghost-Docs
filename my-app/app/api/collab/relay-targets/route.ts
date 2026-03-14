import path from "path";
import { readFile } from "fs/promises";
import { apiSuccess, handleApiError } from "../../../lib/api";

type RelayInfoFile = {
  targets?: string[];
  peerId?: string;
  startedAt?: string;
};

function parseAddressList(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function isLocalhostTarget(target: string) {
  const normalized = target.toLowerCase();
  return (
    normalized.includes("/ip4/127.0.0.1/") ||
    normalized.includes("/dns4/localhost/")
  );
}

async function readLocalRelayTargets() {
  const relayInfoPath = path.join(process.cwd(), ".collab-relay-info.json");

  try {
    const relayInfoRaw = await readFile(relayInfoPath, "utf8");
    const relayInfo = JSON.parse(relayInfoRaw) as RelayInfoFile;
    return relayInfo.targets || [];
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const localRelayTargets = await readLocalRelayTargets();
    const envRelayTargets = parseAddressList(process.env.NEXT_PUBLIC_LIBP2P_RELAYS);
    const envBootstrapTargets = parseAddressList(process.env.NEXT_PUBLIC_LIBP2P_BOOTSTRAP);

    if (localRelayTargets.length > 0) {
      const localhostOnlyTargets = localRelayTargets.filter(isLocalhostTarget);
      const singleTarget =
        localhostOnlyTargets.find((entry) => entry.includes("/ip4/127.0.0.1/")) ||
        localhostOnlyTargets[0] ||
        localRelayTargets[0];

      return apiSuccess({
        targets: singleTarget ? [singleTarget] : [],
        hasLocalRelay: true,
      });
    }

    const targets = unique([
      ...localRelayTargets,
      ...envRelayTargets,
      ...envBootstrapTargets,
    ]);

    return apiSuccess({
      targets,
      hasLocalRelay: localRelayTargets.length > 0,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
