"use client";

import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { type Config, WagmiProvider } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { http } from "viem";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

if (!walletConnectProjectId) {
  throw new Error(
    "Missing NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in environment variables."
  );
}

type GlobalProvidersCache = typeof globalThis & {
  __ghostdocs_wagmi_config?: Config;
  __ghostdocs_query_client?: QueryClient;
};

const globalProvidersCache = globalThis as GlobalProvidersCache;

const config =
  globalProvidersCache.__ghostdocs_wagmi_config ||
  getDefaultConfig({
    appName: "GhostDocs",
    projectId: walletConnectProjectId,
    chains: [mainnet, sepolia],
    transports: {
      [mainnet.id]: http(),
      [sepolia.id]: http(),
    },
  });

if (!globalProvidersCache.__ghostdocs_wagmi_config) {
  globalProvidersCache.__ghostdocs_wagmi_config = config;
}

const queryClient =
  globalProvidersCache.__ghostdocs_query_client || new QueryClient();

if (!globalProvidersCache.__ghostdocs_query_client) {
  globalProvidersCache.__ghostdocs_query_client = queryClient;
}

type ProvidersProps = {
  children: ReactNode;
};

export default function Providers({ children }: ProvidersProps) {
  return (
    <WagmiProvider config={config} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
