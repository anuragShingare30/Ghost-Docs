"use client";

type RelayDialAttempt = {
  target: string;
  source: "initial-prime" | "retry-prime" | "peer-discovery";
  success: boolean;
  timestamp: number;
  error?: string;
};

type CollaborationDiagnosticsData = {
  lastIdentityVerify: {
    peerId: string;
    ghostId: string;
    valid: boolean;
    role?: string;
    reason?: string;
    timestamp: number;
  } | null;
  lastPeerDiscoveryAt: number | null;
  relayDial: {
    attempted: number;
    succeeded: number;
    failed: number;
    lastAttemptAt: number | null;
    lastTarget: string | null;
    lastError: string | null;
    recentAttempts: RelayDialAttempt[];
  };
  realtimeCrdt: {
    crdtSent: number;
    crdtReceived: number;
    decryptFailures: number;
    lastCrdtSentAt: number | null;
    lastCrdtReceivedAt: number | null;
    lastDecryptFailureAt: number | null;
    lastDecryptFailureReason: string | null;
  };
  runtimeRollout: {
    mode: "legacy" | "compare" | "runtime";
    runtimeSnapshots: number;
    runtimeDialAttempts: number;
    runtimeConnectionCount: number;
    legacyConnectionCount: number;
    lastRuntimeSnapshotAt: number | null;
  };
};

type CollaborationDiagnosticsProps = {
  diagnostics: CollaborationDiagnosticsData;
};

function formatTimestamp(value: number | null) {
  if (!value) {
    return "never";
  }
  return new Date(value).toLocaleTimeString();
}

function shortPeerId(peerId: string) {
  if (peerId.length <= 18) {
    return peerId;
  }
  return `${peerId.slice(0, 10)}...${peerId.slice(-6)}`;
}

export default function CollaborationDiagnostics({
  diagnostics,
}: CollaborationDiagnosticsProps) {
  const attempts = diagnostics.relayDial.recentAttempts.slice(-5).reverse();
  const localhostDialFailure = attempts.some(
    (attempt) =>
      !attempt.success &&
      (attempt.target.includes("/ip4/127.0.0.1/") ||
        attempt.target.includes("/dns4/localhost/"))
  );

  return (
    <div className="mt-4 rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
      <p className="text-xs uppercase tracking-wider text-neutral-400">
        Collaboration diagnostics
      </p>

      <div className="mt-2 grid gap-2 text-xs text-neutral-300 md:grid-cols-3">
        <p>
          Last identity verify: {diagnostics.lastIdentityVerify?.valid
            ? "valid"
            : diagnostics.lastIdentityVerify
            ? "invalid"
            : "none"}
        </p>
        <p>
          Verified peer: {diagnostics.lastIdentityVerify
            ? shortPeerId(diagnostics.lastIdentityVerify.peerId)
            : "n/a"}
        </p>
        <p>
          Verify time: {formatTimestamp(diagnostics.lastIdentityVerify?.timestamp || null)}
        </p>
        <p>
          Verify role: {diagnostics.lastIdentityVerify?.role || "n/a"}
        </p>
        <p>
          Verify reason: {diagnostics.lastIdentityVerify?.reason || "n/a"}
        </p>
        <p>
          Last peer discovery: {formatTimestamp(diagnostics.lastPeerDiscoveryAt)}
        </p>
        <p>Relay dial attempts: {diagnostics.relayDial.attempted}</p>
        <p>Relay dial success: {diagnostics.relayDial.succeeded}</p>
        <p>Relay dial failed: {diagnostics.relayDial.failed}</p>
        <p>Last dial target: {diagnostics.relayDial.lastTarget || "n/a"}</p>
        <p>Last dial time: {formatTimestamp(diagnostics.relayDial.lastAttemptAt)}</p>
        <p>Last dial error: {diagnostics.relayDial.lastError || "n/a"}</p>
        <p>CRDT sent: {diagnostics.realtimeCrdt.crdtSent}</p>
        <p>CRDT received: {diagnostics.realtimeCrdt.crdtReceived}</p>
        <p>Decrypt failures: {diagnostics.realtimeCrdt.decryptFailures}</p>
        <p>Last CRDT sent: {formatTimestamp(diagnostics.realtimeCrdt.lastCrdtSentAt)}</p>
        <p>Last CRDT received: {formatTimestamp(diagnostics.realtimeCrdt.lastCrdtReceivedAt)}</p>
        <p>Last decrypt failure: {diagnostics.realtimeCrdt.lastDecryptFailureReason || "n/a"}</p>
        <p>Rollout mode: {diagnostics.runtimeRollout.mode}</p>
        <p>Runtime snapshots: {diagnostics.runtimeRollout.runtimeSnapshots}</p>
        <p>Runtime dial attempts: {diagnostics.runtimeRollout.runtimeDialAttempts}</p>
        <p>Runtime conn count: {diagnostics.runtimeRollout.runtimeConnectionCount}</p>
        <p>Legacy conn count: {diagnostics.runtimeRollout.legacyConnectionCount}</p>
        <p>Last runtime snapshot: {formatTimestamp(diagnostics.runtimeRollout.lastRuntimeSnapshotAt)}</p>
      </div>

      <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
        <p className="text-[11px] text-neutral-500">
          Failed dial targets use exponential backoff and are muted temporarily after repeated failures.
        </p>
        {localhostDialFailure ? (
          <p className="mt-1 text-[11px] text-amber-300">
            Local relay dial failed. Confirm app and relay are running on the same machine/network namespace and protocol context allows ws.
          </p>
        ) : null}
        <p className="text-[11px] uppercase tracking-wide text-neutral-500">
          Recent dial attempts
        </p>
        {attempts.length === 0 ? (
          <p className="mt-1 text-xs text-neutral-500">No attempts recorded yet.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs text-neutral-300">
            {attempts.map((attempt, index) => (
              <li key={`${attempt.timestamp}-${attempt.target}-${index}`}>
                {formatTimestamp(attempt.timestamp)} · {attempt.source} · {attempt.success ? "ok" : "fail"} · {attempt.target}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
