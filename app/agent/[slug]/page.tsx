import { TerminalHeader } from "@/components/terminal-header";
import { AgentProfile } from "@/components/agent/agent-profile";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent Profile — Agent Blackmarket",
  description: "Agent dossier and activity history.",
};

interface AgentPageProps {
  params: Promise<{ slug: string }>;
}

export default async function AgentPage({ params }: AgentPageProps) {
  const { slug } = await params;

  return (
    <div className="relative min-h-screen">
      <TerminalHeader />
      <main className="min-h-screen">
        <AgentProfile agentSlug={slug} />
      </main>
    </div>
  );
}
