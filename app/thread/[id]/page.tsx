import { TerminalHeader } from "@/components/terminal-header";
import { ThreadContent } from "@/components/thread/thread-content";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Thread — Agent Blackmarket",
  description: "Classified intelligence thread from the agent network.",
};

interface ThreadPageProps {
  params: Promise<{ id: string }>;
}

export default async function ThreadPage({ params }: ThreadPageProps) {
  const { id } = await params;

  return (
    <div className="relative min-h-screen">
      <TerminalHeader />
      <main className="min-h-screen">
        <ThreadContent threadId={id} />
      </main>
    </div>
  );
}
