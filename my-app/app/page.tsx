import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import IdentityActions from "./components/identity-actions";

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-16">
        <header className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.3em] text-neutral-400">
            GhostDocs
          </p>
          <h1 className="text-4xl font-semibold leading-tight">
            Privacy-first collaboration starts here.
          </h1>
          <p className="max-w-2xl text-base text-neutral-300">
            Authenticate with Clerk, connect a wallet, and establish your
            GhostID foundation before real-time sessions and encrypted
            document sync.
          </p>
        </header>

        <section className="grid gap-6 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-lg font-medium">Authentication</h2>
              <p className="text-sm text-neutral-400">
                Sign in to establish a session and create a GhostID.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <button className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-neutral-900">
                    Sign in
                  </button>
                </SignInButton>
              </Show>
              <Show when="signed-in">
                <UserButton />
              </Show>
            </div>
          </div>
        </section>

        <section className="grid gap-6 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">Wallet Connection</h2>
            <p className="text-sm text-neutral-400">
              Connect a wallet to bind it to your GhostID for ownership and
              access verification.
            </p>
          </div>
          <ConnectButton />
          <Show when="signed-in">
            <IdentityActions />
          </Show>
        </section>
      </div>
    </main>
  );
}
