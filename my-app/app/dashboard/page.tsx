import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import DashboardDocuments from "../components/dashboard-documents";
import { prisma } from "../lib/prisma";

export default async function DashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const identity = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: {
      ghostId: true,
      walletAddress: true,
      updatedAt: true,
    },
  });

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-16">
        <h1 className="text-3xl font-semibold">Dashboard</h1>
        <p className="text-neutral-300">
          Protected area for identity, document lifecycle, encrypted storage, and real-time collaboration.
        </p>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
          <h2 className="text-lg font-medium">Identity Status</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Persisted backend state from Neon for your account.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-neutral-500">
                GhostID
              </p>
              <p className="mt-2 break-all text-sm text-neutral-100">
                {identity?.ghostId ?? "Not created yet"}
              </p>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-950/70 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-neutral-500">
                Wallet
              </p>
              <p className="mt-2 break-all text-sm text-neutral-100">
                {identity?.walletAddress ?? "Not linked yet"}
              </p>
            </div>
          </div>

          <p className="mt-4 text-xs text-neutral-500">
            Last updated: {identity ? new Date(identity.updatedAt).toLocaleString() : "N/A"}
          </p>
        </section>

        <section className="rounded-2xl border border-emerald-800/50 bg-emerald-950/20 p-6">
          <h2 className="text-lg font-medium text-emerald-100">Collaboration Layer</h2>
          <p className="mt-1 text-sm text-emerald-100/80">
            Phase 4 is active in the editor using js-libp2p + Yjs with encrypted collaboration payloads.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-900/70 bg-emerald-950/50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/70">
                Current Behavior
              </p>
              <p className="mt-2 text-sm text-emerald-100/90">
                Opening an editor session starts peer identity, join token exchange, encrypted pubsub, presence, chat, and CRDT text sync.
              </p>
            </div>

            <div className="rounded-xl border border-emerald-900/70 bg-emerald-950/50 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/70">
                Access Modes
              </p>
              <p className="mt-2 text-sm text-emerald-100/90">
                Owner and allowlisted users can collaborate directly. Link recipients can collaborate via editor URLs that include share tokens.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-cyan-800/50 bg-cyan-950/20 p-6">
          <p className="mt-1 text-sm text-cyan-100/80">
            This section is loaded from live API routes for create/list/filter/share/access workflows.
          </p>

          <div className="mt-4">
            <DashboardDocuments />
          </div>
        </section>
      </div>
    </main>
  );
}
