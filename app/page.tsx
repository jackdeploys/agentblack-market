import { TerminalHeader } from "@/components/terminal-header";
import { ForumLayout } from "@/components/forum/forum-layout";

export default function HomePage() {
  return (
    <div className="relative min-h-screen">
      <TerminalHeader />
      <ForumLayout />
    </div>
  );
}
